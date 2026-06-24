/**
 * Git over the workflows. WORKFLOWS_DIR may be the repo root OR a subfolder of
 * it (the GitHub repo keeps workflows under `workflows/`). We resolve the repo
 * root + the subdir prefix from git once and translate every path through it,
 * and scope add/clean to the workflows subtree so CM never touches the repo's
 * other files (CI config, README, …).
 *
 * Per-env serverUrls are kept out of git by a clean/smudge filter (see
 * .githooks/server-filter.mjs): `git add` strips each workflow's serverUrl to
 * the localhost placeholder (recording the real value to the gitignored
 * workflow-envtable.json), checkout/reset restores it. So `git status` stays
 * clean for a bound workflow and CM's update/publish don't need any
 * serverUrl-rewriting of their own — they just configure the filter and let
 * git apply it.
 *
 * Operations: status, update (snapshot + reset, never a merge), discard,
 * squash-publish (ff-only, refused when behind), branch switch. The GitHub PAT
 * is injected into the remote URL only at call time (never persisted) and
 * scrubbed from any surfaced error.
 *
 * `simple-git` shells out to the `git` binary (present in the api Docker image).
 * Gated by GIT_WORKFLOWS_ENABLED — when off, status() reports `enabled: false`.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hostname } from 'node:os'
import { simpleGit, type SimpleGit } from 'simple-git'
import { config } from '../config/index.js'
import { getWorkflowsDir, snapshotWorkflow } from '../lib/workflowFs.js'
import { slugify, validateForPublish, reconcileWorkflowIds } from './workflows.js'
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
let _prefix = ''

/** Repo-root git client + the POSIX path from the repo root to WORKFLOWS_DIR
 *  (`'workflows/'`, or `''` when WORKFLOWS_DIR is the repo root). Returns null
 *  when WORKFLOWS_DIR isn't inside a git repo, OR that repo isn't the configured
 *  workflows repo. Cached after first success. */
async function repo(): Promise<{ g: SimpleGit; prefix: string } | null> {
  if (_git) return { g: _git, prefix: _prefix }
  const probe = simpleGit({ baseDir: getWorkflowsDir() })
  try {
    if (!(await probe.checkIsRepo())) return null
    const root = (await probe.revparse(['--show-toplevel'])).trim()
    // Guard: only operate on the DEDICATED workflows repo, identified by its
    // committed filter script. WORKFLOWS_DIR may sit inside another repo (e.g.
    // CM's own checkout when workflows/ isn't its own clone) — without this the
    // toplevel would resolve to that parent and we'd stage/push the WRONG repo.
    if (!existsSync(join(root, '.githooks', 'server-filter.mjs'))) return null
    _prefix = (await probe.revparse(['--show-prefix'])).trim() // '' or e.g. 'workflows/'
    _git = simpleGit({ baseDir: root })
    return { g: _git, prefix: _prefix }
  } catch {
    return null
  }
}

/** Keep only repo-relative paths under the workflows subdir, stripped to
 *  workflow-relative (`workflows/img/params.json` → `img/params.json`). */
function underWorkflows(paths: string[], prefix: string): string[] {
  if (!prefix) return paths
  return paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length))
}

/** GIT_REMOTE (a GitHub HTTPS URL) with the PAT injected just-in-time — never
 *  written to .git/config. GitHub's token auth form is `x-access-token:<PAT>@host`
 *  (works for classic + fine-grained PATs). */
function authedRemote(): string | null {
  const remote = config.GIT_REMOTE
  if (!remote) return null
  if (!config.GIT_TOKEN) return remote
  try {
    const u = new URL(remote)
    u.username = 'x-access-token'
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

/** Initialize the workflows repo's git integration on THIS clone (idempotent):
 *  point git at the committed hooks (`core.hooksPath .githooks`) and wire the
 *  serverUrl clean/smudge filter. ALL the sanitize / restore / id-stability /
 *  dedupe logic lives in those committed scripts (`.githooks/*`), so it runs for
 *  every client — CM, WS, a plain `git pull` — not just CM; CM only sets the
 *  LOCAL config that activates them (plain `config` sets, not `--add`, so
 *  repeated calls don't accumulate). Run before any git op so commits/pulls
 *  trigger sanitization + restoration. If the scripts are absent the integration
 *  no-ops and the repo-side CI guard catches any real URL that reaches a commit.
 *  Best-effort: a config failure never aborts the git op. */
async function installGitIntegration(g: SimpleGit): Promise<void> {
  try {
    await g.raw(['config', 'core.hooksPath', '.githooks'])
    await g.raw(['config', 'filter.cmserver.clean', 'node .githooks/server-filter.mjs clean %f'])
    await g.raw(['config', 'filter.cmserver.smudge', 'node .githooks/server-filter.mjs smudge %f'])
  } catch (err) {
    console.warn('[git] could not install git integration:', scrub(asMessage(err)))
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Boot init for the git-workflows feature (idempotent): give every workflow a
 *  stable, unique metadata.json id, then install the repo's git integration
 *  (hooks + filter) on this clone. No-op when the feature is off; the integration
 *  half also no-ops when WORKFLOWS_DIR isn't the configured workflows repo (the
 *  repo() guard refuses a non-workflows parent such as CM's own checkout).
 *  Best-effort: a failure here must never block startup. */
export async function initWorkflowsGit(): Promise<void> {
  if (!config.GIT_WORKFLOWS_ENABLED) return
  try {
    reconcileWorkflowIds() // AC: every workflow dir has a stable, unique id
  } catch (err) {
    console.warn('[git] id reconcile at boot failed:', asMessage(err))
  }
  try {
    const r = await repo()
    if (r) await installGitIntegration(r.g)
  } catch (err) {
    console.warn('[git] integration setup at boot failed:', scrub(asMessage(err)))
  }
}

// A fetch hits the network — cache the last success so a polled status banner
// doesn't fetch on every call. ponytail: process-local TTL; fine for a single
// api instance. Every successful fetch() refreshes the timer, so update/publish
// (which fetch directly) keep status fresh too.
let lastFetchOk = 0
const FETCH_TTL_MS = 60_000

/** Fetch the work branch by URL (PAT injected). Updates FETCH_HEAD without
 *  touching any persisted remote. Repo-level — works from the subdir. Throws
 *  (token-scrubbed) on failure. */
export async function fetch(): Promise<void> {
  const remote = authedRemote()
  if (!remote) throw new Error('GIT_REMOTE is not configured')
  try {
    await simpleGit({ baseDir: getWorkflowsDir() }).fetch(remote, config.GIT_WORK_BRANCH)
    lastFetchOk = Date.now()
  } catch (err) {
    throw new Error(scrub(asMessage(err)))
  }
}

async function cachedFetch(): Promise<{ ok: boolean; error?: string }> {
  if (Date.now() - lastFetchOk < FETCH_TTL_MS) return { ok: true }
  try {
    await fetch()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: asMessage(err) }
  }
}

/** ahead/behind vs the just-fetched work branch (FETCH_HEAD). left = local
 *  ahead, right = remote ahead (= behind). 0s if FETCH_HEAD isn't usable. */
async function aheadBehind(g: SimpleGit): Promise<{ ahead: number; behind: number }> {
  try {
    const out = await g.raw(['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'])
    const [ahead, behind] = out
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10) || 0)
    return { ahead: ahead ?? 0, behind: behind ?? 0 }
  } catch {
    return { ahead: 0, behind: 0 }
  }
}

/** Run a name-only git command (`-z` output) → clean list of REPO-relative
 *  paths (caller strips to workflow-relative via underWorkflows). */
async function nameOnly(g: SimpleGit, args: string[]): Promise<string[]> {
  const out = await g.raw(args)
  return out
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Top-level workflow folder for a workflow-relative path, or null for files
 *  directly in the workflows dir (workflows.json) and dot/script dirs. */
function topFolder(p: string): string | null {
  if (!p.includes('/')) return null
  const seg = p.split('/')[0]!
  if (!seg || seg.startsWith('.') || seg === 'script') return null
  return seg
}

const NOT_A_REPO =
  'WORKFLOWS_DIR is not a configured workflows git repo — it must be its own ' +
  'clone (separate from CM) with .githooks/server-filter.mjs installed'

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
    const r = await repo()
    if (!r) return { ...s, error: NOT_A_REPO }
    const { g, prefix } = r
    const st = await g.status()
    s.branch = st.current ?? null
    // Working-tree changes under the workflows subdir (incl. untracked). Assumes
    // .history / temp files are gitignored — else they'd inflate this.
    s.dirty = prefix ? st.files.filter((f) => f.path.startsWith(prefix)).length : st.files.length

    const fetched = await cachedFetch()
    if (!fetched.ok) return { ...s, error: fetched.error }

    const ab = await aheadBehind(g)
    s.ahead = ab.ahead
    s.behind = ab.behind
    return s
  } catch (err) {
    return { ...s, error: scrub(asMessage(err)) }
  }
}

export interface UpdateResult {
  enabled: boolean
  updated: boolean
  behindBefore: number
  snapshotted: string[] // workflow folders backed up to .history before the reset
  error?: string
}

/**
 * Conflict-free update. Fetches; if not behind, no-op. Otherwise snapshots every
 * locally-changed workflow to `.history` (mandatory recoverability) and resets
 * the branch to the fetched commit. No git merge, ever. As the working tree is
 * rewritten the smudge filter re-applies each workflow's env-local serverUrl
 * from the gitignored envtable, so local server bindings survive the update —
 * only workflow CONTENT is taken from the remote (prior content stays in
 * `.history`).
 */
export async function update(): Promise<UpdateResult> {
  const res: UpdateResult = {
    enabled: config.GIT_WORKFLOWS_ENABLED,
    updated: false,
    behindBefore: 0,
    snapshotted: [],
  }
  if (!res.enabled) return res
  const r = await repo()
  if (!r) return { ...res, error: NOT_A_REPO }
  const { g, prefix } = r
  await installGitIntegration(g) // so the reset below re-smudges serverUrls

  await fetch() // fresh, not cached
  const { behind } = await aheadBehind(g)
  res.behindBefore = behind
  if (behind === 0) return res // already up to date

  const dir = resolve(getWorkflowsDir())

  // Snapshot every locally-changed workflow folder before the discard
  // (working-tree + untracked + committed-ahead) — mandatory recoverability.
  const tracked = underWorkflows(await nameOnly(g, ['diff', '--name-only', '-z', 'HEAD']), prefix)
  const untracked = underWorkflows(
    await nameOnly(g, ['ls-files', '--others', '--exclude-standard', '-z']),
    prefix,
  )
  const localCommit = underWorkflows(
    await nameOnly(g, ['diff', '--name-only', '-z', 'FETCH_HEAD...HEAD']),
    prefix,
  )
  const snapped = new Set<string>()
  for (const p of [...tracked, ...untracked, ...localCommit]) {
    const f = topFolder(p)
    if (!f || snapped.has(f)) continue
    const folderAbs = resolve(join(dir, f))
    if (!existsSync(folderAbs)) continue
    if (snapshotWorkflow(slugify(f), folderAbs, 'update')) {
      snapped.add(f)
      res.snapshotted.push(f)
    }
  }

  // Discard-all to the fetched commit (whole repo — CM only edits the workflows
  // subtree, the rest tracks the remote). The smudge filter restores serverUrls.
  await g.raw(['reset', '--hard', 'FETCH_HEAD'])

  // Refresh ids: a CM update is fetch+reset (not a real merge/checkout), so the
  // repo's post-merge hook doesn't fire — ensure newly-pulled workflows have
  // stable, unique ids ourselves (tolerates orphaned envtable entries for
  // workflows the pull deleted: it only scans folders that exist).
  try {
    reconcileWorkflowIds()
  } catch (err) {
    res.error = asMessage(err)
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
 * Squash-publish. Refuses if behind (never merges — Update first). Ensures each
 * changed workflow has a committed id, stages the workflows subtree into ONE
 * commit — the clean filter strips every serverUrl to the localhost placeholder
 * (recording the real value to the gitignored envtable) as it stages — and
 * fast-forward-only pushes. A non-ff rejection means someone published first →
 * surfaced as a conflict telling the user to Update.
 */
export async function publish(site = hostname()): Promise<PublishResult> {
  const res: PublishResult = { enabled: config.GIT_WORKFLOWS_ENABLED, published: false }
  if (!res.enabled) return res
  const r = await repo()
  if (!r) throw badRequest(NOT_A_REPO)
  const { g, prefix } = r
  await installGitIntegration(g) // so `git add` below strips serverUrls

  // Refuse when behind — never merge; the user must Update first.
  await fetch()
  const { ahead, behind } = await aheadBehind(g)
  if (behind > 0) throw conflict(`You're ${behind} behind — Update first, then publish.`)

  const tracked = underWorkflows(await nameOnly(g, ['diff', '--name-only', '-z', 'HEAD']), prefix)
  const untracked = underWorkflows(
    await nameOnly(g, ['ls-files', '--others', '--exclude-standard', '-z']),
    prefix,
  )
  const changed = [...new Set([...tracked, ...untracked])]
  // Nothing staged AND nothing already committed-ahead → genuinely nothing to do.
  if (changed.length === 0 && ahead === 0) return { ...res, nothingToPublish: true }

  if (changed.length > 0) {
    // Validate what's about to be committed (JSON validity; the serverUrl
    // secrets guard is the clean filter + the repo-side CI check).
    const violations = validateForPublish(changed)
    if (violations.length) throw badRequest('Cannot publish:\n' + violations.join('\n'))

    // Stage the workflows subtree only (not the repo's other files) into one
    // commit. The repo's git hooks do the rest: the clean filter strips each
    // serverUrl to the placeholder, the pre-commit hook ensures + dedupes the
    // metadata.json ids (committer identity passed inline, not persisted).
    await g.add(prefix ? ['-A', '--', prefix] : ['-A'])
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
    const m = scrub(asMessage(err))
    if (/non-fast-forward|rejected|fetch first|behind|stale info/i.test(m)) {
      throw conflict('Push rejected — someone published first. Update, then publish again.')
    }
    throw new Error(m)
  }
  // Refresh FETCH_HEAD so a status poll right after publish shows "up to date".
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
 * `.history` first (recoverable), then `reset --hard HEAD` + a `clean` scoped to
 * the workflows subtree, back to the last commit. Does NOT pull (use update).
 * The smudge filter re-applies env-local serverUrls as the reset rewrites the
 * working tree, so discarding content edits never drops a server binding.
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
  const r = await repo()
  if (!r) throw badRequest(NOT_A_REPO)
  const { g, prefix } = r
  await installGitIntegration(g) // so the reset below re-smudges serverUrls

  const dir = resolve(getWorkflowsDir())
  const tracked = underWorkflows(await nameOnly(g, ['diff', '--name-only', '-z', 'HEAD']), prefix)
  const untracked = underWorkflows(
    await nameOnly(g, ['ls-files', '--others', '--exclude-standard', '-z']),
    prefix,
  )
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
  // Scope clean to the workflows subtree; no -x so gitignored .history is kept.
  await g.raw(prefix ? ['clean', '-fd', '--', prefix] : ['clean', '-fd'])
  res.discarded = true
  return res
}

/** Switch to one of the allowed branches. Refuses when the workflows subtree is
 *  dirty (publish or discard first — never silently drops edits) and when the
 *  target isn't in the allowed set. The branch must already exist locally (the
 *  small fixed set is created at repo setup; CM doesn't create/track branches). */
export async function switchBranch(branch: string): Promise<{ branch: string }> {
  if (!config.GIT_WORKFLOWS_ENABLED) throw badRequest('Git workflows are disabled')
  if (!allowedBranches().includes(branch)) throw badRequest(`Branch not allowed: ${branch}`)
  const r = await repo()
  if (!r) throw badRequest(NOT_A_REPO)
  const { g, prefix } = r
  const st = await g.status()
  const dirty = prefix ? st.files.some((f) => f.path.startsWith(prefix)) : st.files.length > 0
  if (dirty) {
    throw conflict('You have unpublished changes — publish or discard them before switching.')
  }
  try {
    await g.raw(['checkout', branch])
  } catch (err) {
    throw badRequest(scrub(asMessage(err)))
  }
  return { branch }
}
