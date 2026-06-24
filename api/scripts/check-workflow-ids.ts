/**
 * Self-check for the metadata UUID read-or-create + reconcileWorkflowIds.
 * No framework, no fixtures — points WORKFLOWS_DIR at a throwaway temp dir and
 * exercises the real file IO. Run:
 *   npx tsx scripts/check-workflow-ids.ts
 *
 * WORKFLOWS_DIR must be set before the services import (config reads it at load
 * time), so the modules are pulled in via dynamic import below.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'cm-wf-ids-'))
process.env.WORKFLOWS_DIR = dir

const { ensureWorkflowUuid, readWorkflowUuid, remintWorkflowUuid, reconcileWorkflowIds } =
  await import('../src/services/workflows.js')

try {
  // metadata UUID: create-on-first-call, then stable
  const wf = join(dir, 'my-workflow')
  mkdirSync(wf)
  assert.equal(readWorkflowUuid(wf), null) // no metadata.json yet
  const id = ensureWorkflowUuid(wf)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(ensureWorkflowUuid(wf), id) // idempotent
  assert.equal(readWorkflowUuid(wf), id)

  // create-or-create preserves other metadata keys
  const wf2 = join(dir, 'wf2')
  mkdirSync(wf2)
  writeFileSync(join(wf2, 'metadata.json'), JSON.stringify({ note: 'keep me' }))
  const id2 = ensureWorkflowUuid(wf2)
  const meta2 = JSON.parse(readFileSync(join(wf2, 'metadata.json'), 'utf-8'))
  assert.equal(meta2.note, 'keep me')
  assert.equal(meta2.id, id2)

  // remint forces a fresh id (used by duplicate + dedupe)
  const before = readWorkflowUuid(wf2)
  const after = remintWorkflowUuid(wf2)
  assert.notEqual(after, before)
  assert.equal(readWorkflowUuid(wf2), after)

  // reconcileWorkflowIds: mint missing + dedupe duplicates
  mkdirSync(join(dir, 'recon-a'))
  mkdirSync(join(dir, 'recon-b'))
  mkdirSync(join(dir, 'recon-noid')) // no metadata.json → minted
  writeFileSync(join(dir, 'recon-a', 'metadata.json'), JSON.stringify({ id: 'shared' }))
  writeFileSync(join(dir, 'recon-b', 'metadata.json'), JSON.stringify({ id: 'shared' }))
  const recon = reconcileWorkflowIds()
  assert.ok(recon.minted >= 1, 'minted the folder without an id')
  assert.ok(recon.deduped >= 1, 'deduped the shared id')
  const idA = readWorkflowUuid(join(dir, 'recon-a'))
  const idB = readWorkflowUuid(join(dir, 'recon-b'))
  assert.equal(idA, 'shared') // lexically-first keeps it
  assert.ok(idB && idB !== 'shared', 'duplicate copy got an independent id')
  assert.ok(readWorkflowUuid(join(dir, 'recon-noid')), 'id-less folder was minted')
  // idempotent: a second reconcile is a no-op
  const recon2 = reconcileWorkflowIds()
  assert.equal(recon2.minted, 0)
  assert.equal(recon2.deduped, 0)

  console.log('check-workflow-ids: OK')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
