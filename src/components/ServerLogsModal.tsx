import { useState, useEffect, useMemo, useCallback } from 'react'
import { X, FileText, RefreshCw, Timer } from 'lucide-react'
import { fetchServerLogs } from '../api/servers'
import './ServerLogsModal.css'

const AUTO_REFRESH_INTERVALS = [5, 10, 30, 60] as const

type LogEntry = { t?: string; m?: string }

function tryPrettifyJson(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return raw
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(raw)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return raw
    }
  }
  return raw
}

function tryParseLogEntries(content: string | null): LogEntry[] | null {
  if (content == null) return null
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const data = JSON.parse(content) as { entries?: unknown }
    const entries = data?.entries
    if (!Array.isArray(entries)) return null
    const valid = entries.every(
      (e) => e != null && typeof e === 'object' && ('t' in e || 'm' in e)
    )
    return valid ? (entries as LogEntry[]) : null
  } catch {
    return null
  }
}

function formatLogTimestamp(iso: string | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toISOString().replace('T', ' ').slice(0, 23)
  } catch {
    return String(iso)
  }
}

interface ServerLogsModalProps {
  serverUrl: string
  onClose: () => void
}

export default function ServerLogsModal({ serverUrl, onClose }: ServerLogsModalProps) {
  const [content, setContent] = useState<string | null>(null)
  const [contentType, setContentType] = useState<'text/plain' | 'text/html'>('text/plain')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(10)
  const [viewMode, setViewMode] = useState<'raw' | 'formatted'>('formatted')

  const displayContent = useMemo(() => {
    if (content == null) return ''
    if (contentType === 'text/html') return content
    return tryPrettifyJson(content)
  }, [content, contentType])

  const logEntries = useMemo(() => tryParseLogEntries(content), [content])
  const showFormattedView = viewMode === 'formatted' && logEntries != null && contentType !== 'text/html'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchServerLogs(serverUrl)
      setContent(res.content)
      setContentType(res.contentType)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
      setContent(null)
    } finally {
      setLoading(false)
    }
  }, [serverUrl])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const ms = autoRefreshInterval * 1000
    const id = setInterval(load, ms)
    return () => clearInterval(id)
  }, [autoRefresh, autoRefreshInterval, load])

  return (
    <div className="server-logs-overlay" onClick={onClose}>
      <div className="server-logs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="server-logs-header">
          <div className="server-logs-title">
            <FileText size={20} />
            <span>Server logs</span>
            <span className="server-logs-url" title={serverUrl}>{serverUrl}</span>
          </div>
          <div className="server-logs-actions">
            {contentType !== 'text/html' && (
              <button
                type="button"
                className="server-logs-view-mode-btn"
                onClick={() => setViewMode((v) => (v === 'raw' ? 'formatted' : 'raw'))}
                title={viewMode === 'raw' ? 'Show formatted log view (timestamp | message)' : 'Show raw JSON'}
              >
                {viewMode === 'raw' ? 'Raw' : 'Formatted'}
              </button>
            )}
            <div className="server-logs-auto-refresh">
              <button
                type="button"
                className={`server-logs-autorefresh-btn ${autoRefresh ? 'active' : ''}`}
                onClick={() => setAutoRefresh((v) => !v)}
                title={autoRefresh ? 'Stop auto-refresh' : 'Enable auto-refresh'}
              >
                <Timer size={18} />
                <span>Auto-refresh</span>
              </button>
              <select
                className="server-logs-interval"
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                title="Refresh interval"
                aria-label="Auto-refresh interval"
              >
                {AUTO_REFRESH_INTERVALS.map((s) => (
                  <option key={s} value={s}>
                    Every {s}s
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="server-logs-refresh"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button type="button" className="server-logs-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="server-logs-body">
          {loading && !content ? (
            <div className="server-logs-loading">Loading logs…</div>
          ) : error ? (
            <div className="server-logs-error">{error}</div>
          ) : contentType === 'text/html' ? (
            <iframe
              title="Server logs"
              className="server-logs-iframe"
              srcDoc={content ?? ''}
              sandbox="allow-same-origin"
            />
          ) : showFormattedView ? (
            <div className="server-logs-formatted">
              <div className="server-logs-formatted-head">
                <span className="server-logs-formatted-time">Time</span>
                <span className="server-logs-formatted-msg">Message</span>
              </div>
              {logEntries!.map((entry, i) => (
                <div key={i} className="server-logs-formatted-row">
                  <span className="server-logs-formatted-time" title={entry.t ?? ''}>
                    {formatLogTimestamp(entry.t)}
                  </span>
                  <span className="server-logs-formatted-msg">{entry.m ?? ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="server-logs-pre">{displayContent}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
