/**
 * Self-check for the envtable round-trip + the metadata UUID read-or-create.
 * No framework, no fixtures — points WORKFLOWS_DIR at a throwaway temp dir and
 * exercises the real file IO. Run:
 *   npx tsx scripts/check-envtable.ts
 *
 * WORKFLOWS_DIR must be set before the services import (config reads it at load
 * time), so the modules are pulled in via dynamic import below.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'cm-envtable-'))
process.env.WORKFLOWS_DIR = dir

const { setEnvServerUrl, getEnvServerUrl, readEnvTable, ENVTABLE_FILE } = await import(
  '../src/services/envtable.js'
)
const { ensureWorkflowUuid, readWorkflowUuid, remintWorkflowUuid, reconcileWorkflowIds } =
  await import('../src/services/workflows.js')
const { writeFileSync } = await import('node:fs')

try {
  // unbound → undefined
  assert.equal(getEnvServerUrl('missing'), undefined)

  // verbatim preservation: literal string, pool array, globalEnv expression
  setEnvServerUrl('id-literal', 'https://company.internal:8188')
  setEnvServerUrl('id-pool', ['http://10.0.0.8:8188', 'http://10.0.0.9:8188'])
  setEnvServerUrl('id-expr', '<globalEnv.serverPool1>')
  assert.equal(getEnvServerUrl('id-literal'), 'https://company.internal:8188')
  assert.deepEqual(getEnvServerUrl('id-pool'), ['http://10.0.0.8:8188', 'http://10.0.0.9:8188'])
  assert.equal(getEnvServerUrl('id-expr'), '<globalEnv.serverPool1>') // expression NOT resolved

  // upsert overwrites only the touched key, leaves the rest intact
  setEnvServerUrl('id-literal', '<globalEnv.other>')
  assert.equal(getEnvServerUrl('id-literal'), '<globalEnv.other>')
  assert.equal(getEnvServerUrl('id-expr'), '<globalEnv.serverPool1>')
  assert.equal(Object.keys(readEnvTable()).length, 3)
  assert.ok(existsSync(join(dir, ENVTABLE_FILE)))

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

  // reconcileWorkflowIds: mint missing + dedupe duplicates + seed envtable
  mkdirSync(join(dir, 'recon-a'))
  mkdirSync(join(dir, 'recon-b'))
  mkdirSync(join(dir, 'recon-noid')) // no metadata.json → minted
  mkdirSync(join(dir, 'recon-bound')) // real binding in params, none in envtable → seeded
  writeFileSync(join(dir, 'recon-a', 'metadata.json'), JSON.stringify({ id: 'shared' }))
  writeFileSync(join(dir, 'recon-b', 'metadata.json'), JSON.stringify({ id: 'shared' }))
  writeFileSync(
    join(dir, 'recon-bound', 'params.json'),
    JSON.stringify({ comfyui_config: { serverUrl: 'https://company.internal:8188' } }),
  )
  const recon = reconcileWorkflowIds()
  assert.ok(recon.minted >= 1, 'minted the folder without an id')
  assert.ok(recon.deduped >= 1, 'deduped the shared id')
  assert.ok(recon.seeded >= 1, 'seeded the real binding into the envtable')
  const boundId = readWorkflowUuid(join(dir, 'recon-bound'))!
  assert.equal(getEnvServerUrl(boundId), 'https://company.internal:8188', 'seeded verbatim')
  const idA = readWorkflowUuid(join(dir, 'recon-a'))
  const idB = readWorkflowUuid(join(dir, 'recon-b'))
  assert.equal(idA, 'shared') // lexically-first keeps it
  assert.ok(idB && idB !== 'shared', 'duplicate copy got an independent id')
  assert.ok(readWorkflowUuid(join(dir, 'recon-noid')), 'id-less folder was minted')
  // idempotent: a second reconcile is a no-op
  const recon2 = reconcileWorkflowIds()
  assert.equal(recon2.minted, 0)
  assert.equal(recon2.deduped, 0)

  console.log('check-envtable: OK')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
