/**
 * All-server live status panel.
 * Shows every monitored server side-by-side: queue depth, VRAM, health.
 * Clicking a row opens the ServerDetailModal.
 * Auto-refreshes every 15s.
 */
import { useState, useEffect, useCallback } from 'react'
import { fetchComfyQueue } from '@/services/api/servers'
import { fetchWithAuth } from '@/utils/auth'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'

interface ServerLiveRow {
  url: string
  running: number
  pending: number
  vramTotal?: number
  vramFree?: number
  gpuName?: string
  latencyMs?: number
  healthy: boolean | null
  error?: string
}

interface Props {
  servers: string[]
  onViewDetail: (url: string) => void
}

function VramMini({ vramTotal, vramFree }: { vramTotal: number; vramFree: number }) {
  const used = vramTotal - vramFree
  const pct = Math.round((used / vramTotal) * 100)
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981'
  const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)}G`
  return (
    <div className="flex flex-col gap-[3px] min-w-[120px]">
      <div className="flex justify-between text-[10px] text-muted">
        <span>{gb(used)} / {gb(vramTotal)}</span>
        <span style={{ color }} className="tabular-nums font-medium">{pct}%</span>
      </div>
      <div className="h-[5px] rounded-full bg-[rgba(45,58,74,0.5)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export function ServerLiveStatus({ servers, onViewDetail }: Props) {
  const aliases = useServerAliases()
  const [rows, setRows] = useState<ServerLiveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled(
      servers.map(async (url): Promise<ServerLiveRow> => {
        const norm = url.replace(/\/$/, '')
        let running = 0
        let pending = 0
        let error: string | undefined
        let vramTotal: number | undefined
        let vramFree: number | undefined
        let gpuName: string | undefined
        let latencyMs: number | undefined
        let healthy: boolean | null = null

        const [queueResult, healthResult] = await Promise.allSettled([
          fetchComfyQueue(url),
          fetchWithAuth('/api/servers/health-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverUrl: url }),
          }).then((r) => r.json()),
        ])

        if (queueResult.status === 'fulfilled') {
          running = queueResult.value.running.length
          pending = queueResult.value.pending.length
        } else {
          error = queueResult.reason instanceof Error ? queueResult.reason.message : 'Queue unavailable'
        }

        if (healthResult.status === 'fulfilled') {
          const h = healthResult.value
          healthy = h.healthy === true
          latencyMs = typeof h.latencyMs === 'number' ? h.latencyMs : undefined
          vramTotal = h.systemInfo?.vramTotal
          vramFree = h.systemInfo?.vramFree
          gpuName = h.systemInfo?.gpuName
        } else {
          healthy = false
        }

        return { url: norm, running, pending, vramTotal, vramFree, gpuName, latencyMs, healthy, error }
      })
    )
    setRows(results.map((r) => r.status === 'fulfilled' ? r.value : { url: '', running: 0, pending: 0, healthy: false }))
    setLastRefreshed(new Date())
    setLoading(false)
  }, [servers])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  if (servers.length === 0) return null

  return (
    <div className="bg-secondary border border-default rounded-[10px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-[0.6rem] border-b border-default text-sm font-semibold uppercase tracking-[0.06em] text-muted shrink-0">
        <span className="flex-1">Live Server Status</span>
        {lastRefreshed && (
          <span className="text-[10px] font-normal normal-case tracking-normal text-muted/60">
            updated {lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        {loading && <span className="w-3 h-3 border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-default">
              <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">Server</th>
              <th className="px-4 py-[0.4rem] text-center text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">Running</th>
              <th className="px-4 py-[0.4rem] text-center text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">Queued</th>
              <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">VRAM</th>
              <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">GPU</th>
              <th className="px-4 py-[0.4rem] text-right text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const dot = row.healthy === null ? 'bg-yellow-400 animate-pulse' : row.healthy ? 'bg-emerald-400' : 'bg-red-400'
              const queueLoad = row.running + row.pending
              const queueColor = queueLoad >= 5 ? 'text-red-400' : queueLoad >= 2 ? 'text-amber-400' : 'text-primary'
              return (
                <tr
                  key={row.url}
                  className="border-b border-default/40 last:border-b-0 hover:bg-tertiary/40 cursor-pointer transition-colors"
                  onClick={() => onViewDetail(row.url)}
                  title="Click to view queue details"
                >
                  <td className="px-4 py-[0.55rem]">
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                      <span className="font-mono text-xs text-primary">{displayServerName(row.url, aliases)}</span>
                    </span>
                  </td>
                  <td className={`px-4 py-[0.55rem] text-center tabular-nums font-semibold ${row.running > 0 ? 'text-emerald-400' : 'text-muted'}`}>
                    {row.error ? '—' : row.running}
                  </td>
                  <td className={`px-4 py-[0.55rem] text-center tabular-nums font-semibold ${queueColor}`}>
                    {row.error ? '—' : row.pending}
                  </td>
                  <td className="px-4 py-[0.55rem] min-w-[140px]">
                    {row.vramTotal != null && row.vramFree != null
                      ? <VramMini vramTotal={row.vramTotal} vramFree={row.vramFree} />
                      : <span className="text-xs text-muted">{row.error ?? '—'}</span>}
                  </td>
                  <td className="px-4 py-[0.55rem] max-w-[200px]">
                    <span className="text-xs text-muted overflow-hidden text-ellipsis whitespace-nowrap block" title={row.gpuName}>
                      {row.gpuName ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-[0.55rem] text-right tabular-nums text-xs text-muted">
                    {row.latencyMs != null ? `${row.latencyMs}ms` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
