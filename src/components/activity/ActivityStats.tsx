import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronLeft, ChevronRight, Search, Loader2, TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown, X, Filter, GripHorizontal } from 'lucide-react'
import { useActivityStats, ACTIVITY_STATS_PAGE_SIZE, type DoctorRankItem, type ActivityStatsPeriod } from './useActivityStats'
import { listWorkflows } from '@/services/api/workflows'
import type { CompletedJobSummary } from '@/services/api/stats'
import UnifiedJobModal from '@/components/modals/UnifiedJobModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import UserServerPanel from './UserServerPanel'
import SlowJobsPanel from './SlowJobsPanel'
import WorkflowPerformancePanel from './WorkflowPerformancePanel'
import { durationColorClass, formatDurationMs } from '@/utils/failureClassifier'

// ── localStorage keys ────────────────────────────────────────────────────────

const TABLE_HEIGHT_KEY = 'activity-job-history-height'
const DEFAULT_TABLE_HEIGHT = 400 // px
const MIN_TABLE_HEIGHT = 150
const MAX_TABLE_HEIGHT = 1200

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

const COL_ORDER_KEY = 'activity-job-history-col-order'
const DEFAULT_COLUMNS: ColumnKey[] = ['id', 'name', 'total', 'generation', 'server', 'user', 'finished']

type ColumnKey = 'id' | 'name' | 'total' | 'generation' | 'server' | 'user' | 'finished'

const COLUMN_LABELS: Record<ColumnKey, string> = {
  id: 'Job ID',
  name: 'Workflow',
  total: 'Total Time',
  generation: 'Gen. Time',
  server: 'Server',
  user: 'User',
  finished: 'Completed',
}

const COLUMN_TOOLTIPS: Partial<Record<ColumnKey, string>> = {
  total: 'Queue wait + generation time',
  generation: 'ComfyUI processing time only',
}

// Migration: convert old column order that used 'duration' to new keys
function migrateColumnOrder(order: string[]): ColumnKey[] | null {
  if (order.includes('duration')) {
    const migrated: ColumnKey[] = []
    for (const col of order) {
      if (col === 'duration') {
        migrated.push('total', 'generation')
      } else if (DEFAULT_COLUMNS.includes(col as ColumnKey)) {
        migrated.push(col as ColumnKey)
      }
    }
    if (migrated.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((k) => migrated.includes(k))) {
      return migrated
    }
  }
  return null
}

function loadColumnOrder(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed)) {
        if (parsed.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((k) => parsed.includes(k))) {
          return parsed as ColumnKey[]
        }
        const migrated = migrateColumnOrder(parsed)
        if (migrated) {
          saveColumnOrder(migrated)
          return migrated
        }
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_COLUMNS
}

function saveColumnOrder(order: ColumnKey[]) {
  try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(order)) } catch { /* ignore */ }
}

// ── Shared style constants ───────────────────────────────────────────────────

const CLS_PANEL = 'bg-primary border border-default rounded-[10px] p-[1rem_1.15rem] flex flex-col gap-[0.35rem] min-h-0 overflow-hidden'
const CLS_PANEL_HEADER = 'text-sm font-semibold uppercase tracking-[0.04em] text-muted mb-1'
const CLS_PANEL_EMPTY = 'flex-1 flex items-center justify-center text-muted text-sm py-4'
const CLS_PAG_BTN = 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-default bg-transparent text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary disabled:opacity-30 disabled:cursor-default'
const CLS_FILTER_BTN = 'inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none bg-transparent text-muted rounded cursor-pointer opacity-40 group-hover:opacity-100 transition-all duration-150 shrink-0 hover:text-accent-light hover:bg-accent/[0.12]'
const CLS_WF_LINK = 'bg-transparent border-none p-0 m-0 font-[inherit] text-sm text-primary cursor-pointer text-left max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap block transition-colors hover:text-accent-light hover:underline hover:underline-offset-2 hover:decoration-accent/40'
const CLS_TD_BASE = 'px-4 py-[0.5rem] border-b border-default/50 text-sm overflow-hidden text-ellipsis whitespace-nowrap max-w-[220px]'
const CLS_FILTER_CHIP = 'inline-flex items-center gap-1 py-[3px] pl-[10px] pr-[8px] bg-accent/[0.12] border border-accent/25 rounded-[14px] text-sm text-[#c4b5d9] whitespace-nowrap max-w-[260px] overflow-hidden text-ellipsis'
const CLS_CHIP_REMOVE = 'inline-flex items-center justify-center w-4 h-4 p-0 border-none bg-transparent text-muted rounded-full cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent/20 hover:text-primary'

// ── Shared sub-components ────────────────────────────────────────────────────

function RankingCard({ title, items, emptyLabel, className, onItemClick }: { title: string; items: DoctorRankItem[]; emptyLabel: string; className?: string; onItemClick?: (name: string) => void }) {
  const max = items.length ? items[0].count : 1
  return (
    <div className={`${CLS_PANEL}${className ? ` ${className}` : ''}`}>
      <div className={CLS_PANEL_HEADER}>{title}</div>
      {items.length === 0 ? (
        <div className={CLS_PANEL_EMPTY}>{emptyLabel}</div>
      ) : (
        <ul className="activity-rank-list list-none m-0 pr-2 flex flex-col gap-[0.45rem] overflow-y-auto flex-1 min-h-0">
          {items.slice(0, 10).map((item) => (
            <li
              key={item.name}
              className={`grid grid-cols-[1fr_auto] gap-[0.4rem] items-center text-sm${onItemClick ? ' group cursor-pointer rounded-md px-[0.3rem] py-[0.1rem] -mx-[0.3rem] transition-colors hover:bg-accent/10' : ''}`}
              onClick={onItemClick ? () => onItemClick(item.name) : undefined}
              title={onItemClick ? item.name : undefined}
            >
              <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-primary${onItemClick ? ' transition-colors group-hover:text-[#c9a6f0]' : ''}`}>{item.name}</span>
              <span className="font-medium tabular-nums text-right min-w-[2.5rem] text-muted">{item.count.toLocaleString()}</span>
              <div className="col-span-full h-[5px] rounded-[3px] bg-[rgba(45,58,74,0.5)] overflow-hidden">
                <div
                  className="h-full rounded-[3px] transition-[width] duration-300"
                  style={{ width: `${(item.count / max) * 100}%`, background: 'linear-gradient(90deg,#6a3fa0,#9366cc)' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WeeklyCard({ history }: { history: { label: string; count: number }[] }) {
  const [weekIdx, setWeekIdx] = useState(0)
  const current = history[weekIdx]
  const previous = weekIdx < history.length - 1 ? history[weekIdx + 1] : null

  let trendColor = 'text-muted'
  let TrendIcon = Minus
  if (current && previous && current.count !== previous.count) {
    if (current.count > previous.count) {
      trendColor = 'text-semantic-success'
      TrendIcon = TrendingUp
    } else {
      trendColor = 'text-semantic-error'
      TrendIcon = TrendingDown
    }
  }

  const weekBtnCls = 'inline-flex items-center justify-center p-1 bg-transparent border border-default rounded-md text-muted cursor-pointer shrink-0 transition-all duration-150 hover:bg-accent/[0.08] hover:text-primary disabled:opacity-30 disabled:cursor-default'

  return (
    <div className={CLS_PANEL}>
      <div className={CLS_PANEL_HEADER}>Weekly Jobs</div>
      <div className="flex items-center gap-1 flex-1 min-h-0">
        <button type="button" className={weekBtnCls} disabled={weekIdx >= history.length - 1} onClick={() => setWeekIdx((i) => i + 1)} title="Older week">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 flex flex-col items-center gap-[0.1rem] text-center">
          <div className="text-[2rem] font-bold tabular-nums leading-[1.2] text-primary flex items-baseline gap-[0.4rem]">
            {current ? current.count.toLocaleString() : '—'}
            {current && previous && <TrendIcon size={16} className={`shrink-0 ${trendColor}`} />}
          </div>
          <div className="text-sm text-muted">{current?.label ?? '—'}</div>
          {current && previous && <div className="text-sm text-muted">vs. {previous.label}: {previous.count.toLocaleString()}</div>}
        </div>
        <button type="button" className={weekBtnCls} disabled={weekIdx <= 0} onClick={() => setWeekIdx((i) => i - 1)} title="More recent week">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatRelativeTime(ts: number | null): { text: string; title: string } {
  if (ts == null) return { text: '—', title: '' }
  const elapsed = Date.now() - ts
  const title = new Date(ts).toLocaleString()
  if (elapsed < 60_000) return { text: 'just now', title }
  if (elapsed < 3_600_000) return { text: `${Math.floor(elapsed / 60_000)}m ago`, title }
  if (elapsed < 86_400_000) return { text: `${Math.floor(elapsed / 3_600_000)}h ago`, title }
  const days = Math.floor(elapsed / 86_400_000)
  return { text: `${days}d ago`, title }
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortKey = 'total' | 'generation' | 'finished'

// ── Recent Jobs (used in Monitor view) ────────────────────────────────────────

export function RecentJobs({ refreshTrigger }: { refreshTrigger?: number }) {
  const s = useActivityStats()
  const navigate = useNavigate()

  const [logsJob, setLogsJob] = useState<CompletedJobSummary | null>(null)
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)

  const [workflowNames, setWorkflowNames] = useState<Set<string> | null>(null)
  const [wfError, setWfError] = useState<string | null>(null)

  useEffect(() => {
    listWorkflows(1, 0).then((wfs) => {
      setWorkflowNames(new Set(wfs.map((w) => w.name)))
    }).catch(() => { /* ignore */ })
  }, [])

  const prevTrigger = useRef(refreshTrigger ?? 0)
  useEffect(() => {
    if (refreshTrigger != null && refreshTrigger > prevTrigger.current) {
      prevTrigger.current = refreshTrigger
      s.refresh()
    }
  }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const sortKey = (s.jobsSort || null) as SortKey | null
  const sortDir = (s.jobsSortDir || 'desc') as 'asc' | 'desc'

  const toggleSort = useCallback((key: SortKey) => {
    if (s.jobsSort === key) {
      s.setJobsSort(key, s.jobsSortDir === 'asc' ? 'desc' : 'asc')
    } else {
      s.setJobsSort(key, 'desc')
    }
  }, [s.jobsSort, s.jobsSortDir, s.setJobsSort])

  const [tableHeight, setTableHeight] = useState(loadTableHeight)
  const tableResizeRef = useRef(false)

  const handleTableResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    tableResizeRef.current = true
    const startY = e.clientY
    const startH = tableHeight

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      const next = Math.max(MIN_TABLE_HEIGHT, Math.min(MAX_TABLE_HEIGHT, startH + delta))
      setTableHeight(next)
    }
    const onUp = () => {
      tableResizeRef.current = false
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

  const [colOrder, setColOrder] = useState<ColumnKey[]>(loadColumnOrder)
  const dragColRef = useRef<ColumnKey | null>(null)

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

  const [colWidths, setColWidths] = useState<Partial<Record<ColumnKey, number>>>({})

  const handleColResizeStart = useCallback((e: React.MouseEvent, col: ColumnKey) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.target as HTMLElement).closest('th')
    if (!th) return
    const startX = e.clientX
    const startW = th.offsetWidth

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const next = Math.max(60, startW + delta)
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

  const handleWorkflowClick = useCallback((name: string) => {
    if (!name || name === '—') return
    if (workflowNames && !workflowNames.has(name)) {
      setWfError(`Workflow "${name}" not found`)
      setTimeout(() => setWfError(null), 3000)
      return
    }
    navigate(`/workflows/workflow/${encodeURIComponent(name)}`)
  }, [navigate, workflowNames])

  const renderCell = useCallback((col: ColumnKey, job: CompletedJobSummary) => {
    switch (col) {
      case 'id':
        return (
          <td
            key={col}
            className={`${CLS_TD_BASE} text-muted`}
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(job.id) }}
            title={`${job.id} — click to copy`}
          >
            <span className="font-mono text-xs cursor-pointer hover:text-primary transition-colors select-none">
              {job.id.slice(0, 8)}…
            </span>
          </td>
        )
      case 'name':
        return (
          <td key={col} className={`${CLS_TD_BASE} text-primary`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className={CLS_WF_LINK}
                title={`Open ${job.name}`}
                onClick={(e) => { e.stopPropagation(); handleWorkflowClick(job.name) }}
              >
                {job.name || '—'}
              </button>
              {job.name && job.name !== '—' && (
                <button
                  type="button"
                  className={CLS_FILTER_BTN}
                  title={`Filter by workflow: ${job.name}`}
                  onClick={(e) => { e.stopPropagation(); s.setJobsFilter('workflow', job.name) }}
                >
                  <Filter size={11} />
                </button>
              )}
            </span>
            {job.status && job.status !== 'completed' && (
              <span className="inline-block ml-[6px] px-[6px] py-[1px] rounded-[3px] text-sm font-semibold uppercase tracking-[0.03em] bg-semantic-error/[0.15] text-semantic-error">
                {job.status}
              </span>
            )}
          </td>
        )
      case 'server': {
        const shortSrv = job.server && job.server !== '—' ? (() => {
          try { const u = new URL(job.server); return `${u.hostname}${u.port ? `:${u.port}` : ''}` }
          catch { return job.server.replace(/^https?:\/\//, '').replace(/\/$/, '') }
        })() : null
        return (
          <td key={col} className={`${CLS_TD_BASE} text-primary`}>
            <span className="inline-flex items-center gap-[3px]">
              {shortSrv ? (
                <button
                  type="button"
                  className={CLS_WF_LINK}
                  title={`View logs for ${job.server}`}
                  onClick={(e) => { e.stopPropagation(); setLogsServerUrl(job.server) }}
                >
                  {shortSrv}
                </button>
              ) : (
                <span className="text-sm text-primary">{job.server}</span>
              )}
              {shortSrv && (
                <button type="button" className={CLS_FILTER_BTN} title="Filter by server" onClick={(e) => { e.stopPropagation(); s.setJobsFilter('server', job.server) }}>
                  <Filter size={11} />
                </button>
              )}
            </span>
          </td>
        )
      }
      case 'user':
        return (
          <td key={col} className={`${CLS_TD_BASE} text-primary`}>
            <span className="inline-flex items-center gap-[3px]">
              <span className="text-sm text-primary">{job.user}</span>
              {job.user && job.user !== '—' && (
                <button type="button" className={CLS_FILTER_BTN} title="Filter by user" onClick={(e) => { e.stopPropagation(); s.setJobsFilter('user', job.user) }}>
                  <Filter size={11} />
                </button>
              )}
            </span>
          </td>
        )
      case 'total': {
        const total = (job.finishedOn != null && job.timestamp != null) ? job.finishedOn - job.timestamp : null
        return <td key={col} className={`${CLS_TD_BASE} tabular-nums ${durationColorClass(total)}`}>{formatDuration(total)}</td>
      }
      case 'generation':
        return (
          <td key={col} className={`${CLS_TD_BASE} tabular-nums ${durationColorClass(job.duration)}`}>
            {formatDuration(job.duration)}
            {job.duration != null && job.duration >= 600_000 && (
              <span className="ml-1 text-[10px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1 py-px align-middle">SLOW</span>
            )}
          </td>
        )
      case 'finished': {
        const rel = formatRelativeTime(job.finishedOn)
        return <td key={col} className={`${CLS_TD_BASE} text-muted`} title={rel.title}>{rel.text}</td>
      }
    }
  }, [handleWorkflowClick, s.setJobsFilter, setLogsServerUrl])

  const SORTABLE_COLS: ColumnKey[] = ['total', 'generation', 'finished']

  const SortIcon = useCallback(({ col }: { col: ColumnKey }) => {
    if (!SORTABLE_COLS.includes(col)) return null
    const active = sortKey === col
    return (
      <span className={`inline-flex transition-opacity duration-150 ${active ? 'opacity-100 text-accent-light' : 'opacity-30'}`}>
        {active && sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      </span>
    )
  }, [sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(s.jobsTotal / ACTIVITY_STATS_PAGE_SIZE))
  const pageStart = s.jobsTotal === 0 ? 0 : (s.jobsPage - 1) * ACTIVITY_STATS_PAGE_SIZE + 1
  const pageEnd = Math.min(s.jobsPage * ACTIVITY_STATS_PAGE_SIZE, s.jobsTotal)
  const isSearching = s.searchPending || s.jobsLoading

  if (s.loading && s.configured === null) {
    return (
      <div className="flex items-center justify-center gap-3 py-8 text-muted text-sm">
        <span className="w-[18px] h-[18px] border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />
        <span>Loading…</span>
      </div>
    )
  }
  if (s.configured === false) return null

  return (
    <div className="bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-[1.15rem] py-[0.85rem] bg-[rgba(36,48,68,0.5)] border-b border-default flex-wrap">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-[0.04em] text-muted leading-none">Job History</h2>
        {s.jobsTotal > 0 && (
          <span className="text-sm text-muted/80 leading-none">{s.jobsTotal.toLocaleString()} total</span>
        )}
        <div className="flex-1" />
        <div className="relative flex items-center">
          {isSearching
            ? <Loader2 size={14} className="absolute left-[0.6rem] text-muted pointer-events-none animate-spin" />
            : <Search size={14} className="absolute left-[0.6rem] text-muted pointer-events-none" />
          }
          <input
            type="text"
            className="pl-[1.85rem] pr-[0.6rem] py-[0.35rem] text-sm border border-default rounded-md bg-primary text-primary placeholder:text-muted focus:outline-none focus:border-accent transition-[border-color] w-[260px] max-w-full"
            placeholder="Search by ID, workflow, server or user…"
            value={s.jobsSearch}
            onChange={(e) => s.setJobsSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Filter chips row */}
      {(s.jobsFilters.user || s.jobsFilters.server || s.jobsFilters.workflow) && (
        <div className="flex items-center gap-[6px] flex-wrap px-[1.15rem] py-[6px] border-b border-default/50">
          <Filter size={13} className="text-muted shrink-0" />
          {s.jobsFilters.workflow && (
            <span className={CLS_FILTER_CHIP}>
              <span className="text-muted text-sm uppercase tracking-[0.04em] shrink-0">workflow:</span>
              {s.jobsFilters.workflow}
              <button type="button" className={CLS_CHIP_REMOVE} onClick={() => s.setJobsFilter('workflow', '')} title="Remove filter">
                <X size={12} />
              </button>
            </span>
          )}
          {s.jobsFilters.server && (
            <span className={CLS_FILTER_CHIP}>
              <span className="text-muted text-sm uppercase tracking-[0.04em] shrink-0">server:</span>
              {s.jobsFilters.server}
              <button type="button" className={CLS_CHIP_REMOVE} onClick={() => s.setJobsFilter('server', '')} title="Remove filter">
                <X size={12} />
              </button>
            </span>
          )}
          {s.jobsFilters.user && (
            <span className={CLS_FILTER_CHIP}>
              <span className="text-muted text-sm uppercase tracking-[0.04em] shrink-0">user:</span>
              {s.jobsFilters.user}
              <button type="button" className={CLS_CHIP_REMOVE} onClick={() => s.setJobsFilter('user', '')} title="Remove filter">
                <X size={12} />
              </button>
            </span>
          )}
          {Object.values(s.jobsFilters).filter(Boolean).length > 1 && (
            <button type="button" className="text-sm text-muted bg-transparent border-none cursor-pointer px-[6px] py-[2px] transition-colors hover:text-accent-light" onClick={s.clearJobsFilters}>Clear all</button>
          )}
        </div>
      )}

      {/* Error */}
      {wfError && (
        <div className="px-4 py-[0.4rem] bg-semantic-error/[0.08] border-b border-semantic-error/20 text-semantic-error text-sm">
          {wfError}
        </div>
      )}

      {/* Table or empty state */}
      {s.jobsLoading && s.jobs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm py-8">Loading jobs…</div>
      ) : s.jobs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm py-8">
          {s.jobsSearch ? `No results for "${s.jobsSearch}".` : 'No completed jobs in the queue.'}
        </div>
      ) : (
        <>
          <div className="activity-table-scroll overflow-x-auto" style={{ maxHeight: `${tableHeight}px` }}>
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
                      onClick={SORTABLE_COLS.includes(col) ? () => toggleSort(col as SortKey) : undefined}
                      className={`relative text-left px-4 py-[0.5rem] text-sm font-semibold uppercase tracking-[0.04em] text-muted border-b border-default whitespace-nowrap${SORTABLE_COLS.includes(col) ? ' cursor-pointer select-none hover:text-primary' : ''}`}
                      style={colWidths[col] ? { width: `${colWidths[col]}px` } : undefined}
                      title={COLUMN_TOOLTIPS[col]}
                    >
                      <span className="inline-flex items-center gap-[0.3rem]">
                        {COLUMN_LABELS[col]}
                        <SortIcon col={col} />
                      </span>
                      <span
                        className="activity-col-resize"
                        onMouseDown={(e) => handleColResizeStart(e, col)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="group cursor-pointer transition-colors hover:bg-accent/[0.08]"
                    onClick={() => setLogsJob(job)}
                    title={`View details for job ${job.id}`}
                  >
                    {colOrder.map((col) => renderCell(col, job))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="relative flex items-center justify-center px-4 py-[0.6rem]">
            <div className="flex items-center gap-3">
              <button type="button" className={CLS_PAG_BTN} disabled={s.jobsPage <= 1 || s.jobsLoading} onClick={() => s.setJobsPage(s.jobsPage - 1)}>
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-muted tabular-nums">{pageStart}–{pageEnd} of {s.jobsTotal.toLocaleString()}</span>
              <button type="button" className={CLS_PAG_BTN} disabled={s.jobsPage >= totalPages || s.jobsLoading} onClick={() => s.setJobsPage(s.jobsPage + 1)}>
                <ChevronRight size={16} />
              </button>
            </div>
            <div
              className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center cursor-row-resize text-muted/70 p-[2px_4px] rounded transition-all duration-150 hover:text-accent-light hover:bg-accent/10"
              onMouseDown={handleTableResizeStart}
              onDoubleClick={() => { setTableHeight(DEFAULT_TABLE_HEIGHT); saveTableHeight(DEFAULT_TABLE_HEIGHT) }}
              title="Drag to resize table height · Double-click to reset"
            >
              <GripHorizontal size={14} />
            </div>
          </div>
        </>
      )}

      {logsJob && <UnifiedJobModal jobId={logsJob.id} jobSummary={logsJob} onClose={() => setLogsJob(null)} />}
      {logsServerUrl && <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />}
    </div>
  )
}

// ── Stats Panels (used in Insights view) ──────────────────────────────────────

export function StatsPanels({ period, setPeriod }: { period: ActivityStatsPeriod; setPeriod: (p: ActivityStatsPeriod) => void }) {
  const s = useActivityStats(period, setPeriod)
  const navigate = useNavigate()
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)

  const handleWorkflowClick = useCallback((name: string) => {
    navigate(`/workflows/workflow/${encodeURIComponent(name)}`)
  }, [navigate])

  if (s.loading && s.configured === null) {
    return (
      <div className="flex items-center justify-center gap-3 py-8 text-muted text-sm">
        <span className="w-[18px] h-[18px] border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />
        <span>Loading stats…</span>
      </div>
    )
  }
  if (s.error) {
    return (
      <div className="flex items-center gap-2 py-8 px-4 text-semantic-error text-sm">
        <AlertCircle size={20} />{s.error}
      </div>
    )
  }
  if (s.configured === false) return null

  return (
    <>
      <div className="flex flex-col gap-5 pb-8">
        <div className="grid gap-3 [grid-template-columns:1fr_1fr_1fr] [grid-template-rows:1fr_1fr] [height:calc(100vh-180px)] min-h-[400px] max-[900px]:[grid-template-columns:1fr] max-[900px]:[grid-template-rows:auto]">
          <div className={CLS_PANEL}>
            <div className={CLS_PANEL_HEADER}>Total Completed Jobs</div>
            <div className="text-[2.2rem] font-bold leading-[1.2] text-accent flex-1 flex items-center justify-center">{s.totalCompleted.toLocaleString()}</div>
            <div className="text-sm text-muted text-center">All time</div>
          </div>
          <WeeklyCard history={s.weeklyHistory} />
          <RankingCard
            className="[grid-column:3] [grid-row:1/3] max-[900px]:[grid-column:1] max-[900px]:[grid-row:auto]"
            title="Top Workflows"
            items={s.topWorkflows}
            emptyLabel="No workflows in this period"
            onItemClick={handleWorkflowClick}
          />
          <RankingCard title="Top Servers" items={s.topServers} emptyLabel="No server activity in this period" onItemClick={setLogsServerUrl} />
          <RankingCard title="Top Users" items={s.topUsers} emptyLabel="No user activity in this period" />
        </div>
        <WorkflowPerformancePanel period={period} />
        <UserServerPanel period={period} />
        <SlowJobsPanel period={period} />
      </div>
      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}
    </>
  )
}

// Keep backward compat default export
export function ActivityStats() {
  const [period, setPeriod] = useState<ActivityStatsPeriod>('1d')
  return (
    <>
      <RecentJobs />
      <StatsPanels period={period} setPeriod={setPeriod} />
    </>
  )
}
