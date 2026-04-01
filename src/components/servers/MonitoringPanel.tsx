import { useState, useEffect } from 'react'
import { Bell, BellOff, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react'
import type { MonitoringConfig } from '@/hooks/useMonitoring'

const INTERVAL_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
]

function cycleInterval(current: number): number {
  const idx = INTERVAL_OPTIONS.findIndex((o) => o.value === current)
  return INTERVAL_OPTIONS[(idx + 1) % INTERVAL_OPTIONS.length].value
}

function intervalLabel(seconds: number): string {
  return INTERVAL_OPTIONS.find((o) => o.value === seconds)?.label ?? `${seconds}s`
}

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
      <div className="monitoring-strip monitoring-strip--empty">
        <BellOff size={13} className="monitoring-strip-empty-icon" />
        <span className="monitoring-strip-empty-text">No servers monitored — use the ⋮ menu on a card to enable background monitoring</span>
      </div>
    )
  }

  return (
    <div className={`monitoring-strip${hasDown ? ' monitoring-strip--alert' : ''}`}>
      {/* ── Header bar ── */}
      <div
        className="monitoring-strip-header"
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
      >
        <div className="monitoring-strip-left">
          <Bell size={13} className={`monitoring-strip-bell${hasDown ? ' monitoring-strip-bell--alert' : ''}`} />
          <span className="monitoring-strip-title">Monitoring</span>
          <span className={`monitoring-strip-badge${hasDown ? ' monitoring-strip-badge--ok' : ' monitoring-strip-badge--ok'}`}>
            {watchedCount} watched
          </span>
          {hasDown && (
            <span className="monitoring-strip-badge monitoring-strip-badge--down">
              {downCount} down
            </span>
          )}
          {!running && watchedCount > 0 && (
            <span className="monitoring-strip-badge monitoring-strip-badge--warn">paused</span>
          )}
        </div>

        <div className="monitoring-strip-right">
          <button
            type="button"
            className="monitoring-strip-interval"
            onClick={(e) => { e.stopPropagation(); onUpdateInterval(cycleInterval(intervalSeconds)) }}
            title="Click to cycle check interval"
          >
            every {intervalLabel(intervalSeconds)}
          </button>
          <button
            type="button"
            className="monitoring-strip-btn"
            onClick={(e) => { e.stopPropagation(); onCheckNow() }}
            disabled={checking}
            title="Run checks now"
          >
            {checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          </button>
          <span className="monitoring-strip-chevron">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </div>
      </div>

      {/* ── Expanded table ── */}
      {expanded && (
        <div className="monitoring-strip-body">
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

          {discordEnabled !== undefined && (
            <div className="monitoring-strip-footer">
              <span className={`monitoring-discord${discordEnabled ? ' monitoring-discord--enabled' : ' monitoring-discord--disabled'}`}>
                {discordEnabled ? 'Discord alerts on' : 'Discord alerts off'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
