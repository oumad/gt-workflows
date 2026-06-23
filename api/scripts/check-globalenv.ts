/**
 * Self-check for the globalEnv binding resolver + writer. No framework — run:
 *   npx tsx scripts/check-globalenv.ts
 * The read part (resolveServerRef) runs against an explicit map (no file IO).
 * The write part (setGlobalEnvKey) runs only when WS_CONFIG_PATH points at a
 * throwaway file, e.g.:
 *   WS_CONFIG_PATH=/tmp/cm-ws/config.json npx tsx scripts/check-globalenv.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  resolveServerRef,
  serverRefKey,
  setGlobalEnvKey,
  reconcileGlobalEnv,
  loadGlobalEnv,
} from '../src/services/globalEnv.js'

/* ── resolve (pure) ─────────────────────────────────────────── */
const map = {
  videoServer: 'http://10.0.0.7:8188',
  pool: ['http://10.0.0.8:8188', 'http://10.0.0.9:8188'],
  default: 'http://127.0.0.1:8188',
}
assert.deepEqual(resolveServerRef('http://host:8188', map), ['http://host:8188'])
assert.deepEqual(resolveServerRef('127.0.0.1:8188', map), ['127.0.0.1:8188'])
assert.deepEqual(resolveServerRef('globalEnv.videoServer', map), ['http://10.0.0.7:8188'])
assert.deepEqual(resolveServerRef('globalEnv.pool', map), [
  'http://10.0.0.8:8188',
  'http://10.0.0.9:8188',
])
assert.deepEqual(resolveServerRef('globalEnv.nope', map), ['http://127.0.0.1:8188'])
// unresolved + no default → localhost placeholder (never throws)
assert.deepEqual(resolveServerRef('globalEnv.x', { other: 'http://y' }), ['http://127.0.0.1:8188'])
assert.deepEqual(resolveServerRef('globalEnv.x', { default: 'http://d:1' }), ['http://d:1'])
assert.equal(serverRefKey('globalEnv.foo'), 'foo')
assert.equal(serverRefKey('http://foo'), null)
console.log('check-globalenv(resolve): OK')

/* ── write (needs a throwaway WS_CONFIG_PATH) ───────────────── */
type Doc = { workflowStudio: { globalEnv: Record<string, string | string[]> } }
const wsPath = process.env.WS_CONFIG_PATH
if (wsPath) {
  const histDir = join(dirname(wsPath), '.history')
  mkdirSync(dirname(wsPath), { recursive: true })
  rmSync(wsPath, { force: true })
  rmSync(histDir, { recursive: true, force: true })

  // 1. create (file absent) — single URL stored as a string
  setGlobalEnvKey('videoServer', ['http://10.0.0.7:8188'])
  let doc = JSON.parse(readFileSync(wsPath, 'utf-8')) as Doc
  assert.equal(doc.workflowStudio.globalEnv.videoServer, 'http://10.0.0.7:8188')
  assert.equal(loadGlobalEnv().videoServer, 'http://10.0.0.7:8188')

  // 2. add a pool key — preserves the first key, stores several as an array
  setGlobalEnvKey('pool', ['http://a:8188', 'http://b:8188'])
  doc = JSON.parse(readFileSync(wsPath, 'utf-8')) as Doc
  assert.equal(doc.workflowStudio.globalEnv.videoServer, 'http://10.0.0.7:8188')
  assert.deepEqual(doc.workflowStudio.globalEnv.pool, ['http://a:8188', 'http://b:8188'])
  // pre-overwrite snapshot landed in .history
  assert.ok(existsSync(histDir) && readdirSync(histDir).length >= 1)

  // 3. deliberate overwrite of an existing key
  setGlobalEnvKey('videoServer', ['http://new:8188'])
  assert.equal(loadGlobalEnv().videoServer, 'http://new:8188')

  // 4. invalid key / empty urls rejected
  assert.throws(() => setGlobalEnvKey('bad key', ['http://x']))
  assert.throws(() => setGlobalEnvKey('ok', ['  ']))

  // 5. additive reconcile — THE invariant: existing keys are never touched,
  //    only missing (non-default) keys are added, defaulted to localhost.
  const before = JSON.parse(readFileSync(wsPath, 'utf-8')) as Doc
  const r = reconcileGlobalEnv(['videoServer', 'freshKey', 'default'])
  // 'videoServer' exists → untouched; 'freshKey' added; 'default' ensured.
  assert.deepEqual([...r.added].sort(), ['default', 'freshKey'])
  const after = JSON.parse(readFileSync(wsPath, 'utf-8')) as Doc
  assert.deepEqual(after.workflowStudio.globalEnv.videoServer, before.workflowStudio.globalEnv.videoServer)
  assert.deepEqual(after.workflowStudio.globalEnv.pool, before.workflowStudio.globalEnv.pool)
  assert.equal(after.workflowStudio.globalEnv.freshKey, 'http://127.0.0.1:8188')
  assert.equal(after.workflowStudio.globalEnv.default, 'http://127.0.0.1:8188')
  // idempotent: all referenced keys + default present → no additions, no overwrite
  assert.deepEqual(reconcileGlobalEnv(['videoServer', 'freshKey']).added, [])
  assert.deepEqual(
    (JSON.parse(readFileSync(wsPath, 'utf-8')) as Doc).workflowStudio.globalEnv.freshKey,
    'http://127.0.0.1:8188',
  )

  rmSync(wsPath, { force: true })
  rmSync(histDir, { recursive: true, force: true })
  console.log('check-globalenv(write+reconcile): OK')
} else {
  console.log('check-globalenv(write): skipped (set WS_CONFIG_PATH to run)')
}
