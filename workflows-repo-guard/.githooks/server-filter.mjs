#!/usr/bin/env node
/**
 * git clean/smudge filter for workflow server URLs — the mechanism that keeps
 * real, env-specific serverUrls out of git while leaving them live in the
 * working tree. Lives in the WORKFLOWS repo so EVERY client runs it (CM, a
 * user's clone, Claude editing the checkout directly).
 *
 *   clean   (params.json → git): record the real `comfyui_config.serverUrl` to
 *           the gitignored workflow-envtable.json (keyed by the workflow's
 *           metadata.json id, stored verbatim) and emit the file with serverUrl
 *           forced to http://127.0.0.1:8188. Git only ever stores localhost.
 *   smudge  (git → params.json): restore the real serverUrl from the envtable.
 *           No entry (e.g. a fresh clone with no envtable) → leave the
 *           placeholder, i.e. fall back to whatever serverUrl is in git.
 *
 * Wire-up per clone (NOT committed — git config is local; CM auto-installs it,
 * raw users run install-filter.mjs):
 *   git config filter.cmserver.clean  "node .githooks/server-filter.mjs clean %f"
 *   git config filter.cmserver.smudge "node .githooks/server-filter.mjs smudge %f"
 * with `** /params.json filter=cmserver` (no space) in .gitattributes (committed).
 *
 * Zero-dep Node, stdin → stdout. NOT marked `required`, and it passes the file
 * through untouched on anything unexpected (wrong mode, non-params file,
 * unparseable JSON, no comfyui_config) — a filter that can't run must never be
 * able to wedge a git operation. The CI guard is the backstop that catches a
 * clone whose filter wasn't installed (real URL reaches git → fail + notify).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const PLACEHOLDER = 'http://127.0.0.1:8188'
const ENVTABLE = 'workflow-envtable.json'

const mode = process.argv[2]
const file = (process.argv[3] ?? '').replace(/\\/g, '/') // %f, repo-relative
const raw = readFileSync(0, 'utf-8') // stdin

process.stdout.write(run())

function run() {
  if ((mode !== 'clean' && mode !== 'smudge') || !file.endsWith('params.json')) return raw
  let params
  try {
    params = JSON.parse(raw)
  } catch {
    return raw // not our JSON — leave it alone
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) return raw
  const cfg = params.comfyui_config
  if (!cfg || typeof cfg !== 'object') return raw // nothing to strip / restore

  const folder = dirname(file) // workflows/my-wf
  const envtablePath = join(dirname(folder), ENVTABLE) // workflows/workflow-envtable.json

  if (mode === 'clean') {
    const serverUrl = cfg.serverUrl
    // Record the real binding (skip when it's only the placeholder / unset, so
    // git status doesn't mint ids or write the table for unbound workflows).
    if (serverUrl != null && !isPlaceholderOnly(serverUrl)) {
      recordBinding(envtablePath, ensureId(folder), serverUrl)
    }
    if ('serverUrl' in cfg) cfg.serverUrl = PLACEHOLDER
    return emit(params)
  }

  // smudge — restore, read-only (never mints an id)
  const id = readId(folder)
  if (id) {
    const restored = readTable(envtablePath)[id]?.serverUrl
    if (restored != null) cfg.serverUrl = restored
  }
  return emit(params)
}

/** Match writeParams in CM (2-space, no trailing newline) so a CM-written
 *  working-tree file and this filter's output are byte-identical — no churn. */
function emit(params) {
  return JSON.stringify(params, null, 2)
}

/** True when every ref is a loopback placeholder (or the value is empty). An
 *  expression like `<globalEnv.x>` is NOT a URL → not placeholder → recorded. */
function isPlaceholderOnly(v) {
  const list = Array.isArray(v) ? v : [v]
  if (list.length === 0) return true
  return list.every((u) => {
    if (typeof u !== 'string') return false
    let host
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `http://${u}`).hostname.toLowerCase()
    } catch {
      return false
    }
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0'
  })
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readTable(path) {
  const t = readJson(path)
  return t && typeof t === 'object' && !Array.isArray(t) ? t : {}
}

function recordBinding(path, id, serverUrl) {
  const t = readTable(path)
  if (JSON.stringify(t[id]?.serverUrl) === JSON.stringify(serverUrl)) return // unchanged
  t[id] = { serverUrl }
  try {
    writeFileSync(path, JSON.stringify(t, null, 2) + '\n')
  } catch {
    /* best-effort — a write failure must not break the commit */
  }
}

function readId(folder) {
  const m = readJson(join(folder, 'metadata.json'))
  return m && typeof m.id === 'string' && m.id ? m.id : null
}

/** Read the workflow's id, minting + persisting one when absent (matches CM's
 *  ensureWorkflowUuid). Only ever called from clean when there's a real binding
 *  to key, so an unbound workflow never gets one as a status side effect. */
function ensureId(folder) {
  const existing = readId(folder)
  if (existing) return existing
  const p = join(folder, 'metadata.json')
  const meta = readJson(p) ?? {}
  const obj = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
  obj.id = randomUUID()
  try {
    mkdirSync(folder, { recursive: true })
    writeFileSync(p, JSON.stringify(obj, null, 2) + '\n')
  } catch {
    /* best-effort */
  }
  return obj.id
}
