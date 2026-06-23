/**
 * Self-check for the repo-side validator. No framework — run:
 *   node git-hooks/validate-workflows.test.mjs
 * Builds throwaway workflow fixtures in a temp dir and asserts the validator
 * flags literal URLs + invalid JSON and passes clean tokens/placeholders.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRepo, isLiteralRealUrl } from './validate-workflows.mjs'

// unit: the core predicate
assert.equal(isLiteralRealUrl('http://10.0.0.7:8188'), true)
assert.equal(isLiteralRealUrl('globalEnv.pool'), false)
assert.equal(isLiteralRealUrl('http://127.0.0.1:8188'), false)

const root = mkdtempSync(join(tmpdir(), 'wf-validate-'))
const wf = (name, params, workflowJson) => {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'params.json'), params)
  if (workflowJson !== undefined) writeFileSync(join(root, name, 'workflow.json'), workflowJson)
}
try {
  wf('bound', JSON.stringify({ comfyui_config: { serverUrl: 'globalEnv.videoServer' } }), '{}')
  wf('placeholder', JSON.stringify({ comfyui_config: { serverUrl: 'http://127.0.0.1:8188' } }))
  wf('literal', JSON.stringify({ comfyui_config: { serverUrl: 'http://10.0.0.7:8188' } }))
  wf('pool', JSON.stringify({ comfyui_config: { serverUrl: ['globalEnv.a', 'http://1.2.3.4:8188'] } }))
  wf('badjson', '{ not valid')
  wf('badworkflow', JSON.stringify({}), '{ broken')

  const v = validateRepo(root)
  // bound + placeholder are clean; the rest each contribute one violation
  assert.ok(
    v.some((x) => x.startsWith('literal/params.json: literal server URL')),
    'literal URL not flagged',
  )
  assert.ok(
    v.some((x) => x.startsWith('pool/params.json: literal server URL')),
    'literal in pool not flagged',
  )
  assert.ok(v.some((x) => x === 'badjson/params.json: invalid JSON'), 'invalid params JSON not flagged')
  assert.ok(
    v.some((x) => x === 'badworkflow/workflow.json: invalid JSON'),
    'invalid workflow JSON not flagged',
  )
  assert.ok(
    !v.some((x) => x.startsWith('bound/') || x.startsWith('placeholder/')),
    'clean workflows wrongly flagged',
  )
  console.log('validate-workflows.test: OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
