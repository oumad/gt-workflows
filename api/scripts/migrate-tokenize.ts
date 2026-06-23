/**
 * One-time tokenization migration.
 *
 * For every workflow whose `comfyui_config.serverUrl` holds a LITERAL real URL,
 * lift that URL into the env's globalEnv under a generated key
 * (`url_<camelCaseId>`, SHARED across workflows that point at the same server
 * set so a pool/role emerges instead of N duplicate keys) and rewrite the
 * workflow's serverUrl to the `globalEnv.<key>` token. Localhost placeholders
 * and already-tokenized refs are left untouched.
 *
 *   npx tsx scripts/migrate-tokenize.ts            # dry-run report (no writes)
 *   WS_CONFIG_PATH=... npx tsx scripts/migrate-tokenize.ts --apply
 *
 * Dry-run needs nothing; --apply needs WS_CONFIG_PATH (it writes globalEnv).
 * The workflow repo (git) is the safety net for the params rewrites — review
 * the diff / revert if needed.
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getWorkflowsDir } from '../src/lib/workflowFs.js'
import {
  readParams,
  writeParams,
  comfyServerRefs,
  setComfyServerUrls,
  slugify,
  isLiteralRealUrl,
  canonicalKey,
} from '../src/services/workflows.js'
import { setGlobalEnvKeys } from '../src/services/globalEnv.js'

const apply = process.argv.includes('--apply')

const dir = getWorkflowsDir()
if (!existsSync(dir)) {
  console.error(`No workflows directory at ${dir}`)
  process.exit(1)
}

const sigToKey = new Map<string, string>() // server-set signature → shared key
const keyToUrls: Record<string, string[]> = {} // key → real URLs (the binding value)
const rewrites: Array<{ folder: string; newRefs: string[] }> = []
let skipped = 0

for (const entry of readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'script') continue
  const refs = comfyServerRefs(readParams(join(dir, entry.name)))
  const realUrls = refs.filter(isLiteralRealUrl).map((u) => u.replace(/\/+$/, ''))
  if (realUrls.length === 0) {
    skipped++
    continue
  }

  const sig = [...realUrls].sort().join('\n')
  let key = sigToKey.get(sig)
  if (!key) {
    let candidate = canonicalKey(slugify(entry.name))
    for (let n = 2; candidate in keyToUrls; n++)
      candidate = `${canonicalKey(slugify(entry.name))}_${n}`
    key = candidate
    sigToKey.set(sig, key)
    keyToUrls[key] = realUrls
  }
  const token = `globalEnv.${key}`
  const newRefs = [...new Set(refs.map((r) => (isLiteralRealUrl(r) ? token : r)))]
  rewrites.push({ folder: entry.name, newRefs })
}

console.log(`\nTokenization migration — ${apply ? 'APPLY' : 'DRY RUN'}`)
console.log(`  workflows to tokenize : ${rewrites.length}`)
console.log(`  skipped (token/localhost/none) : ${skipped}`)
console.log(`  globalEnv keys to create : ${Object.keys(keyToUrls).length}`)
for (const [k, urls] of Object.entries(keyToUrls)) console.log(`    + ${k} = ${urls.join(', ')}`)
for (const r of rewrites) console.log(`    · ${r.folder} → ${r.newRefs.join(', ')}`)

if (!apply) {
  console.log('\nDry run only — re-run with --apply (and WS_CONFIG_PATH set) to write.')
  process.exit(0)
}
if (Object.keys(keyToUrls).length === 0) {
  console.log('\nNothing to migrate.')
  process.exit(0)
}

setGlobalEnvKeys(keyToUrls) // one snapshot + write for all keys
for (const r of rewrites) {
  const folderPath = join(dir, r.folder)
  const params = readParams(folderPath)
  setComfyServerUrls(params, r.newRefs)
  writeParams(folderPath, params)
}
console.log(`\nApplied: ${Object.keys(keyToUrls).length} keys, ${rewrites.length} workflows rewritten.`)
