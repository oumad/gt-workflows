/**
 * Git over the workflows. WORKFLOWS_DIR may be the repo root OR a subfolder of
 * it (the GitHub repo keeps workflows under `workflows/`). We resolve the repo
 * root + the subdir prefix from git once and translate every path through it,
 * and scope add/clean to the workflows subtree so CM never touches the repo's
 * other files (CI config, README, …).
 *
 * Keeping real serverUrls out of git is entirely the WS repo's job, via its own
 * committed hooks (.githooks/server-urls.mjs): pre-commit rewrites a literal
 * serverUrl in params.json to a `globalEnv.<key>` token and lifts the real URL
 * into the gitignored `.globalenv.json`. CM doesn't sanitize anything — it reads
 * params.json as-is and resolves any `globalEnv.<key>` token against the WS
 * config for display/dispatch (see services/globalEnv.ts). CM only activates the
 * hooks on this clone (core.hooksPath); it runs plain git otherwise.
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
    // Guard: only operate on the DEDICATED WS repo, identified by its committed
    // hook script. WORKFLOWS_DIR may sit inside another repo (e.g. CM's own
    // checkout) — without this the toplevel resolves to that parent and we'd
    // stage/push the WRONG repo.
    if (!existsSync(join(root, '.githooks', 'server-urls.mjs'))) return null
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

/** Wire the WS repo's git integration on THIS clone (idempotent), so its hooks
 *  actually run for CM's git ops just as for a plain `git` user:
 *   - `core.hooksPath .githooks` → the pre-commit / post-merge id hooks fire.
 *   - the `cmserver` clean/smudge filter → params.json serverUrls are swapped to
 *     the localhost placeholder in git (clean) and restored from the gitignored
 *     workflow-envmap.json on checkout (smudge). Without this, CM would commit
 *     real URLs and never restore them — i.e. "CM ignores the WS hooks".
 *  ALL the actual logic lives in `.githooks/server-urls.mjs` (committed to the WS
 *  repo); CM only sets the local config that activates it. Best-effort: a config
 *  failure never aborts the git op. */
async function installGitIntegration(g: SimpleGit): Promise<void> {
  // Each setting is best-effort and INDEPENDENT: a failure on one (e.g.
  // core.hooksPath on a hardened git) must not skip the serverUrl filter — the
  // essential part. (Previously one throw aborted the rest, so the filter never
  // got set and real URLs were committed.)
  const set = async (...args: string[]) => {
    try {
      await g.raw(['config', ...args])
    } catch (err) {
      // Log only the config KEY — the VALUE contains '%f', and passing a string
      // with a '%' token to console.warn would consume the error as a format arg.
      const key = args[0]?.startsWith('--') ? args[1] : args[0]
      console.warn(`[git] git config ${key} failed: ${scrub(asMessage(err))}`)
    }
  }
  // Hardened git (Debian bookworm) refuses to configure BOTH core.hooksPath and
  // clean/smudge filters unless these "unsafe" opt-ins are enabled — and git only
  // honors them from a TRUSTED scope (system/global, NEVER repo-local). The api
  // container runs as root so --system (/etc/gitconfig) is reliable; --global
  // covers a native/non-root run. Must precede the gated config below.
  for (const key of ['safe.allowUnsafeHooksPath', 'safe.allowUnsafeFilter']) {
    await set('--system', key, 'true')
    await set('--global', key, 'true')
  }
  await set('core.hooksPath', '.githooks')
  await set('filter.cmserver.clean', 'node .githooks/server-urls.mjs clean %f')
  await set('filter.cmserver.smudge', 'node .githooks/server-urls.mjs smudge %f')
  // NOT `required`: a required filter that errors aborts EVERY git op (bricks
  // status/publish). The filter is written to never fail; set false to recover
  // any clone a previous build left with required=true.
  await set('filter.cmserver.required', 'false')
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Boot init for the git-workflows feature (idempotent): give every workflow a
 *  stable, unique metadata.json id, then point this clone at the repo's hooks.
 *  No-op when the feature is off; the hooks half also no-ops when WORKFLOWS_DIR
 *  isn't the WS repo (the repo() guard refuses a non-workflows parent such as
 *  CM's own checkout). Best-effort: a failure here must never block startup. */
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

/** Workflow-subtree paths that differ from HEAD (tracked, content-level) plus
 *  untracked files. Uses `git diff` — which runs the cmserver clean filter — so a
 *  serverUrl-only edit is correctly NOT a change (porcelain `git status` would
 *  false-positive it from its stat cache). */
async function dirtyWorkflowPaths(g: SimpleGit, prefix: string): Promise<string[]> {
  const tracked = underWorkflows(await nameOnly(g, ['diff', '--name-only', '-z', 'HEAD']), prefix)
  const untracked = underWorkflows(
    await nameOnly(g, ['ls-files', '--others', '--exclude-standard', '-z']),
    prefix,
  )
  return [...new Set([...tracked, ...untracked])]
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
  'clone (separate from CM) with .githooks/server-urls.mjs present'

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
    s.branch = (await g.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null
    // Content-level changes under the workflows subdir (incl. untracked).
    // serverUrl-only edits don't count — the clean filter masks them.
    s.dirty = (await dirtyWorkflowPaths(g, prefix)).length

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
 * the branch to the fetched commit. No git merge, ever — workflow CONTENT is
 * taken from the remote (prior content stays in `.history`). Server bindings
 * ride along in params.json / `.globalenv.json`, both managed by the WS repo.
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
  await installGitIntegration(g) // ensure the repo's hooks are active for this op

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
  // subtree, the rest tracks the remote).
  await g.raw(['reset', '--hard', 'FETCH_HEAD'])

  // Refresh ids: a CM update is fetch+reset (not a real merge/checkout), so the
  // repo's post-merge hook doesn't fire — ensure newly-pulled workflows have
  // stable, unique ids ourselves (only scans folders that exist).
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
 * Squash-publish. Refuses if behind (never merges — Update first). Stages the
 * workflows subtree into ONE commit — the repo's pre-commit hook tokenizes any
 * literal serverUrl into `.globalenv.json` and dedupes ids as it commits — and
 * fast-forward-only pushes. A non-ff rejection means someone published first →
 * surfaced as a conflict telling the user to Update.
 */
export async function publish(site = hostname()): Promise<PublishResult> {
  const res: PublishResult = { enabled: config.GIT_WORKFLOWS_ENABLED, published: false }
  if (!res.enabled) return res
  const r = await repo()
  if (!r) throw badRequest(NOT_A_REPO)
  const { g, prefix } = r
  await installGitIntegration(g) // ensure the repo's pre-commit hook fires

  // Refuse when behind — never merge; the user must Update first.
  await fetch()
  const { ahead, behind } = await aheadBehind(g)
  if (behind > 0) throw conflict(`You're ${behind} behind — Update first, then publish.`)

  const changed = await dirtyWorkflowPaths(g, prefix)
  // Nothing changed AND nothing already committed-ahead → genuinely nothing to do.
  if (changed.length === 0 && ahead === 0) return { ...res, nothingToPublish: true }

  if (changed.length > 0) {
    // Validate what's about to be committed (JSON validity; keeping serverUrls
    // out of git is the repo's pre-commit hook + the repo-side CI check).
    const violations = validateForPublish(changed)
    if (violations.length) throw badRequest('Cannot publish:\n' + violations.join('\n'))

    // Stage the workflows subtree only (not the repo's other files) into one
    // commit. The repo's pre-commit hook does the rest: tokenizes serverUrls and
    // dedupes metadata.json ids (committer identity passed inline, not persisted).
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
  await installGitIntegration(g) // ensure the repo's hooks are active for this op

  const dir = resolve(getWorkflowsDir())
  const folders = new Set<string>()
  for (const p of await dirtyWorkflowPaths(g, prefix)) {
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
  if ((await dirtyWorkflowPaths(g, prefix)).length > 0) {
    throw conflict('You have unpublished changes — publish or discard them before switching.')
  }
  try {
    await g.raw(['checkout', branch])
  } catch (err) {
    throw badRequest(scrub(asMessage(err)))
  }
  return { branch }
}
