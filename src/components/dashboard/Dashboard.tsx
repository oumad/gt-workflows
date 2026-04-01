import React, { useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BarChart3, RefreshCw, Timer, TimerOff, AlertCircle, TrendingUp, BarChart2, GripVertical } from 'lucide-react'
import { ROUTES } from '@/app/routes'
import { JOBS_LIMIT_OPTIONS, TIME_RANGES } from '@/features/dashboard'
import { useDashboard } from './useDashboard'
import { DashboardUserPanel } from './DashboardUserPanel'
import { DashboardWorkflowPanel } from './DashboardWorkflowPanel'
import { DashboardServersPanel } from './DashboardServersPanel'
import './Dashboard.css'

const PANEL_SPLIT_KEY = 'dashboard-panel-split'
const DEFAULT_SPLIT = 50 // percent
const MIN_SPLIT = 25
const MAX_SPLIT = 75

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_SPLIT_KEY))
    if (v >= MIN_SPLIT && v <= MAX_SPLIT) return v
  } catch { /* ignore */ }
  return DEFAULT_SPLIT
}

function saveSplit(v: number) {
  try { localStorage.setItem(PANEL_SPLIT_KEY, String(v)) } catch { /* ignore */ }
}

export function Dashboard(): React.ReactElement {
  const d = useDashboard()
  const navigate = useNavigate()
  const location = useLocation()
  const isTimeView = location.pathname.includes('/timeview')

  // Resizable split
  const [split, setSplit] = useState(loadSplit)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)

    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, pct))
      setSplit(clamped)
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSplit((v) => { saveSplit(v); return v })
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const autoIntervalLabel = d.autoInterval
    ? d.autoInterval < 60 ? `${d.autoInterval}s` : `${d.autoInterval / 60}m`
    : 'Off'

  return (
    <div className="w-full max-w-[1400px] mx-auto text-[15px]">
      {/* Sticky header — top-14 = 3.5rem, sits below h-14 app nav bar */}
      <div className="sticky top-14 z-20 bg-primary">
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <BarChart3 size={22} className="text-accent/70" />
            <h1 className="text-xl font-semibold text-primary m-0">Analytics</h1>

            {/* View toggle — segmented control */}
            <div className="flex bg-secondary border border-default rounded-lg overflow-hidden gap-0 p-[2px] ml-1">
              <button
                type="button"
                className={`inline-flex items-center gap-[0.3rem] rounded-md px-[0.65rem] py-[0.3rem] text-sm font-medium border-none transition-all duration-150 ${!isTimeView ? 'bg-accent text-white shadow-[0_1px_4px_rgba(122,77,176,0.3)]' : 'bg-transparent text-muted hover:text-primary hover:bg-accent/[0.08]'}`}
                onClick={() => { if (isTimeView) navigate(ROUTES.jobStats) }}
                title="Usage stats and rankings"
              >
                <BarChart2 size={14} /> Stats
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-[0.3rem] rounded-md px-[0.65rem] py-[0.3rem] text-sm font-medium border-none transition-all duration-150 ${isTimeView ? 'bg-accent text-white shadow-[0_1px_4px_rgba(122,77,176,0.3)]' : 'bg-transparent text-muted hover:text-primary hover:bg-accent/[0.08]'}`}
                onClick={() => { if (!isTimeView) navigate(ROUTES.jobStatsTimeView) }}
                title="Time series charts"
              >
                <TrendingUp size={14} /> Time View
              </button>
            </div>

            <div className="flex-1 h-px bg-default/50 ml-3" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-6 py-[0.4rem] mb-2 border-b border-default/40">
          {/* Left group: refresh + auto-interval + progress */}
          <div className="inline-flex items-center rounded-md border border-default overflow-hidden bg-secondary">
            <button
              type="button"
              className="inline-flex items-center justify-center w-[30px] h-[30px] bg-transparent border-none text-secondary cursor-pointer transition-all duration-150 enabled:hover:bg-tertiary enabled:hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => d.loadStats(true)}
              disabled={d.loading}
              title="Refresh now"
            >
              <RefreshCw size={14} className={d.loading ? 'spin' : ''} />
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1 h-[30px] px-2 border-l border-default text-sm font-medium cursor-pointer transition-all duration-150 bg-transparent border-t-0 border-r-0 border-b-0 whitespace-nowrap ${d.autoInterval ? 'text-accent-light bg-accent/[0.08] hover:bg-accent/[0.14] hover:text-[#b88ae6]' : 'text-[#697784] hover:bg-tertiary hover:text-secondary'}`}
              onClick={d.cycleAutoInterval}
              title={d.autoInterval ? `Auto-refresh every ${autoIntervalLabel} — click to cycle` : 'Auto-refresh off — click to enable'}
            >
              {d.autoInterval ? <Timer size={12} /> : <TimerOff size={12} />}
              {autoIntervalLabel}
            </button>
            {d.loading && d.progress && (
              <span className="inline-flex items-center h-[30px] px-2 border-l border-default text-sm text-accent-light tabular-nums whitespace-nowrap">
                {d.rangeMode === 'time' ? 'Scanning' : 'Loading'}… {d.progress.current.toLocaleString()} / {d.progress.total.toLocaleString()}
              </span>
            )}
          </div>

          {/* Right: range toggle + select */}
          <div className="flex items-center gap-2">
            <div className="flex bg-secondary border border-default rounded-md overflow-hidden p-[2px] gap-[2px]">
              <button
                type="button"
                className={`px-2 py-[0.2rem] text-sm font-medium border-none rounded cursor-pointer transition-all duration-150 whitespace-nowrap ${d.rangeMode === 'jobs' ? 'bg-accent text-white shadow-[0_1px_4px_rgba(122,77,176,0.3)]' : 'bg-transparent text-muted enabled:hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed'}`}
                onClick={() => d.setRangeMode('jobs')}
                disabled={d.loading}
              >
                By count
              </button>
              <button
                type="button"
                className={`px-2 py-[0.2rem] text-sm font-medium border-none rounded cursor-pointer transition-all duration-150 whitespace-nowrap ${d.rangeMode === 'time' ? 'bg-accent text-white shadow-[0_1px_4px_rgba(122,77,176,0.3)]' : 'bg-transparent text-muted enabled:hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed'}`}
                onClick={() => d.setRangeMode('time')}
                disabled={d.loading}
              >
                By time
              </button>
            </div>

            {d.rangeMode === 'jobs' && (
              <select
                className="h-7 px-[0.4rem] bg-secondary border border-default rounded-[5px] text-secondary text-[0.8125rem] cursor-pointer focus:outline-none focus:border-accent transition-[border-color]"
                value={d.jobsLimit}
                onChange={(e) => d.setJobsLimit(Number(e.target.value))}
                disabled={d.loading}
              >
                {JOBS_LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()} jobs</option>)}
              </select>
            )}
            {d.rangeMode === 'time' && (
              <select
                className="h-7 px-[0.4rem] bg-secondary border border-default rounded-[5px] text-secondary text-[0.8125rem] cursor-pointer focus:outline-none focus:border-accent transition-[border-color]"
                value={d.timeRangeId}
                onChange={(e) => d.setTimeRangeId(e.target.value as typeof d.timeRangeId)}
                disabled={d.loading}
              >
                {TIME_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Sample info */}
        {d.sampleSubtitle && (
          <div className="px-6 pb-[0.4rem] pt-[0.15rem] text-sm text-[#697784] italic">
            {d.sampleSubtitle}
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="px-6 flex flex-col gap-4 pb-8">
        {d.loading && !d.queueCounts && !d.workflowUsage.length && !d.progress ? (
          <div className="flex items-center justify-center gap-3 py-12 px-8 rounded-[10px] bg-secondary border border-default text-muted text-[15px]">
            <span className="w-5 h-5 border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />
            <span>Loading stats…</span>
          </div>
        ) : d.error ? (
          <div className="flex items-center justify-center gap-3 py-12 px-8 rounded-[10px] bg-semantic-error/[0.06] border border-semantic-error/20 text-semantic-error text-[15px]">
            <AlertCircle size={20} />{d.error}
          </div>
        ) : d.configured === false ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-8 rounded-[10px] bg-secondary border border-default text-muted text-[15px]">
            <p>Queue stats are not configured.</p>
            <p className="text-sm text-[#697784]">
              Set <code className="bg-tertiary px-[0.35rem] py-[0.1rem] rounded text-sm text-accent-light">REDIS_URL</code> (and optionally <code className="bg-tertiary px-[0.35rem] py-[0.1rem] rounded text-sm text-accent-light">BULL_QUEUE_NAME</code>) in the server environment.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Top row: Users (left) + Workflows (right) — resizable */}
            <div
              className="flex gap-0 relative max-[700px]:flex-col"
              style={{ height: 'calc(100vh - 260px)', minHeight: '340px' }}
              ref={containerRef}
            >
              <div style={{ width: `${split}%`, flexShrink: 0, flexGrow: 0, minWidth: 0, overflow: 'hidden' }}>
                <DashboardUserPanel
                  isAdmin={d.isAdmin}
                  anonymiseUsers={d.anonymiseUsers}
                  selectedUser={d.selectedUser}
                  userActivity={d.userActivity}
                  getDisplayName={d.getDisplayName}
                  onToggleAnonymise={d.toggleAnonymise}
                  onClearUser={() => d.setSelectedUser(null)}
                  onSelectUser={d.setSelectedUser}
                />
              </div>

              {/* Resizable divider */}
              <div
                className={`dashboard-panel-divider w-[7px] shrink-0 cursor-col-resize flex items-center justify-center relative z-[2] select-none max-[700px]:hidden${dragging ? ' dashboard-panel-divider--active' : ''}`}
                onMouseDown={handleDividerMouseDown}
                onDoubleClick={() => { setSplit(DEFAULT_SPLIT); saveSplit(DEFAULT_SPLIT) }}
                title="Drag to resize · Double-click to reset"
              >
                <GripVertical size={12} className="dashboard-panel-divider-grip" />
              </div>

              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <DashboardWorkflowPanel
                  selectedUser={d.selectedUser}
                  userDetailsOpen={d.userDetailsOpen}
                  onToggleUserDetails={d.toggleUserDetails}
                  workflowUsage={d.workflowUsage}
                  filteredWorkflowUsage={d.filteredWorkflowUsage}
                  workflowDisplayList={d.workflowDisplayList}
                  workflowSearch={d.workflowSearch}
                  onWorkflowSearchChange={d.setWorkflowSearch}
                  workflowSortMode={d.workflowSortMode}
                  onWorkflowSortModeChange={d.setWorkflowSortMode}
                  maxWorkflow={d.maxWorkflow}
                  maxWorkflowByUsers={d.maxWorkflowByUsers}
                  loading={d.loading}
                  userJobs={d.userJobs}
                  userJobsLoading={d.userJobsLoading}
                  expandedJobId={d.expandedJobId}
                  onToggleJobExpand={d.setExpandedJobId}
                  getDisplayName={d.getDisplayName}
                />
              </div>
            </div>

            {/* Bottom row: Servers full-width */}
            <DashboardServersPanel
              serverUsage={d.serverUsage}
              serverWorkflowsMap={d.serverWorkflowsMap}
              maxServer={d.maxServer}
              expandedServers={d.expandedServers}
              onToggleServer={d.toggleServerDetail}
            />
          </div>
        )}
      </div>
    </div>
  )
}
