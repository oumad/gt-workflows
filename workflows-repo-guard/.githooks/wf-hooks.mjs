#!/usr/bin/env node
/**
 * Workflow id maintenance — runs IN the workflows repo (zero-dep) from the git
 * hooks, so a stable id and duplicate handling work for EVERY client (CM, WS, a
 * plain `git pull`), never CM-only.
 *
 *   ensureIds  — every workflow folder carries a stable `metadata.json` uuid
 *                (mint if missing). A rename keeps the id (it lives in the
 *                folder), so local server mappings (keyed by id in the envtable)
 *                survive a rename.
 *   dedupeIds  — two folders sharing a uuid (a filesystem-level duplicate, e.g.
 *                `cp -r`) → the later one (lexical order) gets a fresh uuid, so
 *                both stay independently configurable.
 *
 * CLI:  node wf-hooks.mjs precommit    (ensure + dedupe, then `git add` the ids)
 *       node wf-hooks.mjs postmerge    (ensure + dedupe after pull/checkout)
 *       node wf-hooks.mjs --selftest
 */
import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

/** Workflow folders live at the repo root or under a `workflows/` subfolder. */
export function workflowsRoot(root) {
  const sub = join(root, 'workflows')
  if (existsSync(sub)) {
    try {
      readdirSync(sub)
      return sub
    } catch {
      /* not a dir */
    }
  }
  return root
}

function folders(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'script')
    .map((e) => e.name)
}

export function metaPath(root, name) {
  return join(root, name, 'metadata.json')
}

function readMeta(p) {
  if (!existsSync(p)) return null
  try {
    const m = JSON.parse(readFileSync(p, 'utf-8'))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
  } catch {
    return {}
  }
}

function writeMeta(p, meta) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(meta, null, 2) + '\n')
}

function idOf(meta) {
  return meta && typeof meta.id === 'string' && meta.id ? meta.id : null
}

/** Mint a uuid for every workflow folder that lacks one. Returns the folder
 *  names that were minted. */
export function ensureIds(root) {
  const changed = []
  for (const name of folders(root)) {
    const p = metaPath(root, name)
    const meta = readMeta(p) ?? {}
    if (!idOf(meta)) {
      meta.id = randomUUID()
      writeMeta(p, meta)
      changed.push(name)
    }
  }
  return changed
}

/** Give a fresh uuid to any folder whose id duplicates one already seen (lexical
 *  order — the first folder keeps the id). Returns `[{ folder, id }]` remapped. */
export function dedupeIds(root) {
  const seen = new Set()
  const remapped = []
  for (const name of folders(root).sort()) {
    const p = metaPath(root, name)
    const meta = readMeta(p)
    const id = idOf(meta)
    if (!id) continue
    if (seen.has(id)) {
      meta.id = randomUUID()
      writeMeta(p, meta)
      remapped.push({ folder: name, id: meta.id })
      seen.add(meta.id)
    } else {
      seen.add(id)
    }
  }
  return remapped
}

function selftest() {
  const assert = (c, m) => {
    if (!c) {
      console.error('SELFTEST FAIL:', m)
      process.exit(1)
    }
  }
  const root = mkdtempSync(join(tmpdir(), 'wf-hooks-'))
  try {
    const mk = (name, meta) => {
      mkdirSync(join(root, name), { recursive: true })
      if (meta !== undefined) writeFileSync(join(root, name, 'metadata.json'), JSON.stringify(meta))
    }
    mk('a') // no metadata → minted
    mk('b', { id: 'shared-id' })
    mk('c', { id: 'shared-id' }) // duplicate of b → remapped
    mk('d', { id: 'unique', note: 'keep' })

    const minted = ensureIds(root)
    assert(minted.includes('a'), 'a should be minted')
    assert(idOf(readMeta(metaPath(root, 'a'))), 'a now has an id')
    assert(readMeta(metaPath(root, 'd')).note === 'keep', 'other metadata keys preserved')

    const remapped = dedupeIds(root)
    assert(remapped.length === 1 && remapped[0].folder === 'c', 'c (lexically later) remapped')
    const idB = idOf(readMeta(metaPath(root, 'b')))
    const idC = idOf(readMeta(metaPath(root, 'c')))
    assert(idB === 'shared-id', 'b keeps the original id')
    assert(idC && idC !== 'shared-id', 'c got a fresh id')
    assert(idOf(readMeta(metaPath(root, 'd'))) === 'unique', 'unique id untouched')

    // idempotent: a second pass changes nothing
    assert(ensureIds(root).length === 0 && dedupeIds(root).length === 0, 'second pass is a no-op')
    console.log('wf-hooks --selftest: OK')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('wf-hooks.mjs')
if (invokedDirectly) {
  const mode = process.argv[2]
  if (mode === '--selftest') {
    selftest()
  } else if (mode === 'precommit' || mode === 'postmerge') {
    const root = workflowsRoot(process.cwd())
    const ensured = ensureIds(root)
    const remapped = dedupeIds(root).map((r) => r.folder)
    const changed = [...new Set([...ensured, ...remapped])]
    if (mode === 'precommit' && changed.length) {
      // Stage the minted/remapped metadata.json so the ids land in THIS commit.
      const paths = changed.map((n) =>
        relative(process.cwd(), metaPath(root, n)).split(sep).join('/'),
      )
      try {
        execFileSync('git', ['add', '--', ...paths], { stdio: 'ignore' })
      } catch {
        /* best-effort — never block the commit */
      }
    }
    if (changed.length) {
      console.error(
        `[wf-hooks] ${mode}: ${ensured.length} id(s) minted, ${remapped.length} duplicate(s) remapped`,
      )
    }
  }
}
