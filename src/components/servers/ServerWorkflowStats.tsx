import { useState, useEffect, useRef, useMemo } from 'react'
import { getUserServerStats, type ServerWorkflowEntry } from '@/services/api/stats'
import type { ActivityStatsPeriod } from '@/components/activity/useActivityStats'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'
import { usePeriod } from '@/contexts/PeriodContext'

const PERIODS: { id: ActivityStatsPeriod; label: string }[] = [
  { id: '1h', label: '1h' },
  { id: '1d', label: '1d' },
  { id: '1w', label: '1w' },
  { id: '1m', label: '1m' },
  { id: 'all', label: 'All' },
]

const COLORS = [
  '#6a3fa0', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
]

function colorIndex(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h) % COLORS.length
}

function StackedBar({ segments }: { segments: { label: string; pct: number; color: string }[] }) {
  return (
    <div className="flex h-[8px] rounded-[4px] overflow-hidden w-full bg-[rgba(45,58,74,0.4)]">
      {segments.map((seg) => (
        <div
          key={seg.label}
          style={{ width: `${seg.pct}%`, background: seg.color, minWidth: seg.pct > 0 ? 2 : 0 }}
          title={`${seg.label}: ${seg.pct}%`}
        />
      ))}
    </div>
  )
}

type View = 'byServer' | 'byWorkflow'

/** Pivot: for each workflow, list which servers it ran on */
function pivotToWorkflows(entries: ServerWorkflowEntry[]) {
  const map: Record<string, { server: string; count: number }[]> = {}
  for (const e of entries) {
    for (const w of e.workflows) {
      if (!map[w.name]) map[w.name] = []
      map[w.name].push({ server: e.server, count: w.count })
    }
  }
  return Object.entries(map)
    .map(([name, servers]) => {
      servers.sort((a, b) => b.count - a.count)
      const total = servers.reduce((s, x) => s + x.count, 0)
      return {
        name,
        total,
        servers: servers.map((x) => ({
          ...x,
          pct: total > 0 ? Math.round((x.count / total) * 1000) / 10 : 0,
        })),
      }
    })
    .sort((a, b) => b.total - a.total)
}

function ServerRow({ entry, aliases }: { entry: ServerWorkflowEntry; aliases: Record<string, string> }) {
  const segments = entry.workflows.map((w) => ({
    label: w.name,
    pct: w.pct,
    color: COLORS[colorIndex(w.name)],
  }))
  return (
    <div className="flex flex-col gap-[0.3rem] px-4 py-[0.55rem] border-b border-default last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-mono text-xs text-primary overflow-hidden text-ellipsis whitespace-nowrap" title={entry.server}>
          {displayServerName(entry.server, aliases)}
        </span>
        <span className="text-xs tabular-nums text-muted shrink-0">{entry.total.toLocaleString()} jobs</span>
      </div>
      <StackedBar segments={segments} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-[0.1rem]">
        {entry.workflows.map((w) => (
          <span key={w.name} className="inline-flex items-center gap-1 text-xs text-muted" title={w.name}>
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[colorIndex(w.name)] }} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px]">{w.name}</span>
            <span className="tabular-nums text-muted/70 shrink-0">{w.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function WorkflowRow({ entry, aliases }: { entry: ReturnType<typeof pivotToWorkflows>[number]; aliases: Record<string, string> }) {
  const segments = entry.servers.map((s) => ({
    label: displayServerName(s.server, aliases),
    pct: s.pct,
    color: COLORS[colorIndex(s.server)],
  }))
  return (
    <div className="flex flex-col gap-[0.3rem] px-4 py-[0.55rem] border-b border-default last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap" title={entry.name}>
          {entry.name}
        </span>
        <span className="text-xs tabular-nums text-muted shrink-0">{entry.total.toLocaleString()} jobs</span>
      </div>
      <StackedBar segments={segments} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-[0.1rem]">
        {entry.servers.map((s) => (
          <span key={s.server} className="inline-flex items-center gap-1 text-xs text-muted" title={s.server}>
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[colorIndex(s.server)] }} />
            {displayServerName(s.server, aliases)}
            <span className="tabular-nums text-muted/70 shrink-0">{s.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function ServerWorkflowStats() {
  const aliases = useServerAliases()
  const { period: globalPeriod } = usePeriod()
  const [period, setPeriod] = useState<ActivityStatsPeriod>(() => {
    const valid = PERIODS.map((p) => p.id)
    return valid.includes(globalPeriod as ActivityStatsPeriod) ? (globalPeriod as ActivityStatsPeriod) : '1w'
  })
  const [view, setView] = useState<View>('byServer')
  const [data, setData] = useState<ServerWorkflowEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    getUserServerStats(period, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setData(d.byServerWorkflow ?? [])
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [period])

  const byWorkflow = useMemo(() => pivotToWorkflows(data), [data])
  const isEmpty = view === 'byServer' ? data.length === 0 : byWorkflow.length === 0

  const CLS_TAB_ACTIVE = 'px-3 py-[0.2rem] rounded-md text-xs font-semibold bg-accent/20 text-accent-light border border-accent/30 cursor-pointer transition-colors'
  const CLS_TAB_IDLE = 'px-3 py-[0.2rem] rounded-md text-xs font-semibold bg-transparent text-muted border border-transparent cursor-pointer hover:text-primary transition-colors'

  return (
    <div className="bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-[0.6rem] border-b border-default text-sm font-semibold uppercase tracking-[0.06em] text-muted shrink-0">
        <span className="flex-1">Workflow Repartition</span>
        <div className="flex gap-[0.2rem]">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={p.id === period ? CLS_TAB_ACTIVE : CLS_TAB_IDLE}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-default/50 mx-1" />
        <div className="flex gap-1">
          <button type="button" className={view === 'byServer' ? CLS_TAB_ACTIVE : CLS_TAB_IDLE} onClick={() => setView('byServer')}>
            By Server
          </button>
          <button type="button" className={view === 'byWorkflow' ? CLS_TAB_ACTIVE : CLS_TAB_IDLE} onClick={() => setView('byWorkflow')}>
            By Workflow
          </button>
        </div>
      </div>

      <div className="overflow-y-auto max-h-[420px] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-24 text-sm text-semantic-error px-4 text-center">{error}</div>
        ) : isEmpty ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted">No job history yet</div>
        ) : view === 'byServer' ? (
          data.map((e) => <ServerRow key={e.server} entry={e} aliases={aliases} />)
        ) : (
          byWorkflow.map((e) => <WorkflowRow key={e.name} entry={e} aliases={aliases} />)
        )}
      </div>
    </div>
  )
}
