/**
 * Test for the hook library — id stability, rename preservation, duplicate
 * detection, orphan tolerance. No deps. Run: node wf-hooks.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureIds, dedupeIds, metaPath, workflowsRoot } from './.githooks/wf-hooks.mjs'

const root = mkdtempSync(join(tmpdir(), 'wf-hooks-test-'))
const idOf = (name) => JSON.parse(readFileSync(metaPath(root, name), 'utf-8')).id
const mk = (name, meta) => {
  mkdirSync(join(root, name), { recursive: true })
  if (meta !== undefined) writeFileSync(join(root, name, 'metadata.json'), JSON.stringify(meta))
}
try {
  // workflowsRoot descends into workflows/ when present, else uses root as-is
  assert.equal(workflowsRoot(root), root)

  // ensureIds mints for folders without one, leaves existing alone
  mk('alpha')
  mk('beta', { id: 'fixed-beta' })
  ensureIds(root)
  assert.match(idOf('alpha'), /^[0-9a-f-]{36}$/)
  assert.equal(idOf('beta'), 'fixed-beta')

  // rename preserves the id (it travels with the folder's metadata.json)
  const alphaId = idOf('alpha')
  renameSync(join(root, 'alpha'), join(root, 'alpha-renamed'))
  assert.equal(idOf('alpha-renamed'), alphaId, 'rename keeps the id')
  assert.equal(ensureIds(root).length, 0, 'renamed folder is not re-minted')

  // duplicate (cp -r) → the lexically-later copy gets a fresh id
  mk('gamma', { id: 'dup' })
  mk('gamma-copy', { id: 'dup' })
  const remapped = dedupeIds(root)
  assert.deepEqual(
    remapped.map((r) => r.folder),
    ['gamma-copy'],
    'the later duplicate is remapped',
  )
  assert.equal(idOf('gamma'), 'dup', 'original keeps the id')
  assert.notEqual(idOf('gamma-copy'), 'dup', 'copy is now independent')

  // orphan tolerance: an empty/garbage folder doesn't break the scan
  mk('empty')
  mk('garbage', undefined)
  writeFileSync(join(root, 'garbage', 'metadata.json'), '{ not json')
  assert.doesNotThrow(() => {
    ensureIds(root)
    dedupeIds(root)
  }, 'corrupt/empty folders are tolerated')

  console.log('wf-hooks.test: OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
