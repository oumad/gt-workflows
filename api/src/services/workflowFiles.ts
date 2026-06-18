/**
 * Generic workflow-folder filesystem ops. Powers the "Files" tab in the
 * workflow detail page: tree listing, read/write arbitrary files, create
 * folders, rename, delete, multipart upload.
 *
 * Sibling to services/workflows.ts (which handles params.json / workflow.json
 * specifically and the high-level workflow lifecycle). This module is
 * intentionally low-level: it just operates inside a workflow's folder root
 * with every path strictly sanitized via `isInsideDir` against `folderAbs`.
 *
 * All paths the caller supplies are POSIX-style ("/" separators) and relative
 * to the workflow folder root. An empty string or "." is the root itself.
 */
import {
  readdirSync,
  existsSync,
  readFileSync,
  statSync,
  mkdirSync,
  rmSync,
  renameSync,
} from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { resolveFolder } from './workflows.js'
import {
  isInsideDir,
  snapshotWorkflow,
  snapshotWorkflowAsync,
  writeFileAtomic,
} from '../lib/workflowFs.js'
import { badRequest, forbidden, notFound, conflict } from '../lib/httpError.js'

/* ─── Path sanitation ─────────────────────────────────────────────
   The single chokepoint every filesystem operation goes through:
   - Reject paths that try to escape the workflow folder via `..`
   - Reject absolute or drive-style paths
   - Reject NUL bytes (path-traversal nasties)
   - Return both the resolved absolute path AND the canonical relative path
     so callers can echo back a clean form. */
function resolveSafe(folderAbs: string, rel: string): { abs: string; rel: string } {
  const cleaned = (rel ?? '').replace(/\\/g, '/').trim()
  if (cleaned.includes('\0')) throw badRequest('Invalid path')
  // Allow empty / "." → folder root
  const normalized = cleaned === '' || cleaned === '.' ? '' : cleaned.replace(/^\/+/, '')
  const abs = resolve(join(folderAbs, normalized))
  if (!isInsideDir(abs, folderAbs)) throw forbidden('Path escapes workflow folder')
  return { abs, rel: normalized }
}

/** A single filename segment (no slashes, no traversal). Used by rename + new
 *  folder + upload so the input segment can't sneak path components in. */
function assertSegment(name: string): void {
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..' || name.includes('\0')) {
    throw badRequest('Invalid name')
  }
}

/* ─── Listing ───────────────────────────────────────────────────── */

export type TreeNode = {
  /** Path relative to the workflow folder root, POSIX-style. "" for root. */
  path: string
  name: string
  type: 'dir' | 'file'
  /** Bytes — files only. */
  size?: number
  /** ISO timestamp of last modification. */
  modifiedAt?: string
  children?: TreeNode[]
}

const HIDDEN_TOP_LEVEL = new Set(['.history'])

function readDir(absDir: string, relDir: string): TreeNode[] {
  const entries = readdirSync(absDir, { withFileTypes: true })
    // Filter only at the workflow root: hide `.history` so users don't see (or
    // edit) snapshot folders. Anywhere else, dotfiles are fair game.
    .filter((e) => !(relDir === '' && HIDDEN_TOP_LEVEL.has(e.name)))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return entries.map((e) => {
    const childRel = relDir ? `${relDir}/${e.name}` : e.name
    const childAbs = join(absDir, e.name)
    if (e.isDirectory()) {
      return {
        path: childRel,
        name: e.name,
        type: 'dir',
        children: readDir(childAbs, childRel),
      }
    }
    let size: number | undefined
    let modifiedAt: string | undefined
    try {
      const st = statSync(childAbs)
      size = st.size
      modifiedAt = st.mtime.toISOString()
    } catch {
      /* unreadable — leave undefined */
    }
    return {
      path: childRel,
      name: e.name,
      type: 'file',
      size,
      modifiedAt,
    }
  })
}

export function listTree(id: string): TreeNode {
  const { folderAbs, folderName } = resolveFolder(id)
  return {
    path: '',
    name: folderName,
    type: 'dir',
    children: readDir(folderAbs, ''),
  }
}

/* ─── Read / write ──────────────────────────────────────────────── */

/** Heuristic byte cap for "openable as text" — anything larger forces a
 *  download and is read-only in the UI. 2 MB is plenty for json + scripts. */
export const TEXT_FILE_CAP = 2 * 1024 * 1024

export type FileRead = {
  path: string
  name: string
  size: number
  modifiedAt: string
  /** UTF-8 text contents. Only present for files within TEXT_FILE_CAP. */
  text?: string
  /** True when the file is too large or contains binary bytes — caller should
   *  treat it as opaque (preview/download only, no edit). */
  binary?: boolean
}

function looksBinary(buf: Buffer): boolean {
  // Sample the first 1 KB — if any NUL byte appears it's almost certainly
  // not a text file we want to render in a textarea.
  const sample = buf.slice(0, 1024)
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return true
  return false
}

export function readFile(id: string, path: string): FileRead {
  const { folderAbs } = resolveFolder(id)
  const { abs, rel } = resolveSafe(folderAbs, path)
  if (!existsSync(abs)) throw notFound('File not found')
  const st = statSync(abs)
  if (!st.isFile()) throw badRequest('Not a file')

  const meta: FileRead = {
    path: rel,
    name: basename(rel),
    size: st.size,
    modifiedAt: st.mtime.toISOString(),
  }

  if (st.size > TEXT_FILE_CAP) return { ...meta, binary: true }
  const buf = readFileSync(abs)
  if (looksBinary(buf)) return { ...meta, binary: true }
  return { ...meta, text: buf.toString('utf-8') }
}

/** Read a file's raw bytes for binary streaming (image preview, downloads).
 *  Returns the buffer + a content-type guess based on file extension. The
 *  caller (HTTP route) is responsible for setting Content-Type / Cache-Control
 *  on the response. Throws notFound / badRequest the same way readFile does. */
export function readFileBytes(
  id: string,
  path: string,
): { buffer: Buffer; contentType: string; rel: string; size: number; modifiedAt: string } {
  const { folderAbs } = resolveFolder(id)
  const { abs, rel } = resolveSafe(folderAbs, path)
  if (!existsSync(abs)) throw notFound('File not found')
  const st = statSync(abs)
  if (!st.isFile()) throw badRequest('Not a file')
  const buffer = readFileSync(abs)
  return {
    buffer,
    contentType: guessContentType(rel),
    rel,
    size: st.size,
    modifiedAt: st.mtime.toISOString(),
  }
}

// Minimal extension → MIME mapping. We don't ship the full `mime-types`
// package because the workflow folder's binary content is overwhelmingly
// images + a few common video / audio formats; an inline table keeps the
// dependency footprint smaller and the mapping reviewable.
function guessContentType(relPath: string): string {
  const ext = relPath.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'avif':
      return 'image/avif'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    case 'mp4':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mov':
      return 'video/quicktime'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
      return 'audio/ogg'
    case 'pdf':
      return 'application/pdf'
    case 'json':
      return 'application/json'
    case 'txt':
    case 'md':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

export function writeFile(id: string, path: string, text: string): FileRead {
  const { folderAbs } = resolveFolder(id)
  const { abs, rel } = resolveSafe(folderAbs, path)
  if (rel === '') throw badRequest('Cannot write to the workflow root')

  // If the file doesn't exist yet, we still allow creation — but only if the
  // parent directory exists. (Use createFolder first if a new directory tree
  // is needed; that keeps writes from silently spawning deep folder chains.)
  const parent = dirname(abs)
  if (!existsSync(parent)) throw notFound('Parent folder does not exist')
  if (existsSync(abs) && !statSync(abs).isFile()) throw badRequest('Path is a directory')

  writeFileAtomic(abs, text)
  snapshotWorkflowAsync(id, folderAbs, 'meta')
  return readFile(id, rel)
}

/* ─── Create folder ────────────────────────────────────────────── */

export function createFolder(id: string, path: string): TreeNode {
  const { folderAbs } = resolveFolder(id)
  const { abs, rel } = resolveSafe(folderAbs, path)
  if (rel === '') throw badRequest('Cannot create root')
  if (existsSync(abs)) throw conflict('Path already exists')
  mkdirSync(abs, { recursive: true })
  return { path: rel, name: basename(rel), type: 'dir', children: [] }
}

/* ─── Rename / move ────────────────────────────────────────────── */

export type RenameResult = { from: string; to: string }

export function renamePath(id: string, from: string, to: string): RenameResult {
  const { folderAbs } = resolveFolder(id)
  const src = resolveSafe(folderAbs, from)
  const dst = resolveSafe(folderAbs, to)
  if (src.rel === '' || dst.rel === '') throw badRequest('Cannot rename root')
  if (!existsSync(src.abs)) throw notFound('Source not found')
  if (existsSync(dst.abs)) throw conflict('Destination already exists')

  const parent = dirname(dst.abs)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })

  renameSync(src.abs, dst.abs)
  snapshotWorkflowAsync(id, folderAbs, 'meta')
  return { from: src.rel, to: dst.rel }
}

/* ─── Delete ───────────────────────────────────────────────────── */

export function deletePath(id: string, path: string): void {
  const { folderAbs } = resolveFolder(id)
  const { abs, rel } = resolveSafe(folderAbs, path)
  if (rel === '') throw badRequest('Cannot delete root')
  if (!existsSync(abs)) throw notFound('Path not found')
  // Snapshot before destructive op so the user can roll back.
  snapshotWorkflow(id, folderAbs, 'meta')
  rmSync(abs, { recursive: true, force: true })
}

/* ─── Upload (multipart) ───────────────────────────────────────── */

export async function uploadFile(id: string, destFolder: string, file: File): Promise<FileRead> {
  const { folderAbs } = resolveFolder(id)
  const { abs: destAbs } = resolveSafe(folderAbs, destFolder)
  if (!existsSync(destAbs) || !statSync(destAbs).isDirectory()) {
    throw notFound('Destination folder not found')
  }

  // Filename comes from the multipart upload — sanitize the segment, then
  // resolveSafe again with the joined path to be doubly sure.
  const name = (file.name ?? '').split(/[\\/]/).pop() ?? ''
  assertSegment(name)
  const joinedRel = destFolder ? `${destFolder.replace(/\/$/, '')}/${name}` : name
  const { abs: targetAbs, rel: targetRel } = resolveSafe(folderAbs, joinedRel)

  if (existsSync(targetAbs)) throw conflict('File already exists at destination')

  const buf = Buffer.from(await file.arrayBuffer())
  writeFileAtomic(targetAbs, buf)
  snapshotWorkflowAsync(id, folderAbs, 'meta')
  return readFile(id, targetRel)
}
