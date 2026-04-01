import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Activity as ActivityIcon, Timer, TimerOff, Radio, BarChart2, Terminal, ChevronDown, ChevronUp } from 'lucide-react'
import { getQueueStatsWithJobLists } from '@/services/api/stats'
import { useAuth } from '@/features/auth'
import type { ActivityJob, QueueStatsWithJobsResponse } from '@/services/api/stats'
import { ACTIVITY_STATS_PERIODS, type ActivityStatsPeriod } from './useActivityStats'
import { formatDateTimeMedium } from '@/utils/dateFormat'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import ActivityJobModal from '@/components/modals/ActivityJobModal'
import { RecentJobs, StatsPanels } from './ActivityStats'
import './Activity.css'

const AUTO_INTERVALS = [5, 30, 60, 300, null] as const
type AutoInterval = 5 | 30 | 60 | 300 | null

const HOVER_FIELD_OPTIONS: { value: 'name' | 'user' | 'server'; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'user', label: 'User' },
  { value: 'server', label: 'Server' },
]

function formatElapsed(processedOn: number | null | undefined): string {
  if (processedOn == null) return '—'
  const elapsed = Date.now() - processedOn
  if (elapsed < 0) return '—'
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s`
  const m = Math.floor(elapsed / 60_000)
  if (m < 60) return `${m}m ${Math.floor((elapsed % 60_000) / 1000)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatTimeout(seconds: number | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatProcessedOn(processedOn: number | null | undefined): { text: string; title: string } {
  if (processedOn == null) return { text: '—', title: '' }
  const ms = typeof processedOn === 'number' ? processedOn : Number(processedOn)
  if (!Number.isFinite(ms)) return { text: '—', title: '' }
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return { text: '—', title: '' }
  return { text: formatDateTimeMedium(ms), title: d.toISOString() }
}

function isOverTimeout(job: ActivityJob): boolean {
  if (job.processedOn == null || job.timeout == null || job.timeout <= 0) return false
  return Date.now() > job.processedOn + job.timeout * 1000
}

function JobCard({
  job,
  variant,
  highlightMatch,
  onMouseEnter,
  onMouseLeave,
  onViewServerLogs,
  onViewJob,
}: {
  job: ActivityJob
  variant: 'active' | 'waiting'
  highlightMatch: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onViewServerLogs: (serverUrl: string) => void
  onViewJob: (job: ActivityJob) => void
}) {
  const processedOnDisplay = formatProcessedOn(job.processedOn)
  const overTimeout = variant === 'active' && isOverTimeout(job)

  // Build conditional card classes
  let cardCls = 'py-[0.85rem] px-4 rounded-lg border transition-all duration-150 bg-primary cursor-pointer'
  if (highlightMatch) {
    cardCls += ' border-accent bg-accent/[0.06] shadow-[0_0_0_1px_rgba(122,77,176,0.25)]'
  } else if (overTimeout) {
    cardCls += ' bg-semantic-error/[0.04] border-semantic-error/25 hover:bg-semantic-error/[0.07] hover:border-semantic-error/35'
  } else {
    cardCls += ' border-default hover:border-accent/40 hover:bg-secondary/50'
  }

  return (
    <div
      className={cardCls}
      data-server={job.server}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={() => onViewJob(job)}
      title="Click to view job details"
    >
      {/* Card header — name + elapsed */}
      <div className="flex items-center gap-2 mb-[0.6rem] pb-2 border-b border-default/50">
        <span className="text-[15px] font-semibold text-primary flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis" title={job.name}>
          {job.name || '—'}
        </span>
        {variant === 'active' && (
          <span className={`text-[15px] font-semibold tabular-nums shrink-0 whitespace-nowrap ${overTimeout ? 'text-semantic-error' : 'text-semantic-success'}`}>
            {formatElapsed(job.processedOn)}
          </span>
        )}
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[0.3rem] items-baseline">
        <span className="text-sm font-medium text-[#697784] whitespace-nowrap">Job ID</span>
        <span className="text-[15px] text-secondary min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono">{job.id}</span>

        <span className="text-sm font-medium text-[#697784] whitespace-nowrap">User</span>
        <span className="text-[15px] text-primary min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{job.user}</span>

        <span className="text-sm font-medium text-[#697784] whitespace-nowrap">Server</span>
        <button
          type="button"
          className="text-[15px] text-[#8fa4b8] bg-none border-none p-0 m-0 font-[inherit] cursor-pointer text-left min-w-0 overflow-hidden text-ellipsis whitespace-nowrap inline-flex items-center gap-[0.3em] transition-colors hover:text-accent-light"
          title="View server logs"
          onClick={(e) => { e.stopPropagation(); onViewServerLogs(job.server) }}
        >
          {job.server}
        </button>

        <span className="text-sm font-medium text-[#697784] whitespace-nowrap">Started</span>
        <span className="text-[15px] text-primary min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={processedOnDisplay.title || undefined}>
          {processedOnDisplay.text}
        </span>

        <span className="text-sm font-medium text-[#697784] whitespace-nowrap">Timeout</span>
        <span className={`text-[15px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${overTimeout ? 'text-semantic-error font-medium' : 'text-primary'}`}>
          {job.timeout != null ? formatTimeout(job.timeout) : '—'}
        </span>
      </div>
    </div>
  )
}

function getJobFieldValue(job: ActivityJob, field: 'name' | 'user' | 'server'): string {
  const v = job[field]
  return typeof v === 'string' ? v : (v ?? '')
}

function JobColumn({
  title,
  jobs,
  variant,
  hoverField,
  hoveredValue,
  setHoveredValue,
  onViewServerLogs,
  onViewJob,
  width,
  onResizeStart,
  onResetSize,
}: {
  title: string
  jobs: ActivityJob[]
  variant: 'active' | 'waiting'
  hoverField: 'name' | 'user' | 'server'
  hoveredValue: string | null
  setHoveredValue: (value: string | null) => void
  onViewServerLogs: (serverUrl: string) => void
  onViewJob: (job: ActivityJob) => void
  width: number
  onResizeStart: (e: React.MouseEvent) => void
  onResetSize: () => void
}) {
  // Status dot color per variant (replaces ::before pseudo-element)
  const dotColor = variant === 'active' ? 'bg-semantic-success' : 'bg-semantic-warning'

  return (
    <div
      className={`activity-column activity-column--${variant} bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col min-h-[200px] min-w-0 relative shrink-0`}
      style={{ width: `${width}%` }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 m-0 px-[1.15rem] py-[0.85rem] text-sm font-semibold uppercase tracking-[0.04em] text-muted bg-tertiary/50 border-b border-default">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <span>{title}</span>
        <span className="inline-flex items-center justify-center min-w-[1.5em] px-[0.45em] py-[0.1em] rounded-full text-sm font-bold leading-[1.3] bg-default/60 text-muted">
          {jobs.length}
        </span>
      </div>

      {/* Cards */}
      <div className="activity-column-cards p-3 flex flex-col gap-2 overflow-y-auto max-h-[60vh]">
        {jobs.length === 0 ? (
          <p className="m-0 py-8 text-center text-[#697784] text-[15px]">No jobs</p>
        ) : (
          jobs.map((job) => {
            const fieldValue = getJobFieldValue(job, hoverField)
            const highlightMatch = hoveredValue != null && fieldValue === hoveredValue
            return (
              <JobCard
                key={`${variant}-${job.id}`}
                job={job}
                variant={variant}
                highlightMatch={highlightMatch}
                onMouseEnter={() => setHoveredValue(fieldValue)}
                onMouseLeave={() => setHoveredValue(null)}
                onViewServerLogs={onViewServerLogs}
                onViewJob={onViewJob}
              />
            )
          })
        )}
      </div>

      {/* Resize handle */}
      <div
        className="activity-column-resize absolute top-0 right-[-6px] w-3 h-full cursor-col-resize z-[5] group"
        onMouseDown={onResizeStart}
        onDoubleClick={onResetSize}
        title="Drag to resize · Double-click to reset"
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-[2px] bg-transparent group-hover:bg-accent transition-colors" />
      </div>
    </div>
  )
}

type ActivityData = {
  queueRes: QueueStatsWithJobsResponse | null
  error: string | null
}

export function Activity() {
  const { authStatus } = useAuth()
  const [view, setView] = useState<'live' | 'stats'>('live')
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [hoverField, setHoverField] = useState<'name' | 'user' | 'server'>('server')
  const [hoveredValue, setHoveredValue] = useState<string | null>(null)
  const [logModalServerUrl, setLogModalServerUrl] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<ActivityJob | null>(null)
  const [autoInterval, setAutoInterval] = useState<AutoInterval>(5)
  const [, setElapsedTick] = useState(0)
  const [queueCollapsed, setQueueCollapsed] = useState(false)
  const [statsPeriod, setStatsPeriod] = useState<ActivityStatsPeriod>('1d')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Align toolbar to right-edge of view toggle
  const viewToggleRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sync = () => {
      if (!viewToggleRef.current || !toolbarRef.current) return
      const toggleRect = viewToggleRef.current.getBoundingClientRect()
      const toolbarRect = toolbarRef.current.getBoundingClientRect()
      const targetWidth = toggleRect.right - toolbarRect.left
      toolbarRef.current.style.width = `${targetWidth}px`
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  // Resizable columns
  const [leftPct, setLeftPct] = useState(50)
  const columnsRef = useRef<HTMLDivElement>(null)

  const handleResetSize = useCallback(() => setLeftPct(50), [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startPct = leftPct
    const onMove = (ev: MouseEvent) => {
      if (!columnsRef.current) return
      const rect = columnsRef.current.getBoundingClientRect()
      const delta = ev.clientX - startX
      const deltaPct = (delta / rect.width) * 100
      const next = Math.max(25, Math.min(75, startPct + deltaPct))
      setLeftPct(next)
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
  }, [leftPct])

  const cycleAutoInterval = useCallback(() => {
    setAutoInterval((cur) => {
      const idx = AUTO_INTERVALS.indexOf(cur)
      return AUTO_INTERVALS[(idx + 1) % AUTO_INTERVALS.length]
    })
  }, [])

  const inFlightRef = useRef(false)
  const load = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    try {
      const queueRes = await getQueueStatsWithJobLists()
      setData({ queueRes, error: queueRes.error ?? null })
      setLastRefreshed(new Date())
      setRefreshTrigger((t) => t + 1)
    } catch (err) {
      setData({
        queueRes: null,
        error: err instanceof Error ? err.message : 'Failed to load',
      })
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok') return
    load()
  }, [load, authStatus])

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    if (!autoInterval || authStatus !== 'ok') return
    const id = setInterval(() => { loadRef.current() }, autoInterval * 1000)
    return () => clearInterval(id)
  }, [autoInterval, authStatus])

  const configured = data?.queueRes?.configured ?? false
  const queueRes = data?.queueRes
  const activeJobs = queueRes?.active ?? []
  const waitingJobs = queueRes?.waiting ?? []
  const showSpinner = loading && data != null

  useEffect(() => {
    if (activeJobs.length === 0) return
    const id = setInterval(() => setElapsedTick((t) => t + 1), 5_000)
    return () => clearInterval(id)
  }, [activeJobs.length])

  const autoIntervalLabel = autoInterval
    ? autoInterval < 60 ? `${autoInterval}s` : `${autoInterval / 60}m`
    : 'Off'

  const liveContent = () => {
    if (loading && !data) return (
      <div className="flex items-center justify-center gap-3 py-16 px-8 text-muted text-[15px]">
        <span className="w-7 h-7 border-[3px] border-default border-t-accent rounded-full animate-spin shrink-0" />
        <span>Loading activity data…</span>
      </div>
    )
    if (data && !configured) return (
      <div className="px-10 py-10 rounded-[10px] bg-secondary border border-default text-center">
        <p className="m-0 mb-2 text-secondary text-[15px]">Activity is not configured.</p>
        <p className="text-sm text-muted">
          Set <code className="bg-tertiary px-[0.4rem] py-[0.15rem] rounded text-sm text-accent">REDIS_URL</code> (and optionally <code className="bg-tertiary px-[0.4rem] py-[0.15rem] rounded text-sm text-accent">BULL_QUEUE_NAME</code>) in the server environment.
        </p>
      </div>
    )
    return (
      <>
        {data?.error && (
          <div className="py-[0.6rem] px-4 mb-4 bg-semantic-error/[0.06] border border-semantic-error/20 rounded-lg text-semantic-error text-[15px]">
            {data.error}
          </div>
        )}

        {/* Collapsible queue panel */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              className="flex items-center gap-[0.6rem] flex-1 min-w-0 py-[0.65rem] bg-transparent border-none text-primary cursor-pointer select-none text-left group"
              onClick={() => setQueueCollapsed((c) => !c)}
            >
              <Radio size={20} className="text-accent opacity-70 shrink-0" />
              <span className="text-[1.15rem] font-semibold text-primary whitespace-nowrap">Live Queue</span>
              <span className="text-sm font-normal text-[#697784] whitespace-nowrap">({activeJobs.length + waitingJobs.length})</span>
              <span className="inline-flex items-center gap-[0.4rem] ml-[0.15rem]">
                <span className={`inline-flex items-center py-[0.1rem] px-2 rounded-full text-sm font-medium border ${activeJobs.length > 0 ? 'bg-semantic-success/10 border-semantic-success/30 text-semantic-success' : 'border-default bg-primary text-[#697784]'}`}>
                  {activeJobs.length} running
                </span>
                <span className={`inline-flex items-center py-[0.1rem] px-2 rounded-full text-sm font-medium border ${waitingJobs.length > 0 ? 'bg-semantic-warning/10 border-semantic-warning/30 text-semantic-warning' : 'border-default bg-primary text-[#697784]'}`}>
                  {waitingJobs.length} queued
                </span>
              </span>
              <div className="flex-1 h-px bg-default/50 ml-2" />
              <span className="text-[#697784] inline-flex transition-colors group-hover:text-secondary shrink-0">
                {queueCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
              </span>
            </button>

            {/* Highlight field selector */}
            <label className="inline-flex items-center gap-1 text-sm font-medium text-[#697784] whitespace-nowrap ml-1">
              Highlight
              <select
                className="h-7 px-[0.4rem] bg-secondary border border-default rounded-[5px] text-secondary text-[0.8125rem] cursor-pointer focus:outline-none focus:border-accent transition-[border-color]"
                value={hoverField}
                onChange={(e) => setHoverField(e.target.value as 'name' | 'user' | 'server')}
              >
                {HOVER_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>

          {!queueCollapsed && (
            <div className="flex gap-0 items-stretch max-md:flex-col" ref={columnsRef}>
              <JobColumn
                title="Running"
                jobs={activeJobs}
                variant="active"
                hoverField={hoverField}
                hoveredValue={hoveredValue}
                setHoveredValue={setHoveredValue}
                onViewServerLogs={setLogModalServerUrl}
                onViewJob={setSelectedJob}
                width={leftPct}
                onResizeStart={handleResizeStart}
                onResetSize={handleResetSize}
              />
              <JobColumn
                title="Queued"
                jobs={waitingJobs}
                variant="waiting"
                hoverField={hoverField}
                hoveredValue={hoveredValue}
                setHoveredValue={setHoveredValue}
                onViewServerLogs={setLogModalServerUrl}
                onViewJob={setSelectedJob}
                width={100 - leftPct}
                onResizeStart={() => {}}
                onResetSize={handleResetSize}
              />
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto text-[15px]">
      {/* Sticky header — top-14 = 3.5rem, sits below the h-14 app nav bar */}
      <div className="sticky top-14 z-20 bg-primary">
        {/* Page title + view toggle */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <ActivityIcon size={22} className="text-accent/70" />
            <h1 className="text-xl font-semibold text-primary m-0">Activity</h1>
            <div
              className="flex bg-secondary border border-default rounded-lg overflow-hidden gap-0 p-[2px] ml-1"
              ref={viewToggleRef}
            >
              <button
                type="button"
                className={`inline-flex items-center gap-[0.3rem] rounded-md px-[0.65rem] py-[0.3rem] text-sm font-medium border-none transition-all duration-150 ${view === 'live' ? 'bg-accent text-white shadow-[0_1px_4px_rgba(122,77,176,0.3)]' : 'bg-transparent text-muted hover:text-primary hover:bg-accent/8'}`}
                onClick={() => setView('live')}
                title="Live queue and job history"
              >
                <Radio size={14} /> Monitor
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-[0.3rem] rounded-md px-[0.65rem] py-[0.3rem] text-sm font-medium border-none transition-all duration-150 ${view === 'stats' ? 'bg-accent text-white shadow-[0_1px_4px_rgba(122,77,176,0.3)]' : 'bg-transparent text-muted hover:text-primary hover:bg-accent/8'}`}
                onClick={() => setView('stats')}
                title="Usage statistics and rankings"
              >
                <BarChart2 size={14} /> Insights
              </button>
            </div>
            <div className="flex-1 h-px bg-default/50 ml-3" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-6 py-[0.4rem] mb-2 border-b border-default/40">
          <div
            className="inline-flex items-center rounded-md border border-default overflow-hidden bg-secondary"
            ref={toolbarRef}
          >
            {/* Refresh button */}
            <button
              type="button"
              className="inline-flex items-center justify-center w-[30px] h-[30px] bg-transparent border-none text-secondary cursor-pointer transition-all duration-150 enabled:hover:bg-tertiary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={load}
              disabled={loading}
              title="Refresh now"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>

            {/* Auto-interval badge */}
            <button
              type="button"
              className={`inline-flex items-center gap-1 h-[30px] px-2 border-l border-default text-sm font-medium cursor-pointer transition-all duration-150 bg-transparent border-t-0 border-r-0 border-b-0 whitespace-nowrap ${autoInterval ? 'text-accent-light bg-accent/[0.08] hover:bg-accent/[0.14] hover:text-[#b88ae6]' : 'text-[#697784] hover:bg-tertiary hover:text-secondary'}`}
              onClick={cycleAutoInterval}
              title={autoInterval ? `Auto-refresh every ${autoIntervalLabel} — click to cycle` : 'Auto-refresh off — click to enable'}
            >
              {autoInterval ? <Timer size={12} /> : <TimerOff size={12} />}
              {autoIntervalLabel}
            </button>

            {/* Timestamp */}
            {lastRefreshed && (
              <span className="inline-flex items-center h-[30px] px-2 border-l border-default text-sm text-[#697784] font-mono tabular-nums whitespace-nowrap">
                last checked: {lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}

            {/* Inline spinner */}
            {showSpinner && (
              <span className="inline-flex items-center h-[30px] px-[0.35rem] border-l border-default">
                <span className="w-4 h-4 border-2 border-default border-t-accent rounded-full animate-spin" />
              </span>
            )}
          </div>

          {/* Period selector (stats view) */}
          {view === 'stats' && (
            <select
              className="h-7 px-[0.4rem] bg-secondary border border-default rounded-[5px] text-secondary text-[0.8125rem] cursor-pointer focus:outline-none focus:border-accent transition-[border-color]"
              value={statsPeriod}
              onChange={(e) => setStatsPeriod(e.target.value as ActivityStatsPeriod)}
            >
              {ACTIVITY_STATS_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="px-6 flex flex-col gap-5">
        {view === 'live' ? (
          <>
            {liveContent()}
            {configured && <RecentJobs refreshTrigger={refreshTrigger} />}
          </>
        ) : (
          configured && <StatsPanels period={statsPeriod} setPeriod={setStatsPeriod} />
        )}
      </div>

      {logModalServerUrl != null && (
        <ServerLogsModal
          serverUrl={logModalServerUrl}
          onClose={() => setLogModalServerUrl(null)}
        />
      )}
      {selectedJob != null && (
        <ActivityJobModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  )
}
