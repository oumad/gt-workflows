/**
 * Resolve a workflow's server reference(s) to real URL(s).
 *
 * A workflow stores `comfyui_config.serverUrl` as either a literal URL or a
 * `<globalEnv.key>` token — a stable, env-independent binding identity. The real
 * URL for each key comes from CM's own `GLOBALENV` env var (inline JSON), a FLAT
 * map `key -> url | url[]`. The WS git repo holds workflows only, never this
 * config — so CM never reads anything out of the WS checkout to resolve.
 */
import { config } from '../config/index.js'

/** Key used as the no-match fallback (per the design). */
const DEFAULT_KEY = 'default'
/** Missing key / unresolved binding → this localhost placeholder (never throws). */
const PLACEHOLDER = 'http://127.0.0.1:8188'

export type GlobalEnvMap = Record<string, string | string[]>

// The env var is fixed for the process lifetime, so parse once.
let cache: GlobalEnvMap | null = null

/** The globalEnv map from the `GLOBALENV` env var (inline JSON) — a flat
 *  `{ key: url | url[] }` object. Returns `{}` when unset / malformed — so
 *  literal-URL workflows resolve identically whether or not it's configured
 *  (feature stays dark until set). */
export function loadGlobalEnv(): GlobalEnvMap {
  if (cache) return cache
  cache = parseGlobalEnv(config.GLOBALENV)
  return cache
}

function parseGlobalEnv(raw: string | undefined): GlobalEnvMap {
  if (!raw || !raw.trim()) return {}
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return {}
  }
  const map: GlobalEnvMap = {}
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() !== '') map[k] = v
      else if (Array.isArray(v)) {
        const urls = v.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
        if (urls.length) map[k] = urls
      }
    }
  }
  return map
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
