import React, { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, Search, Hash, Percent, Timer, TimerOff, Loader2, Filter, X, GripHorizontal } from 'lucide-react'
import { useDoctor, DOCTOR_PERIODS, FAILED_JOBS_PAGE_SIZE } from './useDoctor'
import FailedJobModal from './FailedJobModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import type { DoctorRankItem, FailedJobSummary, DoctorPeriod, WeeklyHistoryItem } from '@/services/api/stats'
import './Doctor.css'
import './FailedJobModal.css'

// ── Column system ─────────────────────────────────────────────────────────────

const TABLE_HEIGHT_KEY = 'doctor-failed-table-height'
const COL_ORDER_KEY = 'doctor-failed-col-order'
const DEFAULT_TABLE_HEIGHT = 400
const MIN_TABLE_HEIGHT = 150
const MAX_TABLE_HEIGHT = 1200

type ColumnKey = 'id' | 'workflow' | 'server' | 'error' | 'user' | 'time' | 'duration'

const DEFAULT_COLUMNS: ColumnKey[] = ['id', 'workflow', 'server', 'error', 'user', 'duration', 'time']

const COLUMN_LABELS: Record<ColumnKey, string> = {
  id: 'Job',
  workflow: 'Workflow',
  server: 'Server',
  error: 'Error',
  user: 'User',
  time: 'Failed at',
  duration: 'Ran for',
}

function loadTableHeight(): number {
  try {
    const v = Number(localStorage.getItem(TABLE_HEIGHT_KEY))
    if (v >= MIN_TABLE_HEIGHT && v <= MAX_TABLE_HEIGHT) return v
  } catch { /* ignore */ }
  return DEFAULT_TABLE_HEIGHT
}

function saveTableHeight(h: number) {
  try { localStorage.setItem(TABLE_HEIGHT_KEY, String(h)) } catch { /* ignore */ }
}

function loadColumnOrder(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed) && parsed.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((k) => parsed.includes(k))) {
        return parsed as ColumnKey[]
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_COLUMNS
}

function saveColumnOrder(order: ColumnKey[]) {
  try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(order)) } catch { /* ignore */ }
}

// ── Shared style constants (stable — not component-scoped) ────────────────────

const CARD = 'bg-secondary border border-default/70 rounded-[10px] px-[1.1rem] py-4 flex flex-col gap-1'
const CARD_HEADER = 'text-sm font-semibold uppercase tracking-[0.06em] text-muted mb-[0.1rem]'
const TD = 'py-2 px-4 border-b border-default/35 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-secondary group-hover:text-primary'
const TD_MUTED = 'py-2 px-4 border-b border-default/35 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-muted group-hover:text-primary'
const CELL_LINK = 'bg-transparent border-none text-[#c9a6f0] text-[inherit] font-[inherit] cursor-pointer p-0 text-left overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px] transition-colors duration-[120ms] hover:text-primary hover:underline hover:decoration-[#c9a6f0]/40'
const FILTER_BTN = 'inline-flex items-center justify-center w-[18px] h-[18px] bg-transparent border-none text-[#354556] cursor-pointer rounded-[3px] p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-[opacity,color,background] duration-[120ms] hover:text-[#c9a6f0] hover:bg-accent/15'
const CHIP = 'inline-flex items-center gap-[0.3rem] py-[0.15rem] pr-[0.35rem] pl-2 bg-accent/[0.12] border border-accent/30 rounded-[5px] text-sm text-[#c9a6f0]'
const CHIP_REMOVE = 'inline-flex items-center justify-center bg-transparent border-none text-muted cursor-pointer p-[1px] rounded-[3px] transition-colors hover:text-primary'
const NAV_BTN = 'inline-flex items-center justify-center w-7 h-7 bg-transparent border border-default rounded-md text-muted cursor-pointer shrink-0 transition-[background,color] duration-150 enabled:hover:bg-tertiary enabled:hover:text-primary disabled:opacity-30 disabled:cursor-default'

// ── Sub-components ────────────────────────────────────────────────────────────

function WeeklyTrendCard({ history }: { history: WeeklyHistoryItem[] }): React.ReactElement {
  const [weekIdx, setWeekIdx] = useState(0)
  const [showPct, setShowPct] = useState(false)
  const current = history[weekIdx]
  const previous = weekIdx < history.length - 1 ? history[weekIdx + 1] : null
  const hasPrev = weekIdx < history.length - 1
  const hasNext = weekIdx > 0

  let trendColor = 'text-muted'
  let TrendIcon = Minus
  if (current && previous && current.count !== previous.count) {
    if (current.count > previous.count) {
      trendColor = 'text-semantic-error'
      TrendIcon = TrendingUp
    } else {
      trendColor = 'text-semantic-success'
      TrendIcon = TrendingDown
    }
  }

  const failRate = current && current.total > 0
    ? ((current.count / current.total) * 100)
    : 0

  return (
    <div className={`${CARD} flex-1`}>
      <div className="flex items-center justify-between gap-2 mb-[0.4rem]">
        <span className={CARD_HEADER}>Weekly Failure Trend</span>
        <button
          type="button"
          className={`inline-flex items-center justify-center w-[26px] h-[26px] border rounded-[5px] cursor-pointer transition-[background,color,border-color] duration-150 hover:bg-tertiary hover:text-primary ${showPct ? 'bg-accent/15 border-accent text-[#c9a6f0]' : 'bg-transparent border-default text-muted'}`}
          onClick={() => setShowPct((v) => !v)}
          title={showPct ? 'Show count' : 'Show failure rate'}
        >
          {showPct ? <Hash size={13} /> : <Percent size={13} />}
        </button>
      </div>
      <div className="flex items-center gap-1 flex-1">
        <button type="button" className={NAV_BTN} disabled={!hasPrev} onClick={() => setWeekIdx((i) => i + 1)} title="Older week">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 flex flex-col items-center gap-[0.1rem] text-center">
          <div className="text-[1.9rem] font-bold tabular-nums leading-[1.2] text-primary flex items-baseline gap-[0.4rem]">
            {showPct
              ? (current ? `${failRate % 1 === 0 ? failRate.toFixed(0) : failRate.toFixed(1)}%` : '—')
              : (current ? current.count.toLocaleString() : '—')
            }
            {current && previous && (
              <TrendIcon size={16} className={`shrink-0 ${trendColor}`} />
            )}
          </div>
          <div className="text-sm text-muted">{current?.label ?? '—'}</div>
          {current && (
            <div className="text-sm text-[#697784] mt-[0.1rem]">
              {showPct
                ? `${current.count.toLocaleString()} failures / ${current.total.toLocaleString()} total`
                : previous ? `vs. ${previous.label}: ${previous.count.toLocaleString()}` : ''
              }
            </div>
          )}
        </div>
        <button type="button" className={NAV_BTN} disabled={!hasNext} onClick={() => setWeekIdx((i) => i - 1)} title="More recent week">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

function RankingCard({ title, items, emptyLabel, onItemClick }: {
  title: string
  items: DoctorRankItem[]
  emptyLabel: string
  onItemClick?: (name: string) => void
}): React.ReactElement {
  const max = items.length ? items[0].count : 1
  const clickable = Boolean(onItemClick)
  return (
    <div className={`${CARD} min-h-[140px] max-h-[320px] overflow-hidden`}>
      <div className={CARD_HEADER}>{title}</div>
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm py-5">{emptyLabel}</div>
      ) : (
        <ul className="doctor-rank-list list-none m-0 mt-[0.4rem] pr-1 pb-1 flex flex-col gap-[0.4rem] overflow-y-auto flex-1 min-h-0">
          {items.slice(0, 10).map((item) => (
            <li
              key={item.name}
              className={`grid grid-cols-[1fr_auto] gap-[0.35rem] items-center text-sm${clickable ? ' group cursor-pointer rounded px-[0.2rem] -mx-[0.2rem] transition-[background] duration-[120ms] hover:bg-accent/10' : ''}`}
              onClick={onItemClick ? () => onItemClick(item.name) : undefined}
              title={item.name}
            >
              <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-secondary${clickable ? ' group-hover:text-[#c9a6f0]' : ''}`}>{item.name}</span>
              <span className="font-semibold tabular-nums text-right min-w-9 text-semantic-error text-sm">{item.count.toLocaleString()}</span>
              <div className="col-span-2 h-[2px] rounded-[2px] bg-default/60 overflow-hidden">
                <div className="h-full rounded-[2px] bg-gradient-to-r from-[#7a2a2a] to-semantic-error transition-[width] duration-300" style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatShortTs(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatRunDuration(processedOn: number | null, finishedOn: number | null): string {
  if (processedOn == null || finishedOn == null) return '—'
  const ms = finishedOn - processedOn
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// Heuristic: if the job ran for 5+ minutes it's more likely a timeout than a user abort
function getDurationHint(processedOn: number | null, finishedOn: number | null, failedReason?: string | null): { label: string; cls: string } | null {
  if (processedOn == null || finishedOn == null) return null
  const ms = finishedOn - processedOn
  if (ms < 0) return null
  if (ms >= 5 * 60 * 1000) return { label: 'timeout?', cls: 'text-[#d4a335] bg-[#d4a335]/10 border-[#d4a335]/25' }
  if (ms < 10_000 && failedReason === 'Aborted') return { label: 'quick abort', cls: 'text-muted bg-secondary border-default' }
  return null
}

function formatRefreshedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getShortError(reason: string | null): string {
  if (!reason) return ''
  const first = reason.split('\n')[0].trim()
  return first.length > 80 ? first.slice(0, 77) + '…' : first
}

function getErrorFirstLine(reason: string | null): string {
  if (!reason) return ''
  return reason.split('\n')[0].trim().slice(0, 120)
}

// ── Main component ────────────────────────────────────────────────────────────

export function Doctor(): React.ReactElement {
  const d = useDoctor()
  const navigate = useNavigate()
  const [selectedJob, setSelectedJob] = useState<FailedJobSummary | null>(null)
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)

  // Column system
  const [tableHeight, setTableHeight] = useState(loadTableHeight)
  const [colOrder, setColOrder] = useState<ColumnKey[]>(loadColumnOrder)
  const [colWidths, setColWidths] = useState<Partial<Record<ColumnKey, number>>>({})
  const dragColRef = useRef<ColumnKey | null>(null)

  const handleColResizeStart = useCallback((e: React.MouseEvent, col: ColumnKey) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.target as HTMLElement).closest('th')
    if (!th) return
    const startX = e.clientX
    const startW = th.offsetWidth
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(60, startW + (ev.clientX - startX))
      setColWidths((prev) => ({ ...prev, [col]: next }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleTableResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = tableHeight
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_TABLE_HEIGHT, Math.min(MAX_TABLE_HEIGHT, startH + (ev.clientY - startY)))
      setTableHeight(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setTableHeight((h) => { saveTableHeight(h); return h })
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [tableHeight])

  const handleDragStart = useCallback((col: ColumnKey) => {
    dragColRef.current = col
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((targetCol: ColumnKey) => {
    const source = dragColRef.current
    if (!source || source === targetCol) return
    setColOrder((prev) => {
      const next = [...prev]
      const srcIdx = next.indexOf(source)
      const tgtIdx = next.indexOf(targetCol)
      next.splice(srcIdx, 1)
      next.splice(tgtIdx, 0, source)
      saveColumnOrder(next)
      return next
    })
    dragColRef.current = null
  }, [])

  const totalPages = Math.max(1, Math.ceil(d.failedJobsTotal / FAILED_JOBS_PAGE_SIZE))
  const pageStart = d.failedJobsTotal === 0 ? 0 : (d.failedJobsPage - 1) * FAILED_JOBS_PAGE_SIZE + 1
  const pageEnd = Math.min(d.failedJobsPage * FAILED_JOBS_PAGE_SIZE, d.failedJobsTotal)
  const isSearching = d.searchPending || d.failedJobsLoading

  const periodLabel = DOCTOR_PERIODS.find((p) => p.id === d.period)?.label ?? 'All time'
  const noDataLabel = (label: string) =>
    d.hideAborted ? `${label} (excl. aborted)` : label

  const hasFilters = Object.values(d.failedJobsFilters).some(Boolean)
  const activeFilterCount = Object.values(d.failedJobsFilters).filter(Boolean).length

  const handleWorkflowClick = useCallback((name: string) => {
    if (name && name !== '—') navigate(`/workflows/workflow/${encodeURIComponent(name)}`)
  }, [navigate])

  const autoLabel = d.autoInterval
    ? d.autoInterval < 60 ? `${d.autoInterval}s` : `${d.autoInterval / 60}m`
    : null

  const renderCell = useCallback((col: ColumnKey, job: FailedJobSummary) => {
    switch (col) {
      case 'id':
        return <td key={col} className={`${TD_MUTED} font-mono text-sm max-w-[80px]`}>{job.id}</td>
      case 'workflow':
        return (
          <td key={col} className={TD}>
            <span className="inline-flex items-center gap-1">
              {job.name && job.name !== '—' ? (
                <button type="button" className={CELL_LINK} title={`Open ${job.name}`} onClick={(e) => { e.stopPropagation(); handleWorkflowClick(job.name) }}>
                  {job.name}
                </button>
              ) : <span className="text-muted">—</span>}
              {job.name && job.name !== '—' && (
                <button type="button" className={FILTER_BTN} title="Filter by workflow" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('workflow', job.name) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      case 'server':
        return (
          <td key={col} className={TD}>
            <span className="inline-flex items-center gap-1">
              {job.server && job.server !== '—' ? (
                <button type="button" className={CELL_LINK} title={`View logs for ${job.server}`} onClick={(e) => { e.stopPropagation(); setLogsServerUrl(job.server) }}>
                  {job.server}
                </button>
              ) : <span className="text-muted">—</span>}
              {job.server && job.server !== '—' && (
                <button type="button" className={FILTER_BTN} title="Filter by server" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('server', job.server) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      case 'error': {
        const firstLine = getErrorFirstLine(job.failedReason)
        const shortErr = getShortError(job.failedReason)
        return (
          <td key={col} className="py-2 px-4 border-b border-default/35 max-w-[300px] text-semantic-error text-sm group-hover:text-semantic-error" title={job.failedReason ?? undefined}>
            <span className="flex w-full overflow-hidden gap-1">
              <span className="flex-1 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">{shortErr}</span>
              {firstLine && (
                <button type="button" className={FILTER_BTN} title="Filter by error" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('error', firstLine) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      }
      case 'user':
        return (
          <td key={col} className={TD}>
            <span className="inline-flex items-center gap-1">
              <span>{job.user}</span>
              {job.user && job.user !== '—' && (
                <button type="button" className={FILTER_BTN} title="Filter by user" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('user', job.user) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      case 'duration': {
        const hint = getDurationHint(job.processedOn, job.finishedOn, job.failedReason)
        const dur = formatRunDuration(job.processedOn, job.finishedOn)
        return (
          <td key={col} className={`${TD_MUTED} whitespace-nowrap text-sm`}>
            <span className="inline-flex items-center gap-1.5">
              <span className="tabular-nums">{dur}</span>
              {hint && (
                <span className={`text-xs px-[0.35em] py-[0.05em] rounded border ${hint.cls}`}>{hint.label}</span>
              )}
            </span>
          </td>
        )
      }
      case 'time':
        return <td key={col} className={`${TD_MUTED} whitespace-nowrap text-sm`}>{formatShortTs(job.finishedOn)}</td>
    }
  }, [handleWorkflowClick, d.setFailedJobsFilter, setLogsServerUrl])

  return (
    <div className="flex flex-col h-full text-[15px]">
      {/* Sticky header — top-14 = 3.5rem, sits below the h-14 app nav bar */}
      <div className="sticky top-14 z-20 bg-primary">
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <Stethoscope size={22} className="text-accent/70" />
            <h1 className="text-xl font-semibold text-primary m-0">Doctor</h1>
            <div className="flex-1 h-px bg-default/50 ml-2" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-6 py-[0.4rem] border-b border-default/40 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Period select */}
            <select
              className="h-8 px-[0.6rem] rounded-md border border-default bg-secondary text-primary text-sm cursor-pointer focus:outline-none focus:border-accent transition-[border-color] duration-150"
              value={d.period}
              onChange={(e) => d.setPeriod(e.target.value as DoctorPeriod)}
              disabled={d.loading}
            >
              {DOCTOR_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* Excl. aborted toggle */}
            <button
              type="button"
              className={`inline-flex items-center h-8 px-3 border rounded-md text-sm cursor-pointer transition-[background,border-color,color] duration-150 whitespace-nowrap ${d.hideAborted ? 'bg-accent/15 border-accent/40 text-[#c9a6f0] hover:bg-accent/22 hover:border-accent/55' : 'bg-secondary border-default text-muted hover:border-light hover:text-secondary'}`}
              onClick={() => d.setHideAborted(!d.hideAborted)}
              title="Exclude jobs aborted by the user from all panels"
            >
              Excl. aborted
            </button>

            {/* Refresh + auto-refresh grouped */}
            <div className="inline-flex items-stretch h-8 rounded-md border border-default overflow-hidden bg-secondary">
              <button
                type="button"
                className="inline-flex items-center justify-center px-[0.6rem] h-full border-r border-default text-sm text-primary hover:bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={d.refresh}
                disabled={d.loading}
                title={d.lastRefreshed ? `Refresh · last updated ${formatRefreshedTime(d.lastRefreshed)}` : 'Refresh data'}
              >
                <RefreshCw size={15} className={d.loading ? 'spin' : ''} />
              </button>
              <button
                type="button"
                className={`inline-flex items-center justify-center gap-[0.3rem] px-[0.6rem] h-full min-w-9 text-sm transition-colors ${d.autoInterval ? 'bg-accent/[0.18] text-[#c9a6f0]' : 'text-primary hover:bg-tertiary'}`}
                onClick={d.cycleAutoInterval}
                title={d.autoInterval
                  ? `Auto-refreshing every ${d.autoInterval < 60 ? `${d.autoInterval}s` : `${d.autoInterval / 60}m`} — click to cycle`
                  : 'Enable auto-refresh (5s → 30s → 1m → 5m)'}
              >
                {d.autoInterval ? <Timer size={15} /> : <TimerOff size={15} />}
                {autoLabel && <span>{autoLabel}</span>}
              </button>
            </div>
          </div>

          {d.lastRefreshed && (
            <span className="text-[0.8rem] text-muted whitespace-nowrap shrink-0">
              Updated {formatRefreshedTime(d.lastRefreshed)}
            </span>
          )}
        </div>
      </div>

      <div className="px-6 py-5">
        {d.loading && d.configured === null ? (
          <div className="text-center py-16 px-4 text-muted text-sm">Running diagnostics…</div>
        ) : d.error ? (
          <div className="flex items-center gap-2 p-4 px-5 text-semantic-error bg-semantic-error/[0.08] border border-semantic-error/20 rounded-lg text-sm">
            <AlertCircle size={18} />{d.error}
          </div>
        ) : d.configured === false ? (
          <div className="text-center py-16 px-4 text-muted text-sm">
            <p>Queue is not configured.</p>
            <p className="text-sm mt-2 text-[#697784]">
              Set <code>REDIS_URL</code> in the server environment to enable diagnostics.
            </p>
          </div>
        ) : (
          <>
            {/* Top row: summary cards + top error types */}
            <div className="grid grid-cols-[1fr_1.6fr] gap-4 mb-4 items-stretch max-[900px]:grid-cols-1">
              <div className="flex flex-col gap-4">
                <div className={CARD}>
                  <div className={CARD_HEADER}>Total Failures</div>
                  <div className="text-[2rem] font-bold leading-[1.2] text-primary flex items-baseline gap-2 tabular-nums">
                    {d.totalFailed.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted mt-[0.1rem]">
                    {periodLabel}{d.hideAborted ? ' · excl. aborted' : ''}
                  </div>
                </div>
                <WeeklyTrendCard history={d.weeklyHistory} />
              </div>
              <RankingCard
                title="Top Error Types"
                items={d.topErrors}
                emptyLabel={noDataLabel('No errors in this period')}
              />
            </div>

            {/* Rankings row */}
            <div className="grid grid-cols-3 gap-4 mb-4 max-[900px]:grid-cols-1">
              <RankingCard
                title="Workflows with Most Failures"
                items={d.topWorkflows}
                emptyLabel={noDataLabel('No failures in this period')}
                onItemClick={handleWorkflowClick}
              />
              <RankingCard
                title="Servers with Most Failures"
                items={d.topServers}
                emptyLabel={noDataLabel('No server failures in this period')}
                onItemClick={(url) => setLogsServerUrl(url)}
              />
              <RankingCard
                title="Users with Most Failures"
                items={d.topUsers}
                emptyLabel={noDataLabel('No user failures in this period')}
              />
            </div>

            {/* Failure log panel */}
            <div className="bg-secondary border border-default/70 rounded-[10px] overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between gap-3 py-3 px-[1.1rem] border-b border-default/60 flex-wrap">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[0.9rem] font-semibold m-0 text-primary">Failure Log</h2>
                  {d.failedJobsTotal > 0 && (
                    <span className="text-sm text-muted">{d.failedJobsTotal.toLocaleString()} entries</span>
                  )}
                </div>
                <div className="relative flex items-center">
                  {isSearching
                    ? <Loader2 size={14} className="absolute left-[0.6rem] text-muted pointer-events-none spin" />
                    : <Search size={14} className="absolute left-[0.6rem] text-muted pointer-events-none" />
                  }
                  <input
                    type="text"
                    className={`h-[30px] px-3 pl-8 text-sm border border-default rounded-md bg-primary text-primary w-[280px] max-w-full transition-[border-color] duration-150 placeholder:text-muted focus:outline-none focus:border-accent${isSearching ? ' opacity-60' : ''}`}
                    placeholder="Search by ID, workflow, server, user or message…"
                    value={d.failedJobsSearch}
                    onChange={(e) => d.setFailedJobsSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Active filter chips */}
              {hasFilters && (
                <div className="flex items-center gap-[0.4rem] py-[0.4rem] px-[1.1rem] border-b border-default/40 flex-wrap">
                  <Filter size={12} className="text-muted shrink-0" />
                  {d.failedJobsFilters.workflow && (
                    <span className={CHIP}>
                      <span className="text-muted text-sm">workflow:</span>
                      {d.failedJobsFilters.workflow}
                      <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('workflow', '')} title="Remove filter"><X size={11} /></button>
                    </span>
                  )}
                  {d.failedJobsFilters.server && (
                    <span className={CHIP}>
                      <span className="text-muted text-sm">server:</span>
                      {d.failedJobsFilters.server}
                      <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('server', '')} title="Remove filter"><X size={11} /></button>
                    </span>
                  )}
                  {d.failedJobsFilters.user && (
                    <span className={CHIP}>
                      <span className="text-muted text-sm">user:</span>
                      {d.failedJobsFilters.user}
                      <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('user', '')} title="Remove filter"><X size={11} /></button>
                    </span>
                  )}
                  {d.failedJobsFilters.error && (
                    <span className={CHIP}>
                      <span className="text-muted text-sm">error:</span>
                      {d.failedJobsFilters.error.length > 40 ? d.failedJobsFilters.error.slice(0, 37) + '…' : d.failedJobsFilters.error}
                      <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('error', '')} title="Remove filter"><X size={11} /></button>
                    </span>
                  )}
                  {activeFilterCount > 1 && (
                    <button
                      type="button"
                      className="bg-transparent border-none text-muted text-sm cursor-pointer py-[0.15rem] px-[0.35rem] rounded transition-[color,background] duration-[120ms] ml-[0.1rem] hover:text-primary hover:bg-tertiary"
                      onClick={d.clearFailedJobsFilters}
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}

              {d.failedJobsLoading && d.failedJobs.length === 0 ? (
                <div className="py-10 px-4 text-center text-muted text-sm">Loading…</div>
              ) : d.failedJobs.length === 0 ? (
                <div className="py-10 px-4 text-center text-muted text-sm">
                  {d.failedJobsSearch
                    ? `No results for "${d.failedJobsSearch}"${d.hideAborted ? ' (excl. aborted)' : ''}.`
                    : d.hideAborted
                      ? 'No failures found (excluding aborted).'
                      : 'No failures in the queue.'
                  }
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto doctor-table-scroll" style={{ maxHeight: `${tableHeight}px` }}>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          {colOrder.map((col) => (
                            <th
                              key={col}
                              draggable
                              onDragStart={() => handleDragStart(col)}
                              onDragOver={handleDragOver}
                              onDrop={() => handleDrop(col)}
                              style={colWidths[col] ? { width: `${colWidths[col]}px` } : undefined}
                              className="relative text-left py-[0.4rem] px-4 text-sm font-semibold uppercase tracking-[0.05em] text-muted border-b border-default/70 whitespace-nowrap cursor-grab select-none active:cursor-grabbing"
                            >
                              <span className="flex items-center gap-[0.3rem] pr-2">
                                {COLUMN_LABELS[col]}
                              </span>
                              <span
                                className="doctor-col-resize absolute right-0 top-0 bottom-0 w-[14px] flex items-center justify-center cursor-col-resize z-[2] bg-transparent hover:bg-accent-light/35 active:bg-accent-light/35"
                                onMouseDown={(e) => handleColResizeStart(e, col)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {d.failedJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="group cursor-pointer transition-[background] duration-[120ms] hover:bg-accent/5 doctor-failed-row"
                            onClick={() => setSelectedJob(job)}
                          >
                            {colOrder.map((col) => renderCell(col, job))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between gap-3 py-2 px-4 border-t border-default/50">
                    <div className="flex items-center gap-2 flex-1 justify-center">
                      <button
                        type="button"
                        className="btn btn-toolbar btn-sm"
                        disabled={d.failedJobsPage <= 1 || d.failedJobsLoading}
                        onClick={() => d.setFailedJobsPage(d.failedJobsPage - 1)}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-sm text-muted tabular-nums">
                        {pageStart}–{pageEnd} of {d.failedJobsTotal.toLocaleString()}
                      </span>
                      <button
                        type="button"
                        className="btn btn-toolbar btn-sm"
                        disabled={d.failedJobsPage >= totalPages || d.failedJobsLoading}
                        onClick={() => d.setFailedJobsPage(d.failedJobsPage + 1)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <div
                      className="flex items-center justify-center w-8 h-6 text-[#354556] cursor-row-resize rounded shrink-0 transition-[color,background] duration-[120ms] hover:text-muted hover:bg-tertiary"
                      onMouseDown={handleTableResizeStart}
                      onDoubleClick={() => { setTableHeight(DEFAULT_TABLE_HEIGHT); saveTableHeight(DEFAULT_TABLE_HEIGHT) }}
                      title="Drag to resize table · Double-click to reset"
                    >
                      <GripHorizontal size={14} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {selectedJob && (
        <FailedJobModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}
    </div>
  )
}
