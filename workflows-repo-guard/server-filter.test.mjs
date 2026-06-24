#!/usr/bin/env node
/**
 * Round-trip test for server-filter.mjs. Builds a throwaway repo layout, runs
 * the filter exactly as git would (cwd = worktree root, %f = repo-relative
 * path, params on stdin), and asserts clean strips + records and smudge
 * restores. No deps. Run: node server-filter.test.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILTER = join(dirname(fileURLToPath(import.meta.url)), '.githooks', 'server-filter.mjs')
const PLACEHOLDER = 'http://127.0.0.1:8188'
const root = mkdtempSync(join(tmpdir(), 'cm-filter-'))

// git runs the filter from the worktree root with the repo-relative path as %f.
function filter(mode, relPath, input) {
  return execFileSync('node', [FILTER, mode, relPath], { cwd: root, input, encoding: 'utf-8' })
}
const wfDir = (slug) => join('workflows', slug)
function setup(slug, params) {
  mkdirSync(join(root, wfDir(slug)), { recursive: true })
  writeFileSync(join(root, wfDir(slug), 'params.json'), JSON.stringify(params, null, 2))
}
const params = (serverUrl) => ({ label: 'X', comfyui_config: { workflow: 'workflow.json', serverUrl } })
const envtablePath = join(root, 'workflows', 'workflow-envtable.json')
const readEnvtable = () => JSON.parse(readFileSync(envtablePath, 'utf-8'))
const serverUrlOf = (clean) => JSON.parse(clean).comfyui_config.serverUrl

try {
  // ── literal real URL: clean strips to localhost + records, smudge restores ──
  setup('wf-lit', params('https://company.internal:8188'))
  const litRel = join(wfDir('wf-lit'), 'params.json')
  const litClean = filter('clean', litRel, JSON.stringify(params('https://company.internal:8188'), null, 2))
  assert.equal(serverUrlOf(litClean), PLACEHOLDER, 'clean forces localhost')
  const litId = JSON.parse(readFileSync(join(root, wfDir('wf-lit'), 'metadata.json'), 'utf-8')).id
  assert.match(litId, /^[0-9a-f-]{36}$/, 'clean minted a uuid')
  assert.equal(readEnvtable()[litId].serverUrl, 'https://company.internal:8188', 'recorded verbatim')
  assert.equal(serverUrlOf(filter('smudge', litRel, litClean)), 'https://company.internal:8188', 'smudge restores')

  // ── globalEnv expression: preserved verbatim, NOT resolved ──
  setup('wf-expr', params('<globalEnv.serverPool1>'))
  const exprRel = join(wfDir('wf-expr'), 'params.json')
  const exprClean = filter('clean', exprRel, JSON.stringify(params('<globalEnv.serverPool1>'), null, 2))
  assert.equal(serverUrlOf(exprClean), PLACEHOLDER)
  const exprId = JSON.parse(readFileSync(join(root, wfDir('wf-expr'), 'metadata.json'), 'utf-8')).id
  assert.equal(readEnvtable()[exprId].serverUrl, '<globalEnv.serverPool1>', 'expression stored as-is')
  assert.equal(serverUrlOf(filter('smudge', exprRel, exprClean)), '<globalEnv.serverPool1>')

  // ── pool array: stored + restored as an array ──
  const pool = ['http://10.0.0.8:8188', 'http://10.0.0.9:8188']
  setup('wf-pool', params(pool))
  const poolRel = join(wfDir('wf-pool'), 'params.json')
  const poolClean = filter('clean', poolRel, JSON.stringify(params(pool), null, 2))
  assert.equal(serverUrlOf(poolClean), PLACEHOLDER)
  const poolId = JSON.parse(readFileSync(join(root, wfDir('wf-pool'), 'metadata.json'), 'utf-8')).id
  assert.deepEqual(readEnvtable()[poolId].serverUrl, pool)
  assert.deepEqual(serverUrlOf(filter('smudge', poolRel, poolClean)), pool)

  // ── already localhost: no id minted, no envtable entry, passes through ──
  setup('wf-local', params(PLACEHOLDER))
  const localRel = join(wfDir('wf-local'), 'params.json')
  filter('clean', localRel, JSON.stringify(params(PLACEHOLDER), null, 2))
  assert.ok(!existsSync(join(root, wfDir('wf-local'), 'metadata.json')), 'unbound workflow gets no id')

  // ── fresh-clone fallback: committed localhost + id, but no envtable entry ──
  setup('wf-fresh', params(PLACEHOLDER))
  writeFileSync(
    join(root, wfDir('wf-fresh'), 'metadata.json'),
    JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' }),
  )
  const freshRel = join(wfDir('wf-fresh'), 'params.json')
  // (envtable has no entry for this id) → smudge leaves the placeholder
  assert.equal(serverUrlOf(filter('smudge', freshRel, JSON.stringify(params(PLACEHOLDER), null, 2))), PLACEHOLDER)

  // ── idempotent: re-clean an unchanged binding doesn't rewrite the table ──
  const before = readFileSync(envtablePath, 'utf-8')
  filter('clean', litRel, JSON.stringify(params('https://company.internal:8188'), null, 2))
  assert.equal(readFileSync(envtablePath, 'utf-8'), before, 'no-op clean leaves envtable byte-identical')

  // ── non-params / unparseable / no comfyui_config → pass through untouched ──
  assert.equal(filter('clean', 'workflows/x/workflow.json', '{"nodes":1}'), '{"nodes":1}')
  assert.equal(filter('clean', join(wfDir('wf-lit'), 'params.json'), 'not json'), 'not json')
  assert.equal(filter('clean', join(wfDir('wf-lit'), 'params.json'), '{"label":"x"}'), '{"label":"x"}')

  console.log('server-filter.test: OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
