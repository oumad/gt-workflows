import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, Boxes, Server, Download } from 'lucide-react'
import { api } from '../../lib/api'
import type { Server as ServerType } from '../../types'
import { serverColor, COMFY_LOG_LIMIT, flattenComfyLogs, exportLogs } from './serverHelpers'

/** kindLabel selects the noun in user-facing strings and the icon. The two
 *  pages (services/, servers/) render the same UI; only the wording differs. */
type KindLabel = 'service' | 'server'

const ICON_FOR: Record<KindLabel, typeof Boxes> = {
  service: Boxes,
  server: Server,
}

export function ServerLogs({ server, kindLabel }: { server: ServerType; kindLabel: KindLabel }) {
  const [lvlFilter, setLvlFilter] = useState('all')
  const [lines, setLines] = useState<
    { t: string | null; level: string | null; msg: string }[] | null
  >(null)
  const [source, setSource] = useState<'logs' | 'history' | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    api
      .get<{ source: 'logs' | 'history'; data: unknown; limit?: number }>(
        `/api/servers/${server.id}/comfy/logs`,
      )
      .then((d) => {
        if (!cancelled) {
          setLines(flattenComfyLogs(d))
          setSource(d.source)
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load logs')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [server.id])

  const lvlColor: Record<string, string> = {
    INFO: 'var(--ink-3)',
    WARN: 'var(--warn)',
    ERROR: 'var(--bad)',
    DEBUG: 'var(--ink-3)',
  }
  // Memoized so the autoscroll effect below only fires when the visible set
  // actually changes, not on every render.
  const filtered = useMemo(
    () =>
      lines == null
        ? []
        : lvlFilter === 'all'
          ? lines
          : lines.filter((l) => l.level === lvlFilter.toUpperCase()),
    [lines, lvlFilter],
  )

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [filtered])

  if (loading)
    return (
      <div className="card card-pad" style={{ color: 'var(--ink-3)' }}>
        Loading logs…
      </div>
    )
  if (err) return <div className="alert alert-error">{err}</div>

  return (
    <div className="card">
      <div className="card-head">
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="card-title">Last {COMFY_LOG_LIMIT} ComfyUI logs</div>
          {source === 'history' && (
            <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
              (via /history — {kindLabel} has no /internal/logs)
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <div className="toggle-group">
            {['all', 'info', 'warn', 'error'].map((f) => (
              <button
                key={f}
                className={lvlFilter === f ? 'active' : ''}
                onClick={() => setLvlFilter(f)}
                style={{ textTransform: 'capitalize' }}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="card-sub">{filtered.length} shown</span>
          <button
            className="btn btn-sm"
            onClick={() => exportLogs(lines ?? [], server.name)}
            disabled={!lines || lines.length === 0}
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="card-pad" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
          No log lines.
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.6,
            background: 'var(--surface-2)',
            maxHeight: 480,
            overflow: 'auto',
          }}
        >
          {filtered.map((l, i) => (
            <div
              key={i}
              style={{
                padding: '5px 16px',
                display: 'grid',
                gridTemplateColumns: '90px 60px 1fr',
                gap: 10,
                borderBottom: '1px solid var(--line-2)',
              }}
            >
              <span style={{ color: 'var(--ink-3)' }}>{l.t ?? '—'}</span>
              <span
                style={{ color: l.level ? lvlColor[l.level] : 'var(--ink-3)', fontWeight: 600 }}
              >
                {l.level ?? ''}
              </span>
              <span
                style={{
                  color: l.level === 'ERROR' ? 'var(--bad)' : undefined,
                  wordBreak: 'break-word',
                }}
              >
                {l.msg}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ServerLogsModal({
  server,
  onClose,
  kindLabel,
}: {
  server: ServerType
  onClose: () => void
  kindLabel: KindLabel
}) {
  const [lines, setLines] = useState<
    { t: string | null; level: string | null; msg: string }[] | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [lvlFilter, setLvlFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [live, setLive] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const d = await api.get<{ source: 'logs' | 'history'; data: unknown; limit?: number }>(
        `/api/servers/${server.id}/comfy/logs`,
      )
      setLines(flattenComfyLogs(d))
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }, [server.id])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    if (!live) return
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [live, fetchLogs])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = useMemo(() => {
    if (!lines) return []
    let out = lines
    if (lvlFilter !== 'all') out = out.filter((l) => l.level === lvlFilter.toUpperCase())
    if (search) {
      const q = search.toLowerCase()
      out = out.filter((l) => l.msg.toLowerCase().includes(q) || (l.t ?? '').includes(q))
    }
    return out
  }, [lines, lvlFilter, search])

  const lvlColor: Record<string, string> = {
    INFO: 'var(--ink-3)',
    WARN: 'var(--warn)',
    ERROR: 'var(--bad)',
    DEBUG: 'var(--ink-3)',
  }

  const color = serverColor(server)
  const Icon = ICON_FOR[kindLabel]
  const titleCap = kindLabel === 'service' ? 'Service' : 'Server'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 860,
          maxWidth: '95vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          borderRadius: 12,
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: color,
              display: 'grid',
              placeItems: 'center',
              color: 'white',
              flexShrink: 0,
            }}
          >
            <Icon size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>
              {titleCap} logs
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--ink-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {server.name}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            style={{ fontSize: 18, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div className="search" style={{ width: '100%' }}>
            <span className="search-icon">
              <Search size={14} />
            </span>
            <input
              className="input"
              placeholder="Search log lines…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Filter toolbar */}
        <div
          style={{
            padding: '8px 20px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <div className="toggle-group">
            {['all', 'info', 'warn', 'error'].map((f) => (
              <button
                key={f}
                className={lvlFilter === f ? 'active' : ''}
                onClick={() => setLvlFilter(f)}
                style={{ textTransform: 'capitalize' }}
              >
                {f}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-sm"
            style={
              live
                ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                : { color: 'var(--accent)', borderColor: 'var(--accent)' }
            }
            onClick={() => setLive((v) => !v)}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: live ? 'white' : 'var(--accent)',
                display: 'inline-block',
                marginRight: 5,
                flexShrink: 0,
              }}
            />
            Live
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => exportLogs(lines ?? [], server.name)}
          >
            <Download size={13} /> Export
          </button>
        </div>

        {/* Log rows */}
        {server.type !== 'workflow' ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              fontSize: 13,
              padding: 32,
            }}
          >
            Logs are only available for ComfyUI (workflow) {kindLabel}s.
          </div>
        ) : loading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              fontSize: 13,
            }}
          >
            Loading logs…
          </div>
        ) : err ? (
          <div style={{ flex: 1, padding: 24, color: 'var(--bad)', fontSize: 13 }}>{err}</div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              fontSize: 13,
            }}
          >
            No log lines.
          </div>
        ) : (
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflow: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              lineHeight: 1.6,
              background: 'var(--surface-2)',
            }}
          >
            {filtered.map((l, i) => (
              <div
                key={i}
                style={{
                  padding: '3px 20px',
                  display: 'grid',
                  gridTemplateColumns: '90px 52px 1fr',
                  gap: 12,
                  borderBottom: '1px solid var(--line-2)',
                  background:
                    l.level === 'ERROR'
                      ? 'color-mix(in oklab, var(--bad) 9%, transparent)'
                      : undefined,
                }}
              >
                <span style={{ color: 'var(--ink-3)' }}>{l.t ?? '—'}</span>
                <span
                  style={{ color: l.level ? lvlColor[l.level] : 'var(--ink-3)', fontWeight: 600 }}
                >
                  {l.level ?? ''}
                </span>
                <span
                  style={{
                    color: l.level === 'ERROR' ? 'var(--bad)' : 'var(--ink)',
                    wordBreak: 'break-word',
                  }}
                >
                  {l.msg}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {filtered.length} {filtered.length === 1 ? 'line' : 'lines'}
            {lines && lines.length !== filtered.length ? ` of ${lines.length}` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
