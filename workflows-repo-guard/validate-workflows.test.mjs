/**
 * Self-check for the repo-side validator. No framework — run:
 *   node validate-workflows.test.mjs
 * Builds throwaway workflow fixtures and asserts the validator flags any
 * unsanitized serverUrl (real URL, IP, or <globalEnv.x> expression) + invalid
 * JSON, passes the localhost placeholder, and that the Discord notice matches
 * the agreed format.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRepo, isSanitized, buildDiscordContent } from './.githooks/validate-workflows.mjs'

// unit: the core predicate
assert.equal(isSanitized('http://127.0.0.1:8188'), true)
assert.equal(isSanitized('http://localhost:8188'), true)
assert.equal(isSanitized('http://10.0.0.7:8188'), false)
assert.equal(isSanitized('<globalEnv.serverPool1>'), false) // an expression in git = filter never ran

const root = mkdtempSync(join(tmpdir(), 'wf-validate-'))
const wf = (name, params, workflowJson) => {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'params.json'), params)
  if (workflowJson !== undefined) writeFileSync(join(root, name, 'workflow.json'), workflowJson)
}
try {
  wf('placeholder', JSON.stringify({ comfyui_config: { serverUrl: 'http://127.0.0.1:8188' } }))
  wf('localhost', JSON.stringify({ comfyui_config: { serverUrl: 'http://localhost:8188' } }))
  wf('apply-vinyl-wrap', JSON.stringify({ label: 'Apply Vinyl Wrap', comfyui_config: { serverUrl: 'http://10.0.0.7:8188' } }), '{}')
  wf('resize-product-image', JSON.stringify({ comfyui_config: { serverUrl: '<globalEnv.serverPool1>' } }))
  wf('pool', JSON.stringify({ comfyui_config: { serverUrl: ['http://127.0.0.1:8188', 'http://1.2.3.4:8188'] } }))
  wf('badjson', '{ not valid')
  wf('badworkflow', JSON.stringify({}), '{ broken')

  const { violations, affected } = validateRepo(root)

  // unsanitized serverUrls flagged, each contributing one violation + one affected name
  assert.ok(violations.some((x) => x.startsWith('apply-vinyl-wrap/params.json: unsanitized')), 'literal URL not flagged')
  assert.ok(violations.some((x) => x.startsWith('resize-product-image/params.json: unsanitized')), 'expression not flagged')
  assert.ok(violations.some((x) => x.startsWith('pool/params.json: unsanitized')), 'literal in pool not flagged')
  // invalid JSON still fails the build
  assert.ok(violations.some((x) => x === 'badjson/params.json: invalid JSON'), 'invalid params JSON not flagged')
  assert.ok(violations.some((x) => x === 'badworkflow/workflow.json: invalid JSON'), 'invalid workflow JSON not flagged')
  // sanitized workflows are clean
  assert.ok(!violations.some((x) => x.startsWith('placeholder/') || x.startsWith('localhost/')), 'sanitized workflows wrongly flagged')

  // affected uses display names: label when present, prettified slug otherwise
  assert.ok(affected.includes('Apply Vinyl Wrap'), 'label-based display name missing')
  assert.ok(affected.includes('Resize Product Image'), 'prettified slug display name missing')
  assert.ok(!affected.includes('Placeholder'), 'sanitized workflow leaked into affected')

  // Discord message format (pure, env injected)
  const content = buildDiscordContent(['Apply Vinyl Wrap', 'Resize Product Image'], {
    GITHUB_REPOSITORY: 'gear/workflows',
    GITHUB_REF_NAME: 'feature/new-workflow',
    GITHUB_ACTOR: 'John Doe',
  })
  assert.ok(content.startsWith('❌ Workflow sanitization failed'))
  assert.ok(content.includes('Repository: workflows'))
  assert.ok(content.includes('Branch: feature/new-workflow'))
  assert.ok(content.includes('Author: John Doe'))
  assert.ok(content.includes('- Apply Vinyl Wrap\n- Resize Product Image'))
  assert.ok(content.includes('Expected: serverUrl = http://127.0.0.1:8188'))
  assert.ok(content.includes('Please install/update Git integration in CM and retry.'))

  console.log('validate-workflows.test: OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
