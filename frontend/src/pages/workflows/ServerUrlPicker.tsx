import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { Plus, Link2 } from 'lucide-react'
import { api } from '../../lib/api'
import type { Server } from '../../types'
import {
  normServerUrl,
  serverLabel,
  TOKEN_PREFIX,
  bindingKeyOf,
  isBindingKeyName,
  type GlobalEnvMap,
} from './workflowsHelpers'

type ServerInsight = { serverId: string; serverName: string; totalJobs: number }

/**
 * Server binding editor. The value is the list of raw refs a workflow targets
 * (params.json `comfyui_config.serverUrl`): each is either a `globalEnv.<key>`
 * binding token or a literal URL. You can:
 *   - pick an existing globalEnv key/role (writes the TOKEN, never the URL),
 *   - define a new key + URL(s) (PUTs the URL into globalEnv, writes the token),
 *   - or type a literal URL / pick a registered server.
 * A real URL is NEVER written into the workflow for a bound key — that's the
 * whole point: params carry the token, globalEnv carries the env-specific URL.
 */
export function ServerUrlPicker({
  value,
  onChange,
  servers,
  autoFocus,
  placeholder,
}: {
  value: string[]
  onChange: (refs: string[]) => void
  servers: Server[]
  autoFocus?: boolean
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [leastUsedUrl, setLeastUsedUrl] = useState<string | null>(null)
  const [globalEnv, setGlobalEnv] = useState<GlobalEnvMap>({})
  const [creating, setCreating] = useState(false) // new-binding form open
  const [newUrls, setNewUrls] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Current globalEnv bindings — drives the key picker and the chip labels.
  useEffect(() => {
    api
      .get<GlobalEnvMap>('/api/global-env')
      .then(setGlobalEnv)
      .catch(() => {})
  }, [])

  // Least-used registered server (by 30d job total) — a hint for picking.
  useEffect(() => {
    api
      .get<ServerInsight[]>('/api/servers/insights')
      .then((rows) => {
        const least = [...rows].sort((a, b) => a.totalJobs - b.totalJobs)[0]
        const srv = least ? servers.find((s) => s.id === least.serverId) : undefined
        if (srv) setLeastUsedUrl(normServerUrl(srv.url))
      })
      .catch(() => {})
  }, [servers])

  const pickedUrls = new Set(value.map(normServerUrl))
  const pickedKeys = new Set(value.map(bindingKeyOf).filter((k): k is string => !!k))
  const q = input.trim().toLowerCase()

  const keyMatches = Object.keys(globalEnv)
    .filter((k) => !pickedKeys.has(k))
    .filter((k) => !q || k.toLowerCase().includes(q))
    .sort()

  const serverMatches = servers
    .filter((s) => !pickedUrls.has(normServerUrl(s.url)))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q))

  const typed = input.trim()
  const looksUrl = /[.:/]/.test(typed)
  const showCustom =
    typed.length > 0 &&
    looksUrl &&
    !servers.some((s) => normServerUrl(s.url) === normServerUrl(typed)) &&
    !pickedUrls.has(normServerUrl(typed))
  const showCreate =
    typed.length > 0 && !looksUrl && isBindingKeyName(typed) && !(typed in globalEnv)

  function addToken(key: string) {
    if (!pickedKeys.has(key)) onChange([...value, TOKEN_PREFIX + key])
    setInput('')
    inputRef.current?.focus()
  }
  function addLiteral(url: string) {
    const u = url.trim()
    if (u && !pickedUrls.has(normServerUrl(u))) onChange([...value, u])
    setInput('')
    inputRef.current?.focus()
  }
  function remove(ref: string) {
    onChange(value.filter((u) => u !== ref))
  }

  async function createBinding() {
    const key = input.trim()
    const urls = newUrls
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
    if (!isBindingKeyName(key) || urls.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const map = await api.put<GlobalEnvMap>(`/api/global-env/${encodeURIComponent(key)}`, {
        urls,
      })
      setGlobalEnv(map)
      addToken(key)
      setCreating(false)
      setNewUrls('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save binding')
    } finally {
      setBusy(false)
    }
  }

  /** Chip label for a ref: bound key (with pool size) or literal server label. */
  function refLabel(ref: string): string {
    const key = bindingKeyOf(ref)
    if (key == null) return serverLabel(ref, servers)
    const v = globalEnv[key]
    if (Array.isArray(v)) return `${key} · pool of ${v.length}`
    if (typeof v === 'string') return key
    return `${key} · unbound`
  }
  function refTitle(ref: string): string {
    const key = bindingKeyOf(ref)
    if (key == null) return ref
    const v = globalEnv[key]
    if (Array.isArray(v)) return `${TOKEN_PREFIX}${key} → ${v.join(', ')}`
    if (typeof v === 'string') return `${TOKEN_PREFIX}${key} → ${v}`
    return `${TOKEN_PREFIX}${key} → (no URL bound yet)`
  }

  return (
    <div className="col" style={{ gap: 6 }}>
      {/* picked refs — tokens render with a link glyph + accent, literals plain */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 4, minHeight: 20 }}>
        {value.length === 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>No servers assigned.</span>
        )}
        {value.map((ref) => {
          const isToken = bindingKeyOf(ref) != null
          return (
            <span
              key={ref}
              className="chip row"
              style={{
                fontSize: 10.5,
                gap: 4,
                padding: '2px 4px 2px 8px',
                ...(isToken
                  ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }
                  : {}),
              }}
            >
              {isToken && <Link2 size={10} />}
              <span className="mono" title={refTitle(ref)}>
                {refLabel(ref)}
              </span>
              <button
                type="button"
                onClick={() => remove(ref)}
                title="Remove"
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'inherit',
                  lineHeight: 1,
                  fontSize: 13,
                }}
              >
                ×
              </button>
            </span>
          )
        })}
      </div>

      {/* add input */}
      <input
        ref={inputRef}
        className="input mono"
        style={{ fontSize: 11.5, height: 30 }}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && typed) {
            e.preventDefault()
            // Enter resolves to the single obvious action: existing key, then
            // literal URL, then open the new-binding form.
            if (typed in globalEnv) addToken(typed)
            else if (looksUrl) addLiteral(typed)
            else if (showCreate) setCreating(true)
          }
        }}
        placeholder={placeholder ?? 'Pick a binding/server or type a key or URL…'}
      />

      {/* new-binding form — key (from input) + URL(s); writes globalEnv + token */}
      {creating && (
        <div
          className="col"
          style={{
            gap: 6,
            border: '1px solid var(--accent)',
            borderRadius: 7,
            padding: 8,
            background: 'var(--surface)',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>
            New binding <span className="mono">{TOKEN_PREFIX + (input.trim() || '…')}</span> — enter
            one URL, or several (space/comma separated) for a pool.
          </div>
          <input
            className="input mono"
            style={{ fontSize: 11.5, height: 30 }}
            value={newUrls}
            autoFocus
            onChange={(e) => setNewUrls(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void createBinding()
              }
            }}
            placeholder="http://host:8188  http://host2:8188"
          />
          {error && <span style={{ fontSize: 11, color: 'var(--bad)' }}>{error}</span>}
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy || !newUrls.trim()}
              style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
              onClick={() => void createBinding()}
            >
              {busy ? 'Saving…' : 'Create binding'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => {
                setCreating(false)
                setNewUrls('')
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* suggestions — normal flow (not absolute) so a host with overflow:hidden,
          e.g. the workflow card, does not clip it */}
      {focused &&
        !creating &&
        (keyMatches.length > 0 || serverMatches.length > 0 || showCustom || showCreate) && (
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 7,
              overflow: 'hidden',
              background: 'var(--surface)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {/* existing globalEnv bindings */}
            {keyMatches.slice(0, 6).map((k) => {
              const v = globalEnv[k]
              const detail = Array.isArray(v)
                ? `pool of ${v.length}`
                : typeof v === 'string'
                  ? v
                  : 'unbound'
              return (
                <button
                  key={`k:${k}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addToken(k)
                  }}
                  className="row"
                  style={dropdownRow}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Link2 size={11} style={{ color: 'var(--accent-ink)' }} />
                  <span style={{ fontWeight: 600 }}>{k}</span>
                  <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10 }}>
                    {detail}
                  </span>
                </button>
              )
            })}

            {/* registered servers — adds a literal URL */}
            {serverMatches.slice(0, 6).map((s) => (
              <button
                key={`s:${s.id}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addLiteral(s.url)
                }}
                className="row"
                style={dropdownRow}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10 }}>
                  {s.url}
                </span>
                {normServerUrl(s.url) === leastUsedUrl && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--good)',
                    }}
                  >
                    least used
                  </span>
                )}
              </button>
            ))}

            {/* create a new binding from the typed key */}
            {showCreate && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setCreating(true)
                }}
                className="row"
                style={{
                  ...dropdownRow,
                  color: 'var(--accent-ink)',
                  borderTop: topBorder(keyMatches.length + serverMatches.length),
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Plus size={11} /> New binding "
                <span className="mono" style={{ color: 'var(--ink)' }}>
                  {typed}
                </span>
                "
              </button>
            )}

            {/* literal custom URL */}
            {showCustom && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addLiteral(typed)
                }}
                className="row"
                style={{
                  ...dropdownRow,
                  color: 'var(--ink-3)',
                  borderTop: topBorder(
                    keyMatches.length + serverMatches.length + (showCreate ? 1 : 0),
                  ),
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Plus size={11} /> Use custom URL "
                <span className="mono" style={{ color: 'var(--ink)' }}>
                  {typed}
                </span>
                "
              </button>
            )}
          </div>
        )}
    </div>
  )
}

const dropdownRow: CSSProperties = {
  width: '100%',
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  padding: '6px 10px',
  gap: 6,
  cursor: 'default',
  fontSize: 11.5,
}

const topBorder = (n: number) => (n > 0 ? '1px solid var(--line-2)' : 'none')
