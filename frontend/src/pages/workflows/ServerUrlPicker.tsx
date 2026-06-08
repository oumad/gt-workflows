import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import type { Server } from '../../types'
import { normServerUrl, serverLabel } from './workflowsHelpers'

type ServerInsight = { serverId: string; serverName: string; totalJobs: number }

/**
 * Multi-server URL editor. The value is the list of ComfyUI server URLs a
 * workflow targets (params.json `comfyui_config.serverUrl`). You can pick
 * registered servers — the least-used one is hinted — or type a custom URL.
 */
export function ServerUrlPicker({
  value,
  onChange,
  servers,
  autoFocus,
  placeholder,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  servers: Server[]
  autoFocus?: boolean
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [leastUsedUrl, setLeastUsedUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

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

  const picked = new Set(value.map(normServerUrl))
  const q = input.trim().toLowerCase()
  const matches = servers
    .filter((s) => !picked.has(normServerUrl(s.url)))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q))

  const customUrl = input.trim()
  const showCustom =
    customUrl.length > 0 &&
    !servers.some((s) => normServerUrl(s.url) === normServerUrl(customUrl)) &&
    !picked.has(normServerUrl(customUrl))

  function add(url: string) {
    const u = url.trim()
    if (u && !picked.has(normServerUrl(u))) onChange([...value, u])
    setInput('')
    inputRef.current?.focus()
  }
  function remove(url: string) {
    onChange(value.filter((u) => u !== url))
  }

  return (
    <div className="col" style={{ gap: 6 }}>
      {/* picked servers */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 4, minHeight: 20 }}>
        {value.length === 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>No servers assigned.</span>
        )}
        {value.map((url) => (
          <span
            key={url}
            className="chip row"
            style={{ fontSize: 10.5, gap: 4, padding: '2px 4px 2px 8px' }}
          >
            <span className="mono" title={url}>
              {serverLabel(url, servers)}
            </span>
            <button
              type="button"
              onClick={() => remove(url)}
              title="Remove"
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--ink-3)',
                lineHeight: 1,
                fontSize: 13,
              }}
            >
              ×
            </button>
          </span>
        ))}
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
          if (e.key === 'Enter' && input.trim()) {
            e.preventDefault()
            add(input)
          }
        }}
        placeholder={placeholder ?? 'Pick a server or type a URL…'}
      />

      {/* suggestions — normal flow (not absolute) so a host with overflow:hidden,
          e.g. the workflow card, does not clip it */}
      {focused && (matches.length > 0 || showCustom) && (
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 7,
            overflow: 'hidden',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {matches.slice(0, 6).map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                add(s.url)
              }}
              className="row"
              style={{
                width: '100%',
                border: 0,
                background: 'transparent',
                textAlign: 'left',
                padding: '6px 10px',
                gap: 6,
                cursor: 'default',
                fontSize: 11.5,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10 }}>
                {s.url}
              </span>
              {normServerUrl(s.url) === leastUsedUrl && (
                <span
                  style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: 'var(--good)' }}
                >
                  least used
                </span>
              )}
            </button>
          ))}
          {showCustom && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                add(customUrl)
              }}
              className="row"
              style={{
                width: '100%',
                border: 0,
                background: 'transparent',
                textAlign: 'left',
                padding: '6px 10px',
                gap: 6,
                cursor: 'default',
                fontSize: 11.5,
                color: 'var(--ink-3)',
                borderTop: matches.length ? '1px solid var(--line-2)' : 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Plus size={11} /> Use custom URL "
              <span className="mono" style={{ color: 'var(--ink)' }}>
                {customUrl}
              </span>
              "
            </button>
          )}
        </div>
      )}
    </div>
  )
}
