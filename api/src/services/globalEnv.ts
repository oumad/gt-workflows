/**
 * Resolve a workflow's server reference(s) to real URL(s).
 *
 * Workflows store `comfyui_config.serverUrl` as either a literal URL or a
 * `globalEnv.<key>` token — a stable, env-independent binding identity that
 * lives in git, never a real URL. The real URL for each token comes from
 * Workflow Studio's per-env config file (WS_CONFIG_PATH → `workflowStudio.
 * globalEnv`), a FLAT map `key -> url | url[]`. We load + cache that map and
 * reload it whenever the file's mtime changes.
 *
 * See the git-workflows-design note. This is the read-side; the in-app binding
 * editor and additive sync (write-side) come in a later increment.
 */
import { statSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { config } from '../config/index.js'
import { writeFileAtomic } from '../lib/workflowFs.js'
import { badRequest } from '../lib/httpError.js'

const PREFIX = 'globalEnv.'
/** Key used as the no-match fallback (per the design). */
const DEFAULT_KEY = 'default'
/** Binding keys are stable identifiers embedded in committed params (after the
 *  `globalEnv.` prefix) — keep them filename/identifier-safe. */
const KEY_RE = /^[A-Za-z0-9_-]+$/

export type GlobalEnvMap = Record<string, string | string[]>

// ponytail: single-process mtime cache. If WS config is ever shared by many
// readers needing sub-second freshness, switch to fs.watch.
let cache: { mtimeMs: number; map: GlobalEnvMap } | null = null

/** Load + cache `workflowStudio.globalEnv` (flat key -> url | url[]), reloading
 *  on mtime change. Returns `{}` when WS_CONFIG_PATH is unset or the file is
 *  missing / unreadable / malformed — so literal-URL workflows resolve
 *  identically whether or not a WS config exists (feature stays dark until the
 *  path is configured). */
export function loadGlobalEnv(): GlobalEnvMap {
  const path = config.WS_CONFIG_PATH
  if (!path) return {}
  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    cache = null
    return {}
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.map
  try {
    const json = JSON.parse(readFileSync(path, 'utf-8')) as {
      workflowStudio?: { globalEnv?: unknown }
    }
    const raw = json.workflowStudio?.globalEnv
    const map: GlobalEnvMap = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim() !== '') map[k] = v
        else if (Array.isArray(v)) {
          const urls = v.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
          if (urls.length) map[k] = urls
        }
      }
    }
    cache = { mtimeMs, map }
    return map
  } catch {
    cache = null
    return {}
  }
}

/** The binding key for a `globalEnv.<key>` token, or null for a literal URL. */
export function serverRefKey(entry: string): string | null {
  return entry.startsWith(PREFIX) ? entry.slice(PREFIX.length) : null
}

/** Copy the current WS config into a sibling `.history` dir before any
 *  overwrite. A data-loss guard, NOT best-effort: if we can't back it up we
 *  don't overwrite (the caller's throw aborts the edit). */
function snapshotConfig(path: string): void {
  const histDir = join(dirname(path), '.history')
  mkdirSync(histDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(path, join(histDir, `${basename(path)}.${stamp}`))
}

/** Read the WS config doc, snapshot it, apply `mutate` to its globalEnv map,
 *  then atomically write + reload — the single config-write chokepoint, so the
 *  snapshot + atomic-write + cache-bust live in one place. Throws (400) if
 *  WS_CONFIG_PATH is unset or the existing file is invalid JSON. */
function mutateConfig(mutate: (env: Record<string, unknown>) => void): GlobalEnvMap {
  const path = config.WS_CONFIG_PATH
  if (!path) throw badRequest('WS_CONFIG_PATH is not configured — cannot edit bindings')
  type Doc = Record<string, unknown> & {
    workflowStudio?: { globalEnv?: Record<string, unknown> } & Record<string, unknown>
  }
  let doc: Doc = {}
  if (existsSync(path)) {
    snapshotConfig(path) // data-loss guard, before we touch it
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) doc = parsed as Doc
    } catch {
      throw badRequest('WS config is not valid JSON — refusing to overwrite')
    }
  }
  const ws = (doc.workflowStudio ??= {})
  const env = (ws.globalEnv ??= {})
  mutate(env)
  writeFileAtomic(path, JSON.stringify(doc, null, 2) + '\n')
  cache = null // force a reload on next read (mtime would change anyway)
  return loadGlobalEnv()
}

/** Validate a key + normalize its URL list → single string or array. */
function normEntry(key: string, urls: string[]): string | string[] {
  if (!KEY_RE.test(key)) {
    throw badRequest(`Invalid binding key "${key}" (allowed: letters, digits, underscore, hyphen)`)
  }
  const clean = urls.map((u) => u.trim()).filter(Boolean)
  if (clean.length === 0) throw badRequest(`Binding "${key}": at least one URL is required`)
  return clean.length === 1 ? clean[0]! : clean
}

/** Set/replace ONE globalEnv key — the DELIBERATE human edit path (may
 *  overwrite an existing value; the additive sync path never does). Snapshots
 *  + atomic-writes, preserving every other key. */
export function setGlobalEnvKey(key: string, urls: string[]): GlobalEnvMap {
  const value = normEntry(key, urls)
  return mutateConfig((env) => {
    env[key] = value
  })
}

/** Set/replace MANY keys in ONE snapshot + write — used by the tokenization
 *  migration so it doesn't back up the config once per workflow. */
export function setGlobalEnvKeys(entries: Record<string, string[]>): GlobalEnvMap {
  const norm: Record<string, string | string[]> = {}
  for (const [k, urls] of Object.entries(entries)) norm[k] = normEntry(k, urls)
  if (Object.keys(norm).length === 0) return loadGlobalEnv()
  return mutateConfig((env) => {
    for (const [k, v] of Object.entries(norm)) env[k] = v
  })
}

/** Missing keys are seeded here (localhost placeholder) — a usable local URL
 *  plus a clear "this needs a real server" signal. */
const RECONCILE_DEFAULT = 'http://127.0.0.1:8188'

/** True when a binding resolves only to localhost placeholder(s) — i.e. it was
 *  auto-created by reconcile and still needs a real server bound. Drives the
 *  "N workflows need a server" nudge. */
export function isUnbound(value: string | string[]): boolean {
  const urls = Array.isArray(value) ? value : [value]
  if (urls.length === 0) return true
  return urls.every((u) => {
    let host: string
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `http://${u}`).hostname.toLowerCase()
    } catch {
      return false
    }
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0'
  })
}

/** Additive sync-reconcile: ensure a globalEnv key exists for every referenced
 *  token, creating any MISSING one defaulted to localhost. NEVER modifies or
 *  deletes an existing key — overwriting one would wipe the env's real server
 *  URLs (the data-loss invariant this whole model exists to protect). Only
 *  touches the file when something is actually added. No-op when WS_CONFIG_PATH
 *  is unset. Returns the keys it created. */
export function reconcileGlobalEnv(referencedKeys: string[]): { added: string[] } {
  if (!config.WS_CONFIG_PATH) return { added: [] }
  const existing = loadGlobalEnv()
  const ensure = referencedKeys.filter((k) => k !== DEFAULT_KEY && !(k in existing))
  // Always keep a `default` server so an unresolved binding resolves to it
  // rather than nothing (operators can point it at a real shared server).
  if (!(DEFAULT_KEY in existing)) ensure.push(DEFAULT_KEY)
  if (ensure.length === 0) return { added: [] }
  mutateConfig((env) => {
    // ADDITIVE ONLY: the `!(k in env)` guard is the invariant — never overwrite.
    for (const k of ensure) if (!(k in env)) env[k] = RECONCILE_DEFAULT
  })
  return { added: ensure }
}

/** Resolve one server entry to real URL(s):
 *   - `globalEnv.<key>` → map lookup (url or url[]), falling back to
 *     `globalEnv.default`, then to the localhost placeholder. NEVER throws —
 *     an unresolved binding dispatches to localhost (and the "N need a server"
 *     nudge flags it for binding) rather than surfacing as "no server".
 *   - literal URL / `127.0.0.1` / anything else → passthrough.
 *  Always returns an array, so a pool key (url[]) expands naturally. Pass an
 *  explicit `map` to resolve many entries against one snapshot. */
export function resolveServerRef(entry: string, map: GlobalEnvMap = loadGlobalEnv()): string[] {
  const key = serverRefKey(entry)
  if (key == null) return [entry]
  const hit = map[key] ?? map[DEFAULT_KEY] ?? RECONCILE_DEFAULT
  return Array.isArray(hit) ? hit : [hit]
}
