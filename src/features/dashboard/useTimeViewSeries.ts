import { useState, useCallback, useEffect } from 'react'
import { getUsageStatsTimeRangeWithJobs } from '@/services/api/stats'
import {
  getTimeViewBounds,
  aggregateJobsByDay,
  colorFromName,
  type TimeViewRangeId,
  type AggregatedByDay,
} from './timeViewUtils'

export interface TimeSeriesItem {
  name: string
  color: string
  values: number[]
}

export interface UseTimeViewSeriesParams {
  timeRange: TimeViewRangeId
  selectedDate: string
  selectedMonth: number
  selectedYearForMonth: number
  selectedYearForYear: number
}

export interface UseTimeViewSeriesResult {
  workflowDates: string[]
  workflowSeries: TimeSeriesItem[]
  serverDates: string[]
  serverSeries: TimeSeriesItem[]
  loading: boolean
  error: string | null
  progress: { current: number; total: number } | null
  refetch: () => void
}

function buildSeries(
  agg: AggregatedByDay,
  type: 'workflow' | 'server'
): { dates: string[]; series: TimeSeriesItem[] } {
  const names = type === 'workflow' ? agg.workflowNames : agg.serverNames
  const byDay = type === 'workflow' ? agg.workflowByDay : agg.serverByDay
  const series: TimeSeriesItem[] = names.map((name) => ({
    name,
    color: colorFromName(name),
    values: agg.dates.map((date) => byDay[date]?.[name] ?? 0),
  }))
  return { dates: agg.dates, series }
}

export function useTimeViewSeries(params: UseTimeViewSeriesParams): UseTimeViewSeriesResult {
  const {
    timeRange,
    selectedDate,
    selectedMonth,
    selectedYearForMonth,
    selectedYearForYear,
  } = params

  const [workflowDates, setWorkflowDates] = useState<string[]>([])
  const [workflowSeries, setWorkflowSeries] = useState<TimeSeriesItem[]>([])
  const [serverDates, setServerDates] = useState<string[]>([])
  const [serverSeries, setServerSeries] = useState<TimeSeriesItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  const fetchSeries = useCallback((): void => {
    const bounds = getTimeViewBounds(
      timeRange,
      selectedDate,
      selectedMonth,
      selectedYearForMonth,
      selectedYearForYear
    )
    setLoading(true)
    setError(null)
    setProgress({ current: 0, total: 1 })
    getUsageStatsTimeRangeWithJobs(bounds.from, bounds.to, (current, total) =>
      setProgress({ current, total })
    )
      .then((res) => {
        setProgress(null)
        if (!res.configured || res.error) {
          setError(res.error ?? 'Stats not configured')
          setWorkflowDates([])
          setWorkflowSeries([])
          setServerDates([])
          setServerSeries([])
          return
        }
        const agg = aggregateJobsByDay(res.jobs)
        const wf = buildSeries(agg, 'workflow')
        const sv = buildSeries(agg, 'server')
        setWorkflowDates(wf.dates)
        setWorkflowSeries(wf.series)
        setServerDates(sv.dates)
        setServerSeries(sv.series)
      })
      .catch((err) => {
        setProgress(null)
        setError(err instanceof Error ? err.message : 'Failed to load usage')
        setWorkflowDates([])
        setWorkflowSeries([])
        setServerDates([])
        setServerSeries([])
      })
      .finally(() => setLoading(false))
  }, [
    timeRange,
    selectedDate,
    selectedMonth,
    selectedYearForMonth,
    selectedYearForYear,
  ])

  useEffect(() => {
    fetchSeries()
  }, [fetchSeries])

  return {
    workflowDates,
    workflowSeries,
    serverDates,
    serverSeries,
    loading,
    error,
    progress,
    refetch: fetchSeries,
  }
}
