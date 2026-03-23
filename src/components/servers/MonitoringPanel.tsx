import { useState, useEffect } from 'react'
import { Bell, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react'
import type { MonitoringConfig } from '@/hooks/useMonitoring'

const INTERVAL_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
]

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const elapsed = Date.now() - new Date(iso).getTime()
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s ago`
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  return `${Math.floor(elapsed / 3_600_000)}h ago`
}

interface MonitoringPanelProps {
  config: MonitoringConfig | null
  checking: boolean
  serverAliases: Record<string, string>
  onCheckNow: () => void
  onUpdateInterval: (s: number) => void
}

export function MonitoringPanel({
  config,
  checking,
  serverAliases,
  onCheckNow,
  onUpdateInterval,
}: MonitoringPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [, setTick] = useState(0)

  // Tick every 15s so relative times stay fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  if (!config) return null

  const { watchedServers, intervalSeconds, discordEnabled, status, running } = config
  const watchedCount = watchedServers.length
  const downCount = watchedServers.filter((u) => status[u.replace(/\/$/, '')]?.healthy === false).length
  const hasDown = downCount > 0

  if (watchedCount === 0) {
    return (
      <div className="monitoring-panel monitoring-panel--empty">
        <Bell size={15} className="monitoring-panel-empty-icon" />
        <span className="monitoring-panel-empty-text">
          No servers being monitored. Click the <Bell size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> icon on a server card to enable background monitoring.
        </span>
      </div>
    )
  }

  return (
    <div className={`monitoring-panel${hasDown ? ' monitoring-panel--alert' : ''}`}>
      <div className="monitoring-panel-header" onClick={() => setExpanded((e) => !e)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}>
        <div className="monitoring-panel-header-left">
          <Bell size={15} className={`monitoring-panel-bell${hasDown ? ' monitoring-panel-bell--alert' : ''}`} />
          <span className="monitoring-panel-title">Background Monitoring</span>
          <span className={`monitoring-panel-badge${hasDown ? ' monitoring-panel-badge--down' : ' monitoring-panel-badge--ok'}`}>
            {watchedCount} watched
          </span>
          {hasDown && (
            <span className="monitoring-panel-badge monitoring-panel-badge--down">
              {downCount} down
            </span>
          )}
          {!running && watchedCount > 0 && (
            <span className="monitoring-panel-badge monitoring-panel-badge--warn">not started</span>
          )}
        </div>
        <div className="monitoring-panel-header-right">
          <button
            type="button"
            className="btn btn-toolbar btn-sm"
            onClick={(e) => { e.stopPropagation(); onCheckNow() }}
            disabled={checking}
            title="Run checks now"
          >
            {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Check now
          </button>
          <span className="monitoring-panel-chevron">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="monitoring-panel-body">
          <table className="monitoring-table">
            <thead>
              <tr>
                <th>Server</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Last check</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {watchedServers.map((url) => {
                const norm = url.replace(/\/$/, '')
                const s = status[norm]
                const alias = serverAliases[url] || serverAliases[norm]
                return (
                  <tr key={url} className={`monitoring-row${s?.healthy === false ? ' monitoring-row--down' : ''}`}>
                    <td className="monitoring-cell-server" title={url}>
                      {alias ? (
                        <><span className="monitoring-server-alias">{alias}</span><span className="monitoring-server-url">{norm.replace(/^https?:\/\//, '')}</span></>
                      ) : (
                        <span>{norm.replace(/^https?:\/\//, '')}</span>
                      )}
                    </td>
                    <td className="monitoring-cell-status">
                      {!s ? (
                        <span className="monitoring-status monitoring-status--unknown"><Clock size={13} /> Unknown</span>
                      ) : s.healthy === true ? (
                        <span className="monitoring-status monitoring-status--healthy"><CheckCircle2 size={13} /> Healthy</span>
                      ) : (
                        <span className="monitoring-status monitoring-status--down"><XCircle size={13} /> Down</span>
                      )}
                    </td>
                    <td className="monitoring-cell-latency">
                      {s?.latencyMs != null ? `${s.latencyMs}ms` : '—'}
                    </td>
                    <td className="monitoring-cell-time">
                      {formatRelativeTime(s?.lastCheck ?? null)}
                    </td>
                    <td className="monitoring-cell-error" title={s?.error ?? ''}>
                      {s?.error ? s.error.slice(0, 60) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="monitoring-panel-footer">
            <div className="monitoring-panel-footer-left">
              <span className="monitoring-footer-label">Check every</span>
              <select
                className="monitoring-interval-select"
                value={intervalSeconds}
                onChange={(e) => onUpdateInterval(Number(e.target.value))}
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="monitoring-panel-footer-right">
              {discordEnabled ? (
                <span className="monitoring-discord monitoring-discord--enabled">
                  Discord alerts enabled
                </span>
              ) : (
                <span className="monitoring-discord monitoring-discord--disabled">
                  Discord alerts disabled — set DISCORD_WEBHOOK_URL
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
