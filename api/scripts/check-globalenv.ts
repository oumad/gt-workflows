/**
 * Self-check for the globalEnv binding RESOLVER (read-only; CM no longer writes
 * WS config). No framework, no file IO — run:
 *   npx tsx scripts/check-globalenv.ts
 */
import assert from 'node:assert/strict'
import { resolveServerRef, serverRefKey } from '../src/services/globalEnv.js'

const map = {
  videoServer: 'http://10.0.0.7:8188',
  pool: ['http://10.0.0.8:8188', 'http://10.0.0.9:8188'],
  default: 'http://127.0.0.1:8188',
}

// literals pass through
assert.deepEqual(resolveServerRef('http://host:8188', map), ['http://host:8188'])
assert.deepEqual(resolveServerRef('127.0.0.1:8188', map), ['127.0.0.1:8188'])

// `<globalEnv.key>` expressions resolve against the WS-config map (pool expands)
assert.deepEqual(resolveServerRef('<globalEnv.videoServer>', map), ['http://10.0.0.7:8188'])
assert.deepEqual(resolveServerRef('<globalEnv.pool>', map), [
  'http://10.0.0.8:8188',
  'http://10.0.0.9:8188',
])
// missing key → default → localhost; both fallbacks never throw
assert.deepEqual(resolveServerRef('<globalEnv.nope>', map), ['http://127.0.0.1:8188'])
assert.deepEqual(resolveServerRef('<globalEnv.x>', { other: 'http://y' }), ['http://127.0.0.1:8188'])
assert.deepEqual(resolveServerRef('<globalEnv.x>', { default: 'http://d:1' }), ['http://d:1'])

// legacy bare form still recognized (pre-rework data)
assert.deepEqual(resolveServerRef('globalEnv.videoServer', map), ['http://10.0.0.7:8188'])

assert.equal(serverRefKey('<globalEnv.foo>'), 'foo')
assert.equal(serverRefKey('globalEnv.foo'), 'foo')
assert.equal(serverRefKey('http://foo'), null)
assert.equal(serverRefKey('<globalEnv.bad key>'), null) // space → not a key

console.log('check-globalenv(resolve): OK')
