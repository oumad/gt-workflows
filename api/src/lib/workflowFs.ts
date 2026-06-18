/**
 * Workflow filesystem helpers — workflows live as folders on disk, so this
 * module owns the on-disk layout: where the workflow root is, safe
 * path-containment checks, and the snapshot / history machinery.
 *
 * Extracted from routes/workflows.ts to keep that router focused on HTTP.
 */
import {
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import {
  cp as cpAsync,
  mkdir as mkdirAsync,
  readdir as readdirAsync,
  rename as renameAsync,
  rm as rmAsync,
  stat as statAsync,
} from 'node:fs/promises'
import { join, resolve, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config/index.js'
import { unzip } from './unzip.js'

/** Absolute path of the workflow root. Set via WORKFLOWS_DIR in every real
 *  deploy; falls back to a repo-relative folder for local dev. */
export function getWorkflowsDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url))
  return resolve(
    config.WORKFLOWS_DIR.startsWith('/') || /^[A-Z]:/.test(config.WORKFLOWS_DIR)
      ? config.WORKFLOWS_DIR
      : join(here, '../../../', config.WORKFLOWS_DIR),
  )
}

/** True when `child` is `parent` itself, or a path strictly inside it.
 *
 *  A plain `child.startsWith(parent)` is unsafe: `/wf/foo-evil` also "starts
 *  with" `/wf/foo`, so a sibling directory whose name has the folder name as a
 *  prefix would escape the intended folder. Require the match to land on a
 *  path-separator boundary. Both arguments must be resolved/absolute. */
export function isInsideDir(child: string, parent: string): boolean {
  if (child === parent) return true
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/* ─── Snapshot history ────────────────────────────────────────────
   Saves a copy of the workflow folder under <WORKFLOWS_DIR>/.history/<id>/
   so the user can roll back to a previous save. We store as a folder tree
   (one `cpSync` to take, one to restore) rather than a zip — keeps the
   on-disk format inspectable and reuses code already used by /duplicate.

   The `.history` dir lives next to the workflow folders but is excluded
   from `readWorkflows()` (which already skips names starting with `.`),
   so it never shows up as a workflow.

   Retention: most recent SNAPSHOT_CAP entries per workflow; older ones
   are pruned on each save. */
export const SNAPSHOT_DIR = '.history'
export const SNAPSHOT_CAP = 50
/** Upper bound on the total bytes a single workflow's `.history` may occupy.
 *  Snapshots are full-folder copies, so an image-heavy workflow saved often
 *  could otherwise grow `.history` without bound and fill the WORKFLOWS_DIR
 *  volume. Pruned oldest-first after the count cap. */
export const SNAPSHOT_HISTORY_MAX_BYTES = 512 * 1024 * 1024
export type SnapshotKind = 'params' | 'workflow' | 'meta' | 'import'

export function historyRoot(id: string): string {
  return join(getWorkflowsDir(), SNAPSHOT_DIR, id)
}

/** Snapshot id encodes timestamp + kind, e.g. `2025-05-19T10-30-45-123Z__params`. */
function buildSnapshotId(kind: SnapshotKind, when: Date = new Date()): string {
  const iso = when.toISOString().replace(/[:.]/g, '-')
  return `${iso}__${kind}`
}

function parseSnapshotId(snapId: string): { savedAt: string; kind: SnapshotKind } | null {
  const m = snapId.match(/^(.+?)__(params|workflow|meta|import)$/)
  if (!m) return null
  // Reverse the timestamp normalization we did in buildSnapshotId. The first
  // 19 chars are YYYY-MM-DDTHH-MM-SS, then `-NNN` ms, then `Z`. We need to
  // re-introduce `:` between HH-MM-SS and `.` before ms.
  const raw = m[1]!
  const isoLike = raw.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1:$2:$3.$4Z',
  )
  const t = new Date(isoLike)
  if (Number.isNaN(t.getTime())) return null
  return { savedAt: t.toISOString(), kind: m[2] as SnapshotKind }
}

/** Copy the current workflow folder into `.history/<id>/<snapId>`. Synchronous
 *  variant for the destructive callers (delete, restore) that must capture the
 *  PRE-mutation state before they touch the folder. Retention is enforced by
 *  the shared `pruneHistoryAsync` (count + byte budget) — fired non-blocking so
 *  both snapshot paths share one policy. Best-effort: FS errors are logged but
 *  never fail the calling op. */
export function snapshotWorkflow(id: string, folderAbs: string, kind: SnapshotKind): void {
  try {
    const root = historyRoot(id)
    mkdirSync(root, { recursive: true })
    const snapId = buildSnapshotId(kind)
    cpSync(folderAbs, join(root, snapId), { recursive: true })
    void pruneHistoryAsync(root)
  } catch (err) {
    console.warn(
      '[workflows] snapshot failed for',
      id,
      ':',
      err instanceof Error ? err.message : err,
    )
  }
}

/** Non-blocking, fire-and-forget snapshot. Kicks the recursive copy onto the
 *  libuv threadpool (async fs) so a large workflow folder no longer freezes
 *  Node's event loop while the response is produced — the prior synchronous
 *  `cpSync` blocked every other in-flight request for the copy's duration,
 *  which (run twice concurrently on save) tripped the keep-alive reset race
 *  and surfaced as a burst of ECONNRESET in the browser.
 *
 *  Safe ONLY for callers that snapshot AFTER their mutation has landed (file
 *  writes, rename, upload, metadata patches). Destructive ops that must
 *  capture the PRE-mutation state (delete, restore) keep the synchronous
 *  `snapshotWorkflow`, where blocking is correct and those ops are rare. */
export function snapshotWorkflowAsync(id: string, folderAbs: string, kind: SnapshotKind): void {
  const root = historyRoot(id)
  // Stamp the snapshot id now (capture the save time accurately) even though
  // the copy completes a moment later on the threadpool.
  const snapId = buildSnapshotId(kind)
  void (async () => {
    // Copy into a `.partial` staging dir, then rename it into place. The rename
    // is atomic, so listSnapshots / restore never observe a half-copied
    // snapshot (a mid-copy restore would otherwise wipe the live folder and
    // copy back an incomplete tree). `.partial` names don't match
    // parseSnapshotId, so an orphaned staging dir stays invisible to history.
    const stagingDir = join(root, `${snapId}.partial`)
    try {
      await mkdirAsync(root, { recursive: true })
      await cpAsync(folderAbs, stagingDir, { recursive: true })
      await renameAsync(stagingDir, join(root, snapId))
      await pruneHistoryAsync(root)
    } catch (err) {
      try {
        await rmAsync(stagingDir, { recursive: true, force: true })
      } catch {
        /* ignore cleanup failure */
      }
      console.warn(
        '[workflows] async snapshot failed for',
        id,
        ':',
        err instanceof Error ? err.message : err,
      )
    }
  })()
}

/** Recursively sum a path's byte size (files + dirs). Best-effort: anything
 *  unreadable counts as 0 so a transient FS error never aborts a prune. */
async function dirSizeBytes(p: string): Promise<number> {
  let st
  try {
    st = await statAsync(p)
  } catch {
    return 0
  }
  if (st.isFile()) return st.size
  if (!st.isDirectory()) return 0
  let total = 0
  let children: string[] = []
  try {
    children = await readdirAsync(p)
  } catch {
    return total
  }
  for (const c of children) total += await dirSizeBytes(join(p, c))
  return total
}

/** Prune `.history/<id>` first by count (SNAPSHOT_CAP) then by total bytes
 *  (SNAPSHOT_HISTORY_MAX_BYTES), oldest-first. Snapshot ids are timestamp-
 *  prefixed so a lexical sort is chronological. Fully async / non-blocking. */
async function pruneHistoryAsync(root: string): Promise<void> {
  let entries: string[]
  try {
    entries = (await readdirAsync(root)).sort()
  } catch {
    return
  }
  // 1. Count cap.
  while (entries.length > SNAPSHOT_CAP) {
    const oldest = entries.shift()!
    try {
      await rmAsync(join(root, oldest), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  // 2. Byte budget — drop oldest until under the cap.
  const sized = await Promise.all(
    entries.map(async (name) => ({ name, bytes: await dirSizeBytes(join(root, name)) })),
  )
  let total = sized.reduce((sum, e) => sum + e.bytes, 0)
  for (const e of sized) {
    if (total <= SNAPSHOT_HISTORY_MAX_BYTES) break
    try {
      await rmAsync(join(root, e.name), { recursive: true, force: true })
      total -= e.bytes
    } catch {
      /* ignore */
    }
  }
}

/** Write a file atomically: stage to a sibling temp file, then rename over the
 *  target. rename is atomic within a filesystem, so a crash / ENOSPC mid-write
 *  can never leave a truncated or zero-byte destination — the original file
 *  survives intact. Used for params.json / workflow.json, where a partial
 *  write would corrupt the workflow. */
let atomicWriteCounter = 0
export function writeFileAtomic(absPath: string, data: string | Buffer): void {
  const tmp = `${absPath}.${process.pid}.${atomicWriteCounter++}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, absPath)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* ignore cleanup failure */
    }
    throw err
  }
}

export function listSnapshots(
  id: string,
): Array<{ id: string; savedAt: string; kind: SnapshotKind }> {
  const root = historyRoot(id)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const meta = parseSnapshotId(e.name)
      return meta ? { id: e.name, savedAt: meta.savedAt, kind: meta.kind } : null
    })
    .filter((s): s is { id: string; savedAt: string; kind: SnapshotKind } => s !== null)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt)) // newest first
}

/** OS / tooling cruft that should never be imported into a workflow folder —
 *  macOS (`__MACOSX/`, `.DS_Store`, `._*` AppleDouble forks), Windows
 *  (`Thumbs.db`, `desktop.ini`) and stray version-control dirs. */
function isJunkPath(p: string): boolean {
  const segments = p.split('/')
  if (segments.includes('__MACOSX') || segments.includes('.git')) return true
  const base = segments[segments.length - 1] ?? ''
  return (
    base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini' || base.startsWith('._')
  )
}

/**
 * Extract every file from a ZIP buffer into `destAbs` — overwriting files that
 * already exist and creating new ones (existing files NOT in the archive are
 * left untouched). OS/tooling junk (see `isJunkPath`) is skipped. If the
 * archive nests everything under a single top-level directory — as our own
 * `zipDirectory()` exports do — that directory is stripped so the contents land
 * directly in `destAbs`. Entries that would escape `destAbs` (zip-slip) are
 * skipped. Returns the number of files written.
 */
export function extractZipToDir(zipBuf: Buffer, destAbs: string): number {
  const entries = Array.from(unzip(zipBuf))
    .map(([p, data]): [string, Buffer] => [p.replace(/\\/g, '/'), data])
    // Drop directory entries and OS junk *before* the common-root scan, so a
    // macOS-made zip's stray `__MACOSX/` sibling doesn't defeat it.
    .filter(([p]) => p.length > 0 && !p.endsWith('/') && !isJunkPath(p))

  if (entries.length === 0) return 0

  // Strip a common top-level directory when every entry shares one.
  const root = entries[0]![0].split('/')[0]!
  const strip = root.length > 0 && entries.every(([p]) => p.startsWith(root + '/'))

  let written = 0
  for (const [rawPath, data] of entries) {
    const rel = strip ? rawPath.slice(root.length + 1) : rawPath
    if (!rel) continue
    const target = resolve(join(destAbs, rel))
    if (!isInsideDir(target, destAbs)) continue // zip-slip guard
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    written++
  }
  return written
}
