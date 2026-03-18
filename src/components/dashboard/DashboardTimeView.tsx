import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { ROUTES } from '@/app/routes'
import type { TimeViewRangeId } from '@/features/dashboard/timeViewUtils'
import { useTimeViewSeries } from '@/features/dashboard/useTimeViewSeries'
import { TimeSeriesPanel } from '@/components/dashboard/TimeSeriesPanel'
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

/** Returns the current ISO week as "YYYY-Www" for use as a week input default. */
function currentISOWeek(): string {
  const d = new Date()
  const thu = new Date(d)
  thu.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3)
  const jan1 = new Date(thu.getFullYear(), 0, 1)
  const week = Math.ceil(((thu.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`
}

const MONTHS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
]

const currentYear = (): number => new Date().getFullYear()

export function DashboardTimeView(): React.ReactElement {
  const [timeRange, setTimeRange] = useState<TimeViewRangeId>(TIME_VIEW_RANGE.WEEK)
  const [selectedWeek, setSelectedWeek] = useState<string>(currentISOWeek)
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1)
  const [selectedYearForMonth, setSelectedYearForMonth] = useState<number>(currentYear())
  const [selectedYearForYear, setSelectedYearForYear] = useState<number>(currentYear())

  const handleTimeRangeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTimeRange(e.target.value as TimeViewRangeId)
  }, [])

  const handleWeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedWeek(e.target.value)
  }, [])

  const handleMonthChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMonth(Number(e.target.value))
  }, [])

  const handleYearForMonthChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedYearForMonth(Number(e.target.value))
  }, [])

  const handleYearForYearChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedYearForYear(Number(e.target.value))
  }, [])

  const yearOptions = useMemo((): number[] => {
    const y = currentYear()
    const out: number[] = []
    for (let i = y; i >= y - 10; i--) out.push(i)
    return out
  }, [])

  const {
    workflowDates,
    workflowSeries,
    serverDates,
    serverSeries,
    loading,
    error,
    progress,
  } = useTimeViewSeries({
    timeRange,
    selectedWeek,
    selectedMonth,
    selectedYearForMonth,
    selectedYearForYear,
  })

  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set())
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set())
  const initialWorkflowSelectDone = useRef(false)
  const initialServerSelectDone = useRef(false)

  // Reset selection state when the query params change so new data auto-selects all items.
  useEffect(() => {
    initialWorkflowSelectDone.current = false
    initialServerSelectDone.current = false
  }, [timeRange, selectedWeek, selectedMonth, selectedYearForMonth, selectedYearForYear])

  useEffect(() => {
    if (workflowSeries.length === 0) return
    if (initialWorkflowSelectDone.current) return
    initialWorkflowSelectDone.current = true
    setSelectedWorkflows(new Set(workflowSeries.map((s) => s.name)))
  }, [workflowSeries])

  useEffect(() => {
    if (serverSeries.length === 0) return
    if (initialServerSelectDone.current) return
    initialServerSelectDone.current = true
    setSelectedServers(new Set(serverSeries.map((s) => s.name)))
  }, [serverSeries])

  const handleWorkflowSelectionChange = useCallback((selected: Set<string>) => {
    setSelectedWorkflows(selected)
  }, [])

  const handleServerSelectionChange = useCallback((selected: Set<string>) => {
    setSelectedServers(selected)
  }, [])

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-toolbar page-toolbar">
          <h1 className="page-title dashboard-title">
            <BarChart3 size={24} />
            Job stats – Time View
          </h1>
          <div className="dashboard-timeview-controls">
            <label className="dashboard-timeview-label">
              <span className="dashboard-timeview-label-text">Time range</span>
              <select
                className="dashboard-limit-select dashboard-timeview-select"
                value={timeRange}
                onChange={handleTimeRangeChange}
                aria-label="Time range"
              >
                {TIME_VIEW_RANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {timeRange === TIME_VIEW_RANGE.WEEK && (
              <label className="dashboard-timeview-label">
                <span className="dashboard-timeview-label-text">Week</span>
                <input
                  type="week"
                  className="dashboard-timeview-input"
                  value={selectedWeek}
                  onChange={handleWeekChange}
                  aria-label="Week"
                />
              </label>
            )}
            {timeRange === TIME_VIEW_RANGE.MONTH && (
              <>
                <label className="dashboard-timeview-label">
                  <span className="dashboard-timeview-label-text">Month</span>
                  <select
                    className="dashboard-limit-select dashboard-timeview-select"
                    value={selectedMonth}
                    onChange={handleMonthChange}
                    aria-label="Month"
                  >
                    {MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dashboard-timeview-label">
                  <span className="dashboard-timeview-label-text">Year</span>
                  <select
                    className="dashboard-limit-select dashboard-timeview-select"
                    value={selectedYearForMonth}
                    onChange={handleYearForMonthChange}
                    aria-label="Year"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {timeRange === TIME_VIEW_RANGE.YEAR && (
              <label className="dashboard-timeview-label">
                <span className="dashboard-timeview-label-text">Year</span>
                <select
                  className="dashboard-limit-select dashboard-timeview-select"
                  value={selectedYearForYear}
                  onChange={handleYearForYearChange}
                  aria-label="Year"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Link to={ROUTES.jobStats} className="dashboard-timeview-btn">
              Stat View
            </Link>
          </div>
        </div>
      </header>
      {progress && (
        <p className="dashboard-progress">
          Loading… {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
        </p>
      )}
      {error && (
        <div className="dashboard-error">
          <span>{error}</span>
        </div>
      )}
      <div className="dashboard-timeview-panels">
        <TimeSeriesPanel
          title="Workflow usage per day"
          series={workflowSeries}
          dates={workflowDates}
          selectedKeys={selectedWorkflows}
          onSelectionChange={handleWorkflowSelectionChange}
          dropdownLabel="Workflows"
          loading={loading}
        />
        <TimeSeriesPanel
          title="Server usage per day"
          series={serverSeries}
          dates={serverDates}
          selectedKeys={selectedServers}
          onSelectionChange={handleServerSelectionChange}
          dropdownLabel="Servers"
          loading={loading}
        />
      </div>
    </div>
  )
}
