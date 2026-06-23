#!/usr/bin/env node
/**
 * Repo-side workflow validator — the guard for the Claude-DIRECT git path that
 * bypasses Coffee Maker's in-app validate-on-publish. Mirrors that check so the
 * two can't disagree.
 *
 * Run against a checkout (or extracted tree) of the workflows repo. Exits 1 and
 * prints every violation if any workflow:
 *   - has invalid JSON in params.json or workflow.json, or
 *   - has a comfyui_config.serverUrl that is a LITERAL, non-loopback URL/IP.
 *     Real server URLs are env-specific (effectively secrets) and must be bound
 *     to a `globalEnv.<key>` token instead; `127.0.0.1` / `localhost` are fine
 *     as unbound placeholders.
 *
 * Plain Node, zero dependencies — safe to drop into a pre-receive hook or CI.
 * Wire-up: see README.md in this folder.
 *
 * Usage:  node validate-workflows.mjs [rootDir]        (default: cwd)
 *         node validate-workflows.mjs --selftest        (runs built-in checks)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** A literal server URL pointing at a real (non-loopback) host — what must NOT
 *  be committed. Tokens (`globalEnv.*`) and loopback placeholders pass; an
 *  unparseable literal is treated as a violation (fail safe). */
export function isLiteralRealUrl(ref) {
  if (typeof ref !== 'string') return false
  if (ref.startsWith('globalEnv.')) return false
  let host
  try {
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) ? ref : `http://${ref}`,
    ).hostname.toLowerCase()
  } catch {
    return true
  }
  return !(
    host === '' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  )
}

function serverRefs(params) {
  const raw = params && params.comfyui_config ? params.comfyui_config.serverUrl : undefined
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return list.filter((u) => typeof u === 'string' && u.trim() !== '')
}

/** Validate every workflow folder under `root`. Returns a list of violations. */
export function validateRepo(root) {
  const violations = []
  let dirs
  try {
    dirs = readdirSync(root, { withFileTypes: true })
  } catch (e) {
    return [`cannot read ${root}: ${e.message}`]
  }
  for (const e of dirs) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'script') continue
    const paramsPath = join(root, e.name, 'params.json')
    if (existsSync(paramsPath)) {
      let params
      try {
        params = JSON.parse(readFileSync(paramsPath, 'utf-8'))
      } catch {
        violations.push(`${e.name}/params.json: invalid JSON`)
        params = null
      }
      if (params) {
        for (const ref of serverRefs(params)) {
          if (isLiteralRealUrl(ref)) {
            violations.push(
              `${e.name}/params.json: literal server URL "${ref}" — bind it to a globalEnv key`,
            )
          }
        }
      }
    }
    const wfPath = join(root, e.name, 'workflow.json')
    if (existsSync(wfPath)) {
      try {
        JSON.parse(readFileSync(wfPath, 'utf-8'))
      } catch {
        violations.push(`${e.name}/workflow.json: invalid JSON`)
      }
    }
  }
  return violations
}

function selftest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error('SELFTEST FAIL:', msg)
      process.exit(1)
    }
  }
  // literal real URLs / IPs are violations
  assert(isLiteralRealUrl('http://10.0.0.7:8188'), 'real IP should be rejected')
  assert(isLiteralRealUrl('http://gpu-01.corp:8188'), 'real host should be rejected')
  assert(isLiteralRealUrl('not a url'), 'unparseable should be rejected (fail safe)')
  // tokens + loopback placeholders pass
  assert(!isLiteralRealUrl('globalEnv.videoServer'), 'token should pass')
  assert(!isLiteralRealUrl('http://127.0.0.1:8188'), 'loopback should pass')
  assert(!isLiteralRealUrl('http://localhost:8188'), 'localhost should pass')
  console.log('validate-workflows --selftest: OK')
}

// Entry point — skipped when imported (e.g. by the test).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('validate-workflows.mjs')
if (invokedDirectly) {
  if (process.argv.includes('--selftest')) {
    selftest()
  } else {
    const root = process.argv[2] || process.cwd()
    const violations = validateRepo(root)
    if (violations.length > 0) {
      console.error('Workflow validation FAILED:\n' + violations.map((v) => '  - ' + v).join('\n'))
      process.exit(1)
    }
    console.log('Workflow validation passed.')
  }
}
