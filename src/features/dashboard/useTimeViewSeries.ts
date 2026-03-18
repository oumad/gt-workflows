import { useState, useCallback, useEffect, useRef } from 'react'
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
  selectedWeek: string
  selectedMonth: number
  selectedYearForMonth: number
  selectedYearForYear: number
}

// Session cache: key = `${from}|${to}`, survives re-mounts, cleared on page refresh.
const timeViewAggCache = new Map<string, AggregatedByDay>()

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
    selectedWeek,
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

  const fetchIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchSeries = useCallback((): void => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    fetchIdRef.current += 1
    const localId = fetchIdRef.current
    const bounds = getTimeViewBounds(
      timeRange,
      selectedWeek,
      selectedMonth,
      selectedYearForMonth,
      selectedYearForYear
    )

    const cacheKey = `${bounds.from}|${bounds.to}`
    const cached = timeViewAggCache.get(cacheKey)
    if (cached) {
      const wf = buildSeries(cached, 'workflow')
      const sv = buildSeries(cached, 'server')
      setWorkflowDates(wf.dates)
      setWorkflowSeries(wf.series)
      setServerDates(sv.dates)
      setServerSeries(sv.series)
      setLoading(false)
      setError(null)
      setProgress(null)
      return
    }

    setLoading(true)
    setError(null)
    setProgress({ current: 0, total: 1 })
    setWorkflowDates([])
    setWorkflowSeries([])
    setServerDates([])
    setServerSeries([])
    getUsageStatsTimeRangeWithJobs(bounds.from, bounds.to, (current, total) => {
      if (fetchIdRef.current === localId) setProgress({ current, total })
    }, controller.signal)
      .then((res) => {
        if (fetchIdRef.current !== localId) return
        setProgress(null)
        if (!res.configured || res.error) {
          setError(res.error ?? 'Stats not configured')
          return
        }
        const agg = aggregateJobsByDay(res.jobs)
        timeViewAggCache.set(cacheKey, agg)
        const wf = buildSeries(agg, 'workflow')
        const sv = buildSeries(agg, 'server')
        setWorkflowDates(wf.dates)
        setWorkflowSeries(wf.series)
        setServerDates(sv.dates)
        setServerSeries(sv.series)
      })
      .catch((err) => {
        if (fetchIdRef.current !== localId) return
        if (controller.signal.aborted) return
        setProgress(null)
        setError(err instanceof Error ? err.message : 'Failed to load usage')
      })
      .finally(() => {
        if (fetchIdRef.current !== localId) return
        setLoading(false)
      })
  }, [
    timeRange,
    selectedWeek,
    selectedMonth,
    selectedYearForMonth,
    selectedYearForYear,
  ])

  useEffect(() => {
    fetchSeries()
    return () => { abortControllerRef.current?.abort() }
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
