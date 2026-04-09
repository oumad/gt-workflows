import { useState, useEffect, useRef } from 'react'
import { getUserServerStats, type UserServerEntry, type ServerUserEntry } from '@/services/api/stats'
import type { ActivityStatsPeriod } from './useActivityStats'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'

interface Props {
  period: ActivityStatsPeriod
}

const COLORS = [
  '#6a3fa0', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
]

/** Stable color index by hashing a string. Same name → same color index. */
function colorIndex(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h) % COLORS.length
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`
}

const CLS_PANEL = 'bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col'
const CLS_PANEL_HEADER = 'flex items-center gap-2 px-4 py-[0.6rem] border-b border-default text-sm font-semibold uppercase tracking-[0.06em] text-muted shrink-0'
const CLS_TAB_ACTIVE = 'px-3 py-[0.2rem] rounded-md text-xs font-semibold bg-accent/20 text-accent-light border border-accent/30 cursor-pointer transition-colors'
const CLS_TAB_IDLE = 'px-3 py-[0.2rem] rounded-md text-xs font-semibold bg-transparent text-muted border border-transparent cursor-pointer hover:text-primary transition-colors'

type Metric = 'count' | 'time'

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

function WorkflowBreakdown({ workflows, metric }: { workflows: UserServerEntry['workflows']; metric: Metric }) {
  if (!workflows || workflows.length === 0) return null
  return (
    <div className="mt-[0.35rem] pl-3 border-l-2 border-default/40 flex flex-col gap-[0.25rem]">
      {workflows.map((wf) => {
        const pct = metric === 'time' ? (wf.durationPct ?? wf.pct) : wf.pct
        const detail = metric === 'time' && wf.durationMs != null
          ? formatDuration(wf.durationMs)
          : `${wf.count.toLocaleString()} job${wf.count !== 1 ? 's' : ''}`
        return (
          <div key={wf.name} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-[0.15rem]">
                <span className="text-xs text-primary/80 overflow-hidden text-ellipsis whitespace-nowrap flex-1" title={wf.name}>
                  {wf.name}
                </span>
                <span className="text-[10px] tabular-nums text-muted/70 shrink-0">{pct}%</span>
                <span className="text-[10px] tabular-nums text-muted/50 shrink-0">({detail})</span>
              </div>
              <div className="h-[4px] rounded-[2px] overflow-hidden bg-[rgba(45,58,74,0.4)]">
                <div
                  className="h-full rounded-[2px]"
                  style={{ width: `${pct}%`, background: COLORS[colorIndex(wf.name)] }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UserRow({ entry, metric, aliases }: { entry: UserServerEntry; metric: Metric; aliases: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false)
  const hasWorkflows = (entry.workflows?.length ?? 0) > 0

  const segments = entry.servers.map((s) => ({
    label: displayServerName(s.server, aliases),
    pct: metric === 'time' ? (s.durationPct ?? s.pct) : s.pct,
    color: COLORS[colorIndex(s.server)],
  }))

  const totalLabel = metric === 'time'
    ? (entry.totalDurationMs != null ? formatDuration(entry.totalDurationMs) : `${entry.total} jobs`)
    : `${entry.total.toLocaleString()} jobs`

  return (
    <div className="flex flex-col gap-[0.3rem] px-4 py-[0.6rem] border-b border-default last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap" title={entry.user}>
          {entry.user}
        </span>
        <span className="text-xs tabular-nums text-muted shrink-0">{totalLabel}</span>
        {hasWorkflows && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-[10px] tabular-nums text-muted/60 hover:text-accent-light transition-colors px-1 py-px rounded border border-transparent hover:border-accent/30 cursor-pointer bg-transparent"
            title={expanded ? 'Hide workflow breakdown' : 'Show workflow breakdown'}
          >
            {expanded ? '▼' : '▶'} workflows
          </button>
        )}
      </div>
      <StackedBar segments={segments} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-[0.1rem]">
        {entry.servers.map((s) => {
          const pct = metric === 'time' ? (s.durationPct ?? s.pct) : s.pct
          const detail = metric === 'time' && s.durationMs != null
            ? formatDuration(s.durationMs)
            : `${s.count.toLocaleString()} jobs`
          return (
            <span key={s.server} className="inline-flex items-center gap-1 text-xs text-muted" title={s.server}>
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: COLORS[colorIndex(s.server)] }}
              />
              {displayServerName(s.server, aliases)}
              <span className="tabular-nums text-muted/70">{pct}%</span>
              <span className="tabular-nums text-muted/50">({detail})</span>
            </span>
          )
        })}
      </div>
      {expanded && <WorkflowBreakdown workflows={entry.workflows} metric={metric} />}
    </div>
  )
}

function ServerRow({ entry, metric, aliases }: { entry: ServerUserEntry; metric: Metric; aliases: Record<string, string> }) {
  const segments = entry.users.map((u) => ({
    label: u.user,
    pct: metric === 'time' ? (u.durationPct ?? u.pct) : u.pct,
    color: COLORS[colorIndex(u.user)],
  }))

  const totalLabel = metric === 'time'
    ? (entry.totalDurationMs != null ? formatDuration(entry.totalDurationMs) : `${entry.total} jobs`)
    : `${entry.total.toLocaleString()} jobs`

  return (
    <div className="flex flex-col gap-[0.3rem] px-4 py-[0.6rem] border-b border-default last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-primary font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap" title={entry.server}>
          {displayServerName(entry.server, aliases)}
        </span>
        <span className="text-xs tabular-nums text-muted shrink-0">{totalLabel}</span>
      </div>
      <StackedBar segments={segments} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-[0.1rem]">
        {entry.users.map((u) => {
          const pct = metric === 'time' ? (u.durationPct ?? u.pct) : u.pct
          const detail = metric === 'time' && u.durationMs != null
            ? formatDuration(u.durationMs)
            : `${u.count.toLocaleString()} jobs`
          return (
            <span key={u.user} className="inline-flex items-center gap-1 text-xs text-muted">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: COLORS[colorIndex(u.user)] }}
              />
              {u.user}
              <span className="tabular-nums text-muted/70">{pct}%</span>
              <span className="tabular-nums text-muted/50">({detail})</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function UserServerPanel({ period }: Props) {
  const [view, setView] = useState<'byUser' | 'byServer'>('byUser')
  const [metric, setMetric] = useState<Metric>('count')
  const [byUser, setByUser] = useState<UserServerEntry[]>([])
  const [byServer, setByServer] = useState<ServerUserEntry[]>([])
  const aliases = useServerAliases()
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
        setByUser(d.byUser ?? [])
        setByServer(d.byServer ?? [])
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [period])

  const isEmpty = view === 'byUser' ? byUser.length === 0 : byServer.length === 0

  return (
    <div className={CLS_PANEL}>
      <div className={CLS_PANEL_HEADER}>
        <span className="flex-1">Server Distribution</span>
        <div className="flex gap-1 mr-2 border-r border-default pr-2">
          <button type="button" className={metric === 'count' ? CLS_TAB_ACTIVE : CLS_TAB_IDLE} onClick={() => setMetric('count')}>
            Jobs
          </button>
          <button type="button" className={metric === 'time' ? CLS_TAB_ACTIVE : CLS_TAB_IDLE} onClick={() => setMetric('time')}>
            Time
          </button>
        </div>
        <div className="flex gap-1">
          <button type="button" className={view === 'byUser' ? CLS_TAB_ACTIVE : CLS_TAB_IDLE} onClick={() => setView('byUser')}>
            By User
          </button>
          <button type="button" className={view === 'byServer' ? CLS_TAB_ACTIVE : CLS_TAB_IDLE} onClick={() => setView('byServer')}>
            By Server
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto activity-rank-list [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-24 text-sm text-semantic-error px-4 text-center">{error}</div>
        ) : isEmpty ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted">No data for this period</div>
        ) : view === 'byUser' ? (
          byUser.map((entry) => <UserRow key={entry.user} entry={entry} metric={metric} aliases={aliases} />)
        ) : (
          byServer.map((entry) => <ServerRow key={entry.server} entry={entry} metric={metric} aliases={aliases} />)
        )}
      </div>
    </div>
  )
}
