/**
 * ServerComparisonTable — side-by-side server stats: throughput, avg duration, failure rate, VRAM.
 * Helps identify which server is performing worst at a glance.
 */
import { useState, useEffect, useRef } from 'react'
import { Table2 } from 'lucide-react'
import { getServerComparison } from '@/services/api/stats'
import type { ServerComparisonEntry } from '@/services/api/stats'
import { fetchWithAuth } from '@/utils/auth'
import { durationColorClass, formatDurationMs } from '@/utils/failureClassifier'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'

interface ServerHealth {
  healthy: boolean | null
  latencyMs?: number
  vramTotal?: number
  vramFree?: number
}

interface Props {
  onViewDetail?: (url: string) => void
}

type Period = '1h' | '1d' | '1w' | '1m'

const PERIODS: { label: string; value: Period }[] = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '1d' },
  { label: '7d', value: '1w' },
  { label: '30d', value: '1m' },
]

function failRateColor(rate: number): string {
  if (rate === 0) return 'text-emerald-400'
  if (rate < 10) return 'text-primary'
  if (rate < 30) return 'text-amber-400'
  return 'text-red-400'
}

function VramMini({ health }: { health: ServerHealth | null | undefined }) {
  if (!health?.vramTotal || health.vramFree == null) return <span className="text-muted text-xs">—</span>
  const used = health.vramTotal - health.vramFree
  const pct = Math.round((used / health.vramTotal) * 100)
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-14 h-[5px] rounded-full bg-[rgba(45,58,74,0.6)] overflow-hidden shrink-0">
        <span className="block h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="tabular-nums text-xs" style={{ color }}>{pct}%</span>
    </span>
  )
}

export default function ServerComparisonTable({ onViewDetail }: Props) {
  const aliases = useServerAliases()
  const [period, setPeriod] = useState<Period>('1d')
  const [servers, setServers] = useState<ServerComparisonEntry[]>([])
  const [healthMap, setHealthMap] = useState<Record<string, ServerHealth>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    getServerComparison(period, ctrl.signal)
      .then(async (res) => {
        if (ctrl.signal.aborted) return
        setConfigured(res.configured)
        setServers(res.servers)
        setError(res.error ?? null)
        // Fetch health for each server in parallel
        if (res.servers.length > 0) {
          const healthResults = await Promise.allSettled(
            res.servers.map((srv) =>
              fetchWithAuth('/api/servers/health-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverUrl: srv.server }),
                signal: ctrl.signal,
              }).then((r) => r.json()).then((h) => ({ url: srv.server, health: h }))
            )
          )
          if (ctrl.signal.aborted) return
          const map: Record<string, ServerHealth> = {}
          for (const r of healthResults) {
            if (r.status === 'fulfilled') {
              const { url, health: h } = r.value
              map[url] = {
                healthy: h.healthy === true,
                latencyMs: typeof h.latencyMs === 'number' ? h.latencyMs : undefined,
                vramTotal: h.systemInfo?.vramTotal,
                vramFree: h.systemInfo?.vramFree,
              }
            }
          }
          setHealthMap(map)
        }
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [period])

  if (configured === false) return null

  return (
    <div className="bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[0.6rem] border-b border-default shrink-0">
        <Table2 size={14} className="text-muted shrink-0" />
        <span className="flex-1 text-sm font-semibold uppercase tracking-[0.06em] text-muted">Server Comparison</span>

        {/* Period tabs */}
        <div className="flex items-center gap-[2px]">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`px-[0.5rem] py-[0.15rem] text-xs rounded transition-colors ${period === p.value ? 'bg-accent/20 text-accent-light font-semibold' : 'text-muted hover:text-secondary'}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {loading && <span className="w-3 h-3 border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />}
      </div>

      {/* Body */}
      {loading && servers.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted">Loading…</div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-semantic-error">{error}</div>
      ) : servers.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">No job data in this period.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-default">
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">Server</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted" title="Total jobs processed in this period">Jobs</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted" title="Average generation time">Avg Time</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted" title="Percentage of jobs that failed">Fail %</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted" title="Current VRAM usage from last health check">VRAM</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted" title="Current health status">Status</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((srv) => {
                const health = healthMap[srv.server]
                const isHealthy = health?.healthy === true
                const isUnhealthy = health?.healthy === false
                return (
                  <tr key={srv.server} className="border-b border-default/40 last:border-b-0 hover:bg-tertiary/30 transition-colors">
                    <td className="px-4 py-[0.5rem] max-w-[200px]">
                      {onViewDetail ? (
                        <button
                          type="button"
                          className="font-mono text-xs text-primary bg-transparent border-none p-0 cursor-pointer hover:text-accent-light transition-colors overflow-hidden text-ellipsis whitespace-nowrap block max-w-full text-left"
                          title={srv.server}
                          onClick={() => onViewDetail(srv.server)}
                        >
                          {displayServerName(srv.server, aliases)}
                        </button>
                      ) : (
                        <span className="font-mono text-xs text-primary overflow-hidden text-ellipsis whitespace-nowrap block" title={srv.server}>
                          {displayServerName(srv.server, aliases)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-[0.5rem] tabular-nums text-muted whitespace-nowrap">
                      {srv.totalCount.toLocaleString()}
                      {srv.failCount > 0 && (
                        <span className="ml-1 text-[10px] text-red-400">({srv.failCount}✕)</span>
                      )}
                    </td>
                    <td className={`px-4 py-[0.5rem] tabular-nums font-medium whitespace-nowrap ${durationColorClass(srv.avgMs)}`}>
                      {srv.avgMs != null ? formatDurationMs(srv.avgMs) : '—'}
                    </td>
                    <td className={`px-4 py-[0.5rem] tabular-nums font-medium whitespace-nowrap ${failRateColor(srv.failRate)}`}>
                      {srv.failRate === 0 ? '0%' : `${srv.failRate.toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-[0.5rem]">
                      <VramMini health={health} />
                    </td>
                    <td className="px-4 py-[0.5rem]">
                      {health == null ? (
                        <span className="text-xs text-muted">—</span>
                      ) : isHealthy ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {health.latencyMs != null ? `${health.latencyMs}ms` : 'online'}
                        </span>
                      ) : isUnhealthy ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                          offline
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
