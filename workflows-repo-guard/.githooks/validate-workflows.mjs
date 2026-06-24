#!/usr/bin/env node
/**
 * Repo-side workflow validator — the backstop for any client that committed
 * WITHOUT the serverUrl clean/smudge filter configured (a clone that never
 * installed the CM git integration, or a hand edit straight to the repo). It
 * asserts that every committed workflow's `comfyui_config.serverUrl` is
 * sanitized to the localhost placeholder (http://127.0.0.1:8188). A real URL,
 * an IP, or an unresolved `<globalEnv.x>` expression means the filter never ran
 * — the env-specific binding leaked into git.
 *
 * On a sanitization failure it exits 1 AND, when DISCORD_WEBHOOK_URL is set (CI
 * only — never locally), posts a notice naming the affected workflows. Invalid
 * JSON in params.json / workflow.json also fails the build.
 *
 * Plain Node, zero deps (global fetch for the Discord post). Wire-up: README.md.
 *
 * Usage:  node validate-workflows.mjs [rootDir]   (default: cwd)
 *         node validate-workflows.mjs --selftest
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PLACEHOLDER = 'http://127.0.0.1:8188'

/** A serverUrl ref is sanitized iff it points at a loopback host — the clean
 *  filter always writes exactly PLACEHOLDER; other loopback spellings are
 *  harmless and accepted. A real host/IP, an unparseable value, or a
 *  `<globalEnv.x>` expression is NOT sanitized: the filter never ran. */
export function isSanitized(ref) {
  if (ref === PLACEHOLDER) return true
  if (typeof ref !== 'string') return false
  let host
  try {
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) ? ref : `http://${ref}`,
    ).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
}

function serverRefs(params) {
  const raw = params && params.comfyui_config ? params.comfyui_config.serverUrl : undefined
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return list.filter((u) => typeof u === 'string' && u.trim() !== '')
}

function prettify(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The workflow's display name (params.label, falling back to a prettified
 *  folder slug) — what users recognize, used in the Discord notice. */
function displayName(folder, params) {
  const label = params && typeof params.label === 'string' ? params.label.trim() : ''
  return label || prettify(folder)
}

/** Validate every workflow folder under `root` (descending into a `workflows/`
 *  subfolder if present, so this works from the repo root or the workflows dir).
 *  Returns { violations, affected }: violations are console/exit lines; affected
 *  are the DISPLAY NAMES of workflows whose serverUrl is unsanitized. */
export function validateRepo(root) {
  const violations = []
  const affected = []
  const sub = join(root, 'workflows') // GitHub repo layout: workflows under workflows/
  if (existsSync(sub)) {
    try {
      readdirSync(sub)
      root = sub
    } catch {
      /* not a dir — scan root as-is */
    }
  }
  let dirs
  try {
    dirs = readdirSync(root, { withFileTypes: true })
  } catch (e) {
    return { violations: [`cannot read ${root}: ${e.message}`], affected: [] }
  }
  for (const e of dirs) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'script') continue
    const paramsPath = join(root, e.name, 'params.json')
    if (existsSync(paramsPath)) {
      let params = null
      try {
        params = JSON.parse(readFileSync(paramsPath, 'utf-8'))
      } catch {
        violations.push(`${e.name}/params.json: invalid JSON`)
      }
      if (params) {
        const bad = serverRefs(params).filter((ref) => !isSanitized(ref))
        if (bad.length) {
          violations.push(
            `${e.name}/params.json: unsanitized serverUrl ${bad.map((b) => `"${b}"`).join(', ')} — expected ${PLACEHOLDER}`,
          )
          affected.push(displayName(e.name, params))
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
  return { violations, affected }
}

/** The Discord message body — kept pure (env passed in) so it's unit-testable
 *  and matches the agreed format exactly. Caps the list so it can't blow past
 *  Discord's 2000-char limit. */
export function buildDiscordContent(affected, env = process.env) {
  const repo = (env.GITHUB_REPOSITORY || 'workflows').split('/').pop()
  const branch = env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF || 'unknown'
  const author = env.GITHUB_ACTOR || 'unknown'
  const shown = affected.slice(0, 25)
  const more = affected.length - shown.length
  const list = shown.map((n) => `- ${n}`).join('\n') + (more > 0 ? `\n- …and ${more} more` : '')
  return [
    '❌ Workflow sanitization failed',
    `Repository: ${repo}`,
    `Branch: ${branch}`,
    `Author: ${author}`,
    'Unsanitized workflow serverUrl detected.',
    'Affected workflows:',
    list,
    `Expected: serverUrl = ${PLACEHOLDER}`,
    'Please install/update Git integration in CM and retry.',
  ].join('\n')
}

/** Post the notice to Discord when DISCORD_WEBHOOK_URL is set (CI only).
 *  Best-effort: a webhook failure must never mask the validation exit code. */
async function notifyDiscord(affected) {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url || affected.length === 0) return
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: buildDiscordContent(affected) }),
    })
    if (!res.ok) console.error(`Discord notify failed: ${res.status}`)
  } catch (err) {
    console.error('Discord notify error:', err.message)
  }
}

function selftest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error('SELFTEST FAIL:', msg)
      process.exit(1)
    }
  }
  assert(isSanitized('http://127.0.0.1:8188'), 'placeholder passes')
  assert(isSanitized('http://localhost:8188'), 'localhost passes')
  assert(!isSanitized('http://10.0.0.7:8188'), 'real IP fails')
  assert(!isSanitized('http://gpu-01.corp:8188'), 'real host fails')
  assert(!isSanitized('<globalEnv.serverPool1>'), 'expression fails (filter never ran)')
  assert(!isSanitized('not a url'), 'garbage fails')
  console.log('validate-workflows --selftest: OK')
}

// Entry point — skipped when imported (e.g. by the test).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('validate-workflows.mjs')
if (invokedDirectly) {
  if (process.argv.includes('--selftest')) {
    selftest()
  } else {
    const root = process.argv[2] || process.cwd()
    const { violations, affected } = validateRepo(root)
    if (violations.length > 0) {
      console.error('Workflow validation FAILED:\n' + violations.map((v) => '  - ' + v).join('\n'))
      await notifyDiscord(affected)
      process.exit(1)
    }
    console.log('Workflow validation passed.')
  }
}
