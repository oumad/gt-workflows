import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { Plus, Link2 } from 'lucide-react'
import { api } from '../../lib/api'
import type { Server } from '../../types'
import {
  normServerUrl,
  serverLabel,
  bindingToken,
  bindingKeyOf,
  type GlobalEnvMap,
} from './workflowsHelpers'

type ServerInsight = { serverId: string; serverName: string; totalJobs: number }

/**
 * Server binding editor. The value is the list of raw refs a workflow targets
 * (params.json `comfyui_config.serverUrl`): each is either a `<globalEnv.key>`
 * binding expression or a literal URL. You can:
 *   - pick an existing globalEnv key/pool (writes the EXPRESSION, never the URL),
 *   - type a literal URL, or pick a registered server.
 * globalEnv keys are defined in Workflow Studio's config (operator-managed, read
 * only here) — CM never writes them. The real per-env URL of a literal binding
 * is kept out of git by the clean/smudge filter (stored in the envtable).
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Current globalEnv bindings (from WS config) — drives the key picker and the
  // chip labels. Read-only: CM never writes this map.
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

  function addToken(key: string) {
    if (!pickedKeys.has(key)) onChange([...value, bindingToken(key)])
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
    if (Array.isArray(v)) return `${bindingToken(key)} → ${v.join(', ')}`
    if (typeof v === 'string') return `${bindingToken(key)} → ${v}`
    return `${bindingToken(key)} → (not defined in WS config yet)`
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
            // literal URL. (New globalEnv keys are defined in WS config, not here.)
            if (typed in globalEnv) addToken(typed)
            else if (looksUrl) addLiteral(typed)
          }
        }}
        placeholder={placeholder ?? 'Pick a binding/server or type a URL…'}
      />

      {/* suggestions — normal flow (not absolute) so a host with overflow:hidden,
          e.g. the workflow card, does not clip it */}
      {focused && (keyMatches.length > 0 || serverMatches.length > 0 || showCustom) && (
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 7,
            overflow: 'hidden',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* existing globalEnv bindings (from WS config) */}
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
                borderTop: topBorder(keyMatches.length + serverMatches.length),
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
