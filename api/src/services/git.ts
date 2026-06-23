/**
 * Git over the workflows directory (which is the git repo): status, update
 * (snapshot + reset + take-theirs, never a merge), discard, squash-publish
 * (ff-only, refused when behind), and branch switch. The push token is injected
 * into the remote URL only at call time and never persisted to .git/config; we
 * also scrub it from any surfaced error.
 *
 * `simple-git` shells out to the `git` binary (present in the api Docker image).
 * Gated by GIT_WORKFLOWS_ENABLED — when off, status() reports `enabled: false`
 * and nothing here runs.
 */
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { hostname } from 'node:os'
import { simpleGit, type SimpleGit } from 'simple-git'
import { config } from '../config/index.js'
import { getWorkflowsDir, isInsideDir, snapshotWorkflow } from '../lib/workflowFs.js'
import {
  slugify,
  validateForPublish,
  referencedGlobalEnvKeys,
  canonicalizeServerUrl,
  restoreLocalServerUrl,
} from './workflows.js'
import { reconcileGlobalEnv } from './globalEnv.js'
import { badRequest, conflict } from '../lib/httpError.js'

export interface GitStatus {
  enabled: boolean
  branch: string | null
  ahead: number
  behind: number
  dirty: number
  /** Branches the user may switch to (the small fixed set: work / default /
   *  staging). Drives the branch-switcher dropdown. */
  branches: string[]
  error?: string
}

/** The small fixed set of switchable branches (work / default / optional
 *  staging), de-duped. Agents are pinned to the work branch; humans promote. */
export function allowedBranches(): string[] {
  return [
    ...new Set([config.GIT_WORK_BRANCH, config.GIT_DEFAULT_BRANCH, config.GIT_STAGING_BRANCH]),
  ].filter((b): b is string => !!b)
}

let _git: SimpleGit | null = null
function git(): SimpleGit {
  if (!_git) _git = simpleGit({ baseDir: getWorkflowsDir() })
  return _git
}

/** GIT_REMOTE with the token injected just-in-time (never written to disk).
 *  `oauth2:<token>@` is the widely-compatible HTTPS form (GitLab + GitHub PAT). */
function authedRemote(): string | null {
  const remote = config.GIT_REMOTE
  if (!remote) return null
  if (!config.GIT_TOKEN) return remote
  try {
    const u = new URL(remote)
    u.username = 'oauth2'
    u.password = config.GIT_TOKEN
    return u.toString()
  } catch {
    return remote // non-URL remote (ssh shorthand) — leave as-is
  }
}

/** Remove the token from a string before logging / surfacing it. */
function scrub(msg: string): string {
  const t = config.GIT_TOKEN
  return t ? msg.split(t).join('***') : msg
}

// A fetch hits the network — cache the last success so a polled status banner
// doesn't fetch on every call. ponytail: process-local TTL; fine for a single
// api instance. Every successful fetch() refreshes the timer, so update/publish
// (which fetch directly) keep status fresh too.
let lastFetchOk = 0
const FETCH_TTL_MS = 60_000

/** Fetch the work branch by URL (token injected). Updates FETCH_HEAD without
 *  touching any persisted remote. Throws (token-scrubbed) on failure. */
export async function fetch(): Promise<void> {
  const remote = authedRemote()
  if (!remote) throw new Error('GIT_REMOTE is not configured')
  try {
    await git().fetch(remote, config.GIT_WORK_BRANCH)
    lastFetchOk = Date.now()
  } catch (err) {
    throw new Error(scrub(err instanceof Error ? err.message : String(err)))
  }
}

async function cachedFetch(): Promise<{ ok: boolean; error?: string }> {
  if (Date.now() - lastFetchOk < FETCH_TTL_MS) return { ok: true }
  try {
    await fetch()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Current git state for the banner. Resilient: any failure degrades to a
 *  populated-as-far-as-possible result with `error`, never throws. */
export async function status(): Promise<GitStatus> {
  const s: GitStatus = {
    enabled: config.GIT_WORKFLOWS_ENABLED,
    branch: null,
    ahead: 0,
    behind: 0,
    dirty: 0,
    branches: allowedBranches(),
  }
  if (!s.enabled) return s

  try {
    const g = git()
    if (!(await g.checkIsRepo())) {
      return { ...s, error: 'WORKFLOWS_DIR is not a git repository' }
    }
    const st = await g.status()
    s.branch = st.current ?? null
    // Working-tree changes (incl. untracked). Assumes .history / temp files are
    // gitignored — otherwise they'd inflate this. ponytail: report what git says.
    s.dirty = st.files.length

    const fetched = await cachedFetch()
    if (!fetched.ok) return { ...s, error: fetched.error }

    const ab = await aheadBehind()
    s.ahead = ab.ahead
    s.behind = ab.behind
    return s
  } catch (err) {
    return { ...s, error: scrub(err instanceof Error ? err.message : String(err)) }
  }
}

/** ahead/behind vs the just-fetched work branch (FETCH_HEAD). left = local
 *  ahead, right = remote ahead (= behind). 0s if FETCH_HEAD isn't usable. */
async function aheadBehind(): Promise<{ ahead: number; behind: number }> {
  try {
    const out = await git().raw(['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'])
    const [ahead, behind] = out
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10) || 0)
    return { ahead: ahead ?? 0, behind: behind ?? 0 }
  } catch {
    return { ahead: 0, behind: 0 }
  }
}

/** Run a name-only git command (`-z` output) → clean list of repo-relative
 *  paths. Used to diff local vs remote without status-prefix / quoting parsing. */
async function nameOnly(args: string[]): Promise<string[]> {
  const out = await git().raw(args)
  return out
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Top-level workflow folder for a repo-relative path, or null for top-level
 *  files (workflows.json) and dot/script dirs that aren't workflows. */
function topFolder(p: string): string | null {
  if (!p.includes('/')) return null
  const seg = p.split('/')[0]!
  if (!seg || seg.startsWith('.') || seg === 'script') return null
  return seg
}

export interface UpdateResult {
  enabled: boolean
  updated: boolean
  behindBefore: number
  snapshotted: string[] // workflow folders backed up to .history
  restored: string[] // local-only files kept (take-theirs)
  addedKeys: string[] // globalEnv keys created by reconcile
  error?: string
}

/**
 * Conflict-free update. Fetches; if not behind, no-op. Otherwise snapshots
 * every locally-changed workflow to `.history` (mandatory recoverability),
 * resets the branch to the fetched commit (discard-all), then restores
 * local-only edits the remote didn't touch (file-level take-theirs — overlaps
 * keep the remote version, the prior local stays in `.history`). Finally runs
 * the additive globalEnv reconcile against the new tree. No git merge, ever.
 */
export async function update(): Promise<UpdateResult> {
  const res: UpdateResult = {
    enabled: config.GIT_WORKFLOWS_ENABLED,
    updated: false,
    behindBefore: 0,
    snapshotted: [],
    restored: [],
    addedKeys: [],
  }
  if (!res.enabled) return res
  const g = git()
  if (!(await g.checkIsRepo())) return { ...res, error: 'WORKFLOWS_DIR is not a git repository' }

  await fetch() // fresh, not cached
  const { behind } = await aheadBehind()
  res.behindBefore = behind
  if (behind === 0) return res // already up to date

  const dir = resolve(getWorkflowsDir())

  // Local changes: working-tree (tracked) + untracked + committed-ahead.
  const tracked = await nameOnly(['diff', '--name-only', '-z', 'HEAD'])
  const untracked = await nameOnly(['ls-files', '--others', '--exclude-standard', '-z'])
  const localCommit = await nameOnly(['diff', '--name-only', '-z', 'FETCH_HEAD...HEAD'])
  const workingChanged = [...new Set([...tracked, ...untracked])]
  const remoteChanged = new Set(await nameOnly(['diff', '--name-only', '-z', 'HEAD...FETCH_HEAD']))

  // 1. Snapshot every locally-changed workflow folder (mandatory recoverability).
  const snapMap = new Map<string, string>()
  for (const p of [...workingChanged, ...localCommit]) {
    const f = topFolder(p)
    if (!f || snapMap.has(f)) continue
    const folderAbs = resolve(join(dir, f))
    if (!existsSync(folderAbs)) continue
    const snap = snapshotWorkflow(slugify(f), folderAbs, 'update')
    if (snap) {
      snapMap.set(f, snap)
      res.snapshotted.push(f)
    }
  }

  // 2. Discard-all: move the branch to the fetched commit.
  await g.raw(['reset', '--hard', 'FETCH_HEAD'])

  // 3. Take-theirs: restore local-only working files the remote didn't change.
  //    ponytail: committed-ahead local-only files are snapshotted but not
  //    auto-restored — recover from History if ever needed (rare; CM edits the
  //    working tree, publish squashes+pushes so ahead is normally 0).
  for (const p of workingChanged) {
    if (remoteChanged.has(p)) continue // overlap → keep remote (prior local in .history)
    const f = topFolder(p)
    const snap = f ? snapMap.get(f) : undefined
    if (!f || !snap) continue
    const dest = resolve(join(dir, p))
    if (!isInsideDir(dest, dir)) continue
    const src = join(snap, p.slice(f.length + 1))
    if (existsSync(src)) {
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
    } else {
      rmSync(dest, { force: true }) // file was locally deleted → re-delete
    }
    res.restored.push(p)
  }

  // 3b. serverUrl is env-local: re-apply each workflow's pre-pull serverUrl from
  //     its snapshot, so a local binding choice (custom URL / localhost / a
  //     different globalEnv key) survives the pull even on an overlapping change.
  for (const [f, snap] of snapMap) restoreLocalServerUrl(f, snap)

  // 4. Additive globalEnv reconcile against the post-update tree. Non-fatal:
  //    the git update already succeeded; surface a reconcile error as a warning.
  try {
    res.addedKeys = reconcileGlobalEnv(referencedGlobalEnvKeys()).added
  } catch (err) {
    res.error = err instanceof Error ? err.message : String(err)
  }

  res.updated = true
  return res
}

export interface PublishResult {
  enabled: boolean
  published: boolean
  nothingToPublish?: boolean
}

/**
 * Squash-publish. Refuses if behind (never merges — Update first). Validates
 * the changed files (no literal real URLs, valid JSON), stages everything into
 * ONE commit, and fast-forward-only pushes. A non-ff rejection means someone
 * published first → surfaced as a conflict telling the user to Update.
 */
export async function publish(site = hostname()): Promise<PublishResult> {
  const res: PublishResult = { enabled: config.GIT_WORKFLOWS_ENABLED, published: false }
  if (!res.enabled) return res
  const g = git()
  if (!(await g.checkIsRepo())) throw badRequest('WORKFLOWS_DIR is not a git repository')

  // Refuse when behind — never merge; the user must Update first.
  await fetch()
  const { ahead, behind } = await aheadBehind()
  if (behind > 0) throw conflict(`You're ${behind} behind — Update first, then publish.`)

  const tracked = await nameOnly(['diff', '--name-only', '-z', 'HEAD'])
  const untracked = await nameOnly(['ls-files', '--others', '--exclude-standard', '-z'])
  const changed = [...new Set([...tracked, ...untracked])]
  // Nothing staged AND nothing already committed-ahead → genuinely nothing to do.
  if (changed.length === 0 && ahead === 0) return { ...res, nothingToPublish: true }

  if (changed.length > 0) {
    // Git only ever stores tokens: rewrite any literal serverUrl to the
    // workflow's canonical token (lifting the URL into this env's globalEnv).
    // So "I set it to localhost" lands in git as globalEnv.url_<id>, no friction.
    const folders = new Set<string>()
    for (const p of changed) {
      const f = topFolder(p)
      if (f) folders.add(f)
    }
    for (const f of folders) canonicalizeServerUrl(f)

    // Validate what's about to be committed (now token-only; still guards JSON).
    const violations = validateForPublish(changed)
    if (violations.length) throw badRequest('Cannot publish:\n' + violations.join('\n'))

    // Stage + squash working changes into one commit (committer identity passed
    // inline, not persisted to .git/config).
    await g.add(['-A'])
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    await g.raw([
      '-c',
      'user.name=Coffee Maker',
      '-c',
      'user.email=coffee-maker@local',
      'commit',
      '-m',
      `Published by ${site} on ${stamp}`,
    ])
  }
  // else: only pre-existing ahead commits — push them as-is.

  // Fast-forward-only push (git rejects non-ff by default).
  const remote = authedRemote()
  if (!remote) throw badRequest('GIT_REMOTE is not configured')
  try {
    await g.push(remote, `HEAD:${config.GIT_WORK_BRANCH}`)
  } catch (err) {
    const m = scrub(err instanceof Error ? err.message : String(err))
    if (/non-fast-forward|rejected|fetch first|behind|stale info/i.test(m)) {
      throw conflict('Push rejected — someone published first. Update, then publish again.')
    }
    throw new Error(m)
  }
  // Refresh FETCH_HEAD so a status poll right after publish shows "up to date"
  // instead of ahead-by-our-just-pushed-commit. Best-effort: the push already
  // succeeded, so a transient fetch blip here doesn't matter.
  try {
    await fetch()
  } catch {
    /* push landed; next status poll will resync */
  }
  res.published = true
  return res
}

/**
 * Discard ALL local changes — snapshot every locally-changed workflow to
 * `.history` first (recoverable), then `reset --hard HEAD` + `clean -fd` back
 * to the last commit. Does NOT pull (use update for that). The way out for a
 * user who wants to abandon edits, e.g. to switch branches.
 */
export async function discard(): Promise<{
  enabled: boolean
  discarded: boolean
  snapshotted: string[]
}> {
  const res = {
    enabled: config.GIT_WORKFLOWS_ENABLED,
    discarded: false,
    snapshotted: [] as string[],
  }
  if (!res.enabled) return res
  const g = git()
  if (!(await g.checkIsRepo())) throw badRequest('WORKFLOWS_DIR is not a git repository')

  const dir = resolve(getWorkflowsDir())
  const tracked = await nameOnly(['diff', '--name-only', '-z', 'HEAD'])
  const untracked = await nameOnly(['ls-files', '--others', '--exclude-standard', '-z'])
  const folders = new Set<string>()
  for (const p of [...tracked, ...untracked]) {
    const f = topFolder(p)
    if (f) folders.add(f)
  }
  for (const f of folders) {
    const folderAbs = resolve(join(dir, f))
    if (existsSync(folderAbs) && snapshotWorkflow(slugify(f), folderAbs, 'update')) {
      res.snapshotted.push(f)
    }
  }
  await g.raw(['reset', '--hard', 'HEAD'])
  await g.raw(['clean', '-fd']) // untracked (gitignored .history is kept — no -x)
  res.discarded = true
  return res
}

/** Switch to one of the allowed branches. Refuses when the working tree is
 *  dirty (publish or discard first — never silently drops edits) and when the
 *  target isn't in the allowed set. The branch must already exist locally
 *  (ponytail: the small fixed set is created at repo setup; we don't auto-create
 *  tracking branches from the by-URL fetch model). */
export async function switchBranch(branch: string): Promise<{ branch: string }> {
  if (!config.GIT_WORKFLOWS_ENABLED) throw badRequest('Git workflows are disabled')
  if (!allowedBranches().includes(branch)) throw badRequest(`Branch not allowed: ${branch}`)
  const g = git()
  if (!(await g.checkIsRepo())) throw badRequest('WORKFLOWS_DIR is not a git repository')
  const st = await g.status()
  if (st.files.length > 0) {
    throw conflict('You have unpublished changes — publish or discard them before switching.')
  }
  try {
    await g.raw(['checkout', branch])
  } catch (err) {
    throw badRequest(scrub(err instanceof Error ? err.message : String(err)))
  }
  return { branch }
}
