/**
 * Resolve a workflow's server reference(s) to real URL(s). READ-ONLY against
 * Workflow Studio's per-env config — CM never writes WS config (the per-env
 * server binding it owns lives in the gitignored workflow-envtable.json; WS
 * config is reference data the operator maintains).
 *
 * A workflow stores `comfyui_config.serverUrl` as either a literal URL or a
 * `<globalEnv.key>` expression — a stable, env-independent binding identity. The
 * real URL for each key comes from WS's config file (WS_CONFIG_PATH →
 * `workflowStudio.globalEnv`), a FLAT map `key -> url | url[]`. We load + cache
 * that map and reload it whenever the file's mtime changes.
 */
import { statSync, readFileSync } from 'node:fs'
import { config } from '../config/index.js'

/** Key used as the no-match fallback (per the design). */
const DEFAULT_KEY = 'default'
/** Missing key / unresolved binding → this localhost placeholder (never throws). */
const PLACEHOLDER = 'http://127.0.0.1:8188'

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

/** The binding key for a `<globalEnv.key>` expression (also accepts the legacy
 *  bare `globalEnv.key` form for pre-rework data), or null for a literal URL. */
export function serverRefKey(entry: string): string | null {
  const m =
    /^<globalEnv\.([A-Za-z0-9_-]+)>$/.exec(entry) ?? /^globalEnv\.([A-Za-z0-9_-]+)$/.exec(entry)
  return m ? m[1]! : null
}

/** True when a binding resolves only to localhost placeholder(s) — i.e. it is
 *  not pointed at a real server yet. Drives the "N workflows need a server"
 *  nudge. */
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

/** Resolve one server entry to real URL(s):
 *   - `<globalEnv.key>` → WS-config map lookup (url or url[]), falling back to
 *     `default`, then to the localhost placeholder. NEVER throws — an unresolved
 *     binding dispatches to localhost (and the "N need a server" nudge flags it).
 *   - literal URL / `127.0.0.1` / anything else → passthrough.
 *  Always returns an array, so a pool key (url[]) expands naturally. Pass an
 *  explicit `map` to resolve many entries against one snapshot. */
export function resolveServerRef(entry: string, map: GlobalEnvMap = loadGlobalEnv()): string[] {
  const key = serverRefKey(entry)
  if (key == null) return [entry]
  const hit = map[key] ?? map[DEFAULT_KEY] ?? PLACEHOLDER
  return Array.isArray(hit) ? hit : [hit]
}
