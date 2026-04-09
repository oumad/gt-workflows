import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, BarChart2, TrendingUp, AlertCircle, ChevronLeft, ChevronRight, GitCompare } from 'lucide-react'
import { ROUTES } from '@/app/routes'
import type { TimeViewRangeId } from '@/features/dashboard/timeViewUtils'
import { getTimeViewBounds } from '@/features/dashboard/timeViewUtils'
import { useTimeViewSeries } from '@/features/dashboard/useTimeViewSeries'
import { useAnnotations } from '@/features/dashboard/useAnnotations'
import { TimeSeriesPanel } from '@/components/dashboard/TimeSeriesPanel'
import { HeatmapPanel } from '@/components/dashboard/HeatmapPanel'
import { FailureRatePanel } from '@/components/dashboard/FailureRatePanel'
import { AnnotationsPanel } from '@/components/dashboard/AnnotationsPanel'
import './Dashboard.css'

/** Time range options for Time View (no magic strings). */
export const TIME_VIEW_RANGE = {
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
  ALL: 'all',
} as const satisfies Record<string, TimeViewRangeId>

export type { TimeViewRangeId }

const TIME_VIEW_RANGE_OPTIONS: ReadonlyArray<{ value: TimeViewRangeId; label: string }> = [
  { value: TIME_VIEW_RANGE.WEEK, label: 'Week' },
  { value: TIME_VIEW_RANGE.MONTH, label: 'Month' },
  { value: TIME_VIEW_RANGE.YEAR, label: 'Year' },
  { value: TIME_VIEW_RANGE.ALL, label: 'All' },
]

// ── Week helpers ─────────────────────────────────────────────────────

function currentISOWeek(): string {
  const d = new Date()
  const thu = new Date(d)
  thu.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3)
  const jan1 = new Date(thu.getFullYear(), 0, 1)
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function offsetISOWeek(isoWeek: string, delta: number): string {
  const [y, w] = isoWeek.split('-W').map(Number)
  const jan4 = new Date(y, 0, 4)
  const mon = new Date(jan4)
  mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7)
  mon.setDate(mon.getDate() + delta * 7)
  return dateToISOWeek(mon)
}

function dateToISOWeek(d: Date): string {
  const thu = new Date(d)
  thu.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3)
  const jan1 = new Date(thu.getFullYear(), 0, 1)
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function isoWeekToMonday(isoWeek: string): Date {
  const [y, w] = isoWeek.split('-W').map(Number)
  const jan4 = new Date(y, 0, 4)
  const mon = new Date(jan4)
  mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7)
  return mon
}

function formatWeekRange(isoWeek: string): string {
  const mon = isoWeekToMonday(isoWeek)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const mMonth = mon.toLocaleString('en', { month: 'short' })
  const sMonth = sun.toLocaleString('en', { month: 'short' })
  if (mMonth === sMonth) return `${mMonth} ${mon.getDate()} – ${sun.getDate()}`
  return `${mMonth} ${mon.getDate()} – ${sMonth} ${sun.getDate()}`
}

// ── Month / Year constants ───────────────────────────────────────────

const MONTHS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' }, { value: 3, label: 'March' },
  { value: 4, label: 'April' }, { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' }, { value: 9, label: 'September' },
  { value: 10, label: 'October' }, { value: 11, label: 'November' }, { value: 12, label: 'December' },
]

const currentYear = (): number => new Date().getFullYear()

// ── Time Range Picker sub-component ─────────────────────────────────

interface TimeRangePickerProps {
  label?: string
  timeRange: TimeViewRangeId
  onTimeRangeChange: (v: TimeViewRangeId) => void
  selectedWeek: string
  onWeekPrev: () => void
  onWeekNext: () => void
  weekAtCurrent: boolean
  selectedMonth: number
  onMonthChange: (v: number) => void
  selectedYearForMonth: number
  onYearForMonthChange: (v: number) => void
  selectedYearForYear: number
  onYearForYearChange: (v: number) => void
  yearOptions: number[]
}

function TimeRangePicker({
  label, timeRange, onTimeRangeChange,
  selectedWeek, onWeekPrev, onWeekNext, weekAtCurrent,
  selectedMonth, onMonthChange,
  selectedYearForMonth, onYearForMonthChange,
  selectedYearForYear, onYearForYearChange,
  yearOptions,
}: TimeRangePickerProps): React.ReactElement {
  return (
    <div className="dashboard-timeview-controls">
      {label && <span className="dashboard-timeview-picker-label">{label}</span>}
      <label className="dashboard-timeview-label">
        <span className="dashboard-timeview-label-text">Range</span>
        <select
          className="dashboard-toolbar-select"
          value={timeRange}
          onChange={(e) => onTimeRangeChange(e.target.value as TimeViewRangeId)}
          aria-label="Time range"
        >
          {TIME_VIEW_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      {timeRange === TIME_VIEW_RANGE.WEEK && (
        <div className="dashboard-week-picker">
          <button type="button" className="dashboard-week-picker-btn" onClick={onWeekPrev} aria-label="Previous week">
            <ChevronLeft size={14} />
          </button>
          <span className="dashboard-week-picker-label">{formatWeekRange(selectedWeek)}</span>
          <button type="button" className="dashboard-week-picker-btn" onClick={onWeekNext} disabled={weekAtCurrent} aria-label="Next week">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      {timeRange === TIME_VIEW_RANGE.MONTH && (
        <>
          <label className="dashboard-timeview-label">
            <span className="dashboard-timeview-label-text">Month</span>
            <select className="dashboard-toolbar-select" value={selectedMonth} onChange={(e) => onMonthChange(Number(e.target.value))} aria-label="Month">
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="dashboard-timeview-label">
            <span className="dashboard-timeview-label-text">Year</span>
            <select className="dashboard-toolbar-select" value={selectedYearForMonth} onChange={(e) => onYearForMonthChange(Number(e.target.value))} aria-label="Year">
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </>
      )}
      {timeRange === TIME_VIEW_RANGE.YEAR && (
        <label className="dashboard-timeview-label">
          <span className="dashboard-timeview-label-text">Year</span>
          <select className="dashboard-toolbar-select" value={selectedYearForYear} onChange={(e) => onYearForYearChange(Number(e.target.value))} aria-label="Year">
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────

export function DashboardTimeView(): React.ReactElement {
  // Primary range
  const [timeRange, setTimeRange] = useState<TimeViewRangeId>(TIME_VIEW_RANGE.WEEK)
  const [selectedWeek, setSelectedWeek] = useState<string>(currentISOWeek)
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1)
  const [selectedYearForMonth, setSelectedYearForMonth] = useState<number>(currentYear())
  const [selectedYearForYear, setSelectedYearForYear] = useState<number>(currentYear())

  // Comparison range
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [cmpTimeRange, setCmpTimeRange] = useState<TimeViewRangeId>(TIME_VIEW_RANGE.WEEK)
  const [cmpWeek, setCmpWeek] = useState<string>(() => offsetISOWeek(currentISOWeek(), -1))
  const [cmpMonth, setCmpMonth] = useState<number>(() => {
    const m = new Date().getMonth() // 0-based, so this is prev month
    return m === 0 ? 12 : m
  })
  const [cmpYearForMonth, setCmpYearForMonth] = useState<number>(() => {
    const m = new Date().getMonth()
    return m === 0 ? currentYear() - 1 : currentYear()
  })
  const [cmpYearForYear, setCmpYearForYear] = useState<number>(() => currentYear() - 1)

  const yearOptions = useMemo((): number[] => {
    const y = currentYear()
    const out: number[] = []
    for (let i = y; i >= y - 10; i--) out.push(i)
    return out
  }, [])

  // Primary data
  const primary = useTimeViewSeries({
    timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear,
  })

  // Comparison data (only fetch when enabled)
  const compare = useTimeViewSeries({
    timeRange: cmpTimeRange,
    selectedWeek: cmpWeek,
    selectedMonth: cmpMonth,
    selectedYearForMonth: cmpYearForMonth,
    selectedYearForYear: cmpYearForYear,
    enabled: compareEnabled,
  })

  // Selection state for filter dropdowns
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set())
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set())
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [cmpSelectedWorkflows, setCmpSelectedWorkflows] = useState<Set<string>>(new Set())
  const [cmpSelectedServers, setCmpSelectedServers] = useState<Set<string>>(new Set())

  const initialWfDone = useRef(false)
  const initialSvDone = useRef(false)
  const initialUserDone = useRef(false)
  const initialCmpWfDone = useRef(false)
  const initialCmpSvDone = useRef(false)

  // Reset selections on param change
  useEffect(() => {
    initialWfDone.current = false
    initialSvDone.current = false
    initialUserDone.current = false
  }, [timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear])

  useEffect(() => {
    initialCmpWfDone.current = false
    initialCmpSvDone.current = false
  }, [cmpTimeRange, cmpWeek, cmpMonth, cmpYearForMonth, cmpYearForYear])

  // Auto-select all primary
  useEffect(() => {
    if (primary.workflowSeries.length && !initialWfDone.current) {
      initialWfDone.current = true
      setSelectedWorkflows(new Set(primary.workflowSeries.map((s) => s.name)))
    }
  }, [primary.workflowSeries])

  useEffect(() => {
    if (primary.serverSeries.length && !initialSvDone.current) {
      initialSvDone.current = true
      setSelectedServers(new Set(primary.serverSeries.map((s) => s.name)))
    }
  }, [primary.serverSeries])

  useEffect(() => {
    if (primary.userSeries.length && !initialUserDone.current) {
      initialUserDone.current = true
      setSelectedUsers(new Set(primary.userSeries.map((s) => s.name)))
    }
  }, [primary.userSeries])

  // Auto-select all compare
  useEffect(() => {
    if (compareEnabled && compare.workflowSeries.length && !initialCmpWfDone.current) {
      initialCmpWfDone.current = true
      setCmpSelectedWorkflows(new Set(compare.workflowSeries.map((s) => s.name)))
    }
  }, [compare.workflowSeries, compareEnabled])

  useEffect(() => {
    if (compareEnabled && compare.serverSeries.length && !initialCmpSvDone.current) {
      initialCmpSvDone.current = true
      setCmpSelectedServers(new Set(compare.serverSeries.map((s) => s.name)))
    }
  }, [compare.serverSeries, compareEnabled])

  // Compute all dates in the selected range for annotations visibility
  const visibleDateRange = useMemo(() => {
    const bounds = getTimeViewBounds(timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear)
    const from = new Date(bounds.from)
    const to = new Date(bounds.to)
    const dates: string[] = []
    const d = new Date(from)
    d.setHours(0, 0, 0, 0)
    while (d <= to) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      dates.push(`${y}-${m}-${day}`)
      d.setDate(d.getDate() + 1)
    }
    return dates
  }, [timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear])

  // Format date range for display
  const dateRangeDisplay = useMemo(() => {
    const bounds = getTimeViewBounds(timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear)
    const from = new Date(bounds.from)
    const to = new Date(bounds.to)
    const formatDate = (d: Date) => {
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${m}/${day}`
    }
    return `${formatDate(from)} – ${formatDate(to)}`
  }, [timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear])

  // Annotations
  const { annotations, addAnnotation, removeAnnotation } = useAnnotations()

  const navigate = useNavigate()
  const loading = primary.loading || (compareEnabled && compare.loading)
  const error = primary.error || (compareEnabled ? compare.error : null)

  return (
    <div className="dashboard-page">
      {/* Sticky header */}
      <div className="dashboard-sticky-header">
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <BarChart3 size={22} className="text-purple-500/70" />
            <h1 className="text-xl font-semibold text-[#e8ecf1] m-0">Analytics</h1>
            <div className="activity-view-toggle ml-1">
              <button type="button" className="btn btn-toolbar" onClick={() => navigate(ROUTES.jobStats)} title="Usage stats and rankings">
                <BarChart2 size={14} /> Stats
              </button>
              <button type="button" className="btn btn-toolbar btn-toolbar--active" title="Time series charts">
                <TrendingUp size={14} /> Time View
              </button>
            </div>
            <div className="flex-1 h-px bg-[#2d3a4a]/50 ml-3" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="dashboard-live-toolbar">
          <TimeRangePicker
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            selectedWeek={selectedWeek}
            onWeekPrev={() => setSelectedWeek((w) => offsetISOWeek(w, -1))}
            onWeekNext={() => setSelectedWeek((w) => offsetISOWeek(w, 1))}
            weekAtCurrent={selectedWeek >= currentISOWeek()}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            selectedYearForMonth={selectedYearForMonth}
            onYearForMonthChange={setSelectedYearForMonth}
            selectedYearForYear={selectedYearForYear}
            onYearForYearChange={setSelectedYearForYear}
            yearOptions={yearOptions}
          />

          <button
            type="button"
            className={`dashboard-compare-toggle${compareEnabled ? ' dashboard-compare-toggle--active' : ''}`}
            onClick={() => setCompareEnabled((v) => !v)}
            title="Compare with another time range"
          >
            <GitCompare size={14} /> Compare
          </button>

          {loading && primary.progress && (
            <span className="dashboard-toolbar-progress">
              Loading… {primary.progress.current.toLocaleString()} / {primary.progress.total.toLocaleString()}
            </span>
          )}
        </div>

        {/* Comparison picker */}
        {compareEnabled && (
          <div className="dashboard-live-toolbar dashboard-compare-toolbar">
            <TimeRangePicker
              label="vs"
              timeRange={cmpTimeRange}
              onTimeRangeChange={setCmpTimeRange}
              selectedWeek={cmpWeek}
              onWeekPrev={() => setCmpWeek((w) => offsetISOWeek(w, -1))}
              onWeekNext={() => setCmpWeek((w) => offsetISOWeek(w, 1))}
              weekAtCurrent={cmpWeek >= currentISOWeek()}
              selectedMonth={cmpMonth}
              onMonthChange={setCmpMonth}
              selectedYearForMonth={cmpYearForMonth}
              onYearForMonthChange={setCmpYearForMonth}
              selectedYearForYear={cmpYearForYear}
              onYearForYearChange={setCmpYearForYear}
              yearOptions={yearOptions}
            />
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="px-6 dashboard-content">
        {error && (
          <div className="dashboard-state-msg dashboard-state-msg--error">
            <AlertCircle size={20} />{error}
          </div>
        )}

        <div className="dashboard-timeview-panels">
          {/* Workflow usage */}
          {compareEnabled ? (
            <div className="dashboard-compare-row">
              <TimeSeriesPanel title="Workflow usage per day" series={primary.workflowSeries} dates={primary.workflowDates} selectedKeys={selectedWorkflows} onSelectionChange={setSelectedWorkflows} dropdownLabel="Workflows" loading={primary.loading} annotations={annotations} />
              <TimeSeriesPanel title="Workflow usage (compare)" series={compare.workflowSeries} dates={compare.workflowDates} selectedKeys={cmpSelectedWorkflows} onSelectionChange={setCmpSelectedWorkflows} dropdownLabel="Workflows" loading={compare.loading} annotations={annotations} />
            </div>
          ) : (
            <TimeSeriesPanel title="Workflow usage per day" series={primary.workflowSeries} dates={primary.workflowDates} selectedKeys={selectedWorkflows} onSelectionChange={setSelectedWorkflows} dropdownLabel="Workflows" loading={primary.loading} annotations={annotations} />
          )}

          {/* Server usage */}
          {compareEnabled ? (
            <div className="dashboard-compare-row">
              <TimeSeriesPanel title="Server usage per day" series={primary.serverSeries} dates={primary.serverDates} selectedKeys={selectedServers} onSelectionChange={setSelectedServers} dropdownLabel="Servers" loading={primary.loading} annotations={annotations} />
              <TimeSeriesPanel title="Server usage (compare)" series={compare.serverSeries} dates={compare.serverDates} selectedKeys={cmpSelectedServers} onSelectionChange={setCmpSelectedServers} dropdownLabel="Servers" loading={compare.loading} annotations={annotations} />
            </div>
          ) : (
            <TimeSeriesPanel title="Server usage per day" series={primary.serverSeries} dates={primary.serverDates} selectedKeys={selectedServers} onSelectionChange={setSelectedServers} dropdownLabel="Servers" loading={primary.loading} annotations={annotations} />
          )}

          {/* User activity */}
          <TimeSeriesPanel
            title="User activity over time"
            series={primary.userSeries}
            dates={primary.userDates}
            selectedKeys={selectedUsers}
            onSelectionChange={setSelectedUsers}
            dropdownLabel="Users"
            loading={primary.loading}
            annotations={annotations}
          />

          {/* Peak usage heatmap + Failure rate side by side */}
          <div className="dashboard-compare-row">
            <HeatmapPanel title="Peak usage heatmap" data={primary.heatmap} loading={primary.loading} annotations={annotations} dateRange={dateRangeDisplay} />
            <FailureRatePanel title="Failure rate trend" data={primary.failureRate} loading={primary.loading} annotations={annotations} />
          </div>

          {/* Annotations */}
          <AnnotationsPanel
            annotations={annotations}
            visibleDates={visibleDateRange}
            onAdd={addAnnotation}
            onRemove={removeAnnotation}
          />
        </div>
      </div>
    </div>
  )
}
