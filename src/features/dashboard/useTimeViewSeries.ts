import { useState, useCallback, useEffect, useRef } from 'react'
import { getUsageStatsTimeRangeWithJobs, getFailedJobsTimeRange } from '@/services/api/stats'
import type { ActivityJob } from '@/services/api/stats'
import {
  getTimeViewBounds,
  aggregateJobsByDay,
  aggregateHeatmap,
  aggregateFailureRate,
  aggregateByUserAndDay,
  colorFromName,
  type TimeViewRangeId,
  type AggregatedByDay,
  type HeatmapData,
  type FailureRateByDay,
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
  /** Set to false to skip fetching (used by comparison mode when disabled). */
  enabled?: boolean
}

interface CachedData {
  agg: AggregatedByDay
  heatmap: HeatmapData
  failureRate: FailureRateByDay
  userDates: string[]
  userSeries: TimeSeriesItem[]
  completedJobs: ActivityJob[]
  failedJobs: ActivityJob[]
}

// Session cache: key = `${from}|${to}`, survives re-mounts, cleared on page refresh.
// Capped to MAX_CACHE entries to prevent memory bloat.
const MAX_CACHE = 20
const timeViewCache = new Map<string, CachedData>()

function cacheSet(key: string, data: CachedData) {
  if (timeViewCache.size >= MAX_CACHE) {
    // Evict oldest entry
    const oldest = timeViewCache.keys().next().value
    if (oldest != null) timeViewCache.delete(oldest)
  }
  timeViewCache.set(key, data)
}

export interface UseTimeViewSeriesResult {
  workflowDates: string[]
  workflowSeries: TimeSeriesItem[]
  serverDates: string[]
  serverSeries: TimeSeriesItem[]
  heatmap: HeatmapData | null
  failureRate: FailureRateByDay | null
  userDates: string[]
  userSeries: TimeSeriesItem[]
  loading: boolean
  error: string | null
  progress: { current: number; total: number } | null
  refetch: () => void
  /** Raw jobs for comparison mode */
  completedJobs: ActivityJob[]
  failedJobs: ActivityJob[]
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

function buildUserSeries(
  userAgg: { dates: string[]; userByDay: Record<string, Record<string, number>>; userNames: string[] }
): { dates: string[]; series: TimeSeriesItem[] } {
  const series: TimeSeriesItem[] = userAgg.userNames.map((name) => ({
    name,
    color: colorFromName(name),
    values: userAgg.dates.map((date) => userAgg.userByDay[date]?.[name] ?? 0),
  }))
  return { dates: userAgg.dates, series }
}

const EMPTY_HEATMAP: HeatmapData = { grid: [], maxCount: 0, dayLabels: [] }
const EMPTY_FAILURE: FailureRateByDay = { dates: [], rates: [], failedCounts: [], totalCounts: [] }

export function useTimeViewSeries(params: UseTimeViewSeriesParams): UseTimeViewSeriesResult {
  const {
    timeRange,
    selectedWeek,
    selectedMonth,
    selectedYearForMonth,
    selectedYearForYear,
    enabled = true,
  } = params

  const [workflowDates, setWorkflowDates] = useState<string[]>([])
  const [workflowSeries, setWorkflowSeries] = useState<TimeSeriesItem[]>([])
  const [serverDates, setServerDates] = useState<string[]>([])
  const [serverSeries, setServerSeries] = useState<TimeSeriesItem[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  const [failureRate, setFailureRate] = useState<FailureRateByDay | null>(null)
  const [userDates, setUserDates] = useState<string[]>([])
  const [userSeries, setUserSeries] = useState<TimeSeriesItem[]>([])
  const [completedJobs, setCompletedJobs] = useState<ActivityJob[]>([])
  const [failedJobs, setFailedJobs] = useState<ActivityJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)

  const fetchIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const applyCache = useCallback((cached: CachedData) => {
    const wf = buildSeries(cached.agg, 'workflow')
    const sv = buildSeries(cached.agg, 'server')
    setWorkflowDates(wf.dates)
    setWorkflowSeries(wf.series)
    setServerDates(sv.dates)
    setServerSeries(sv.series)
    setHeatmap(cached.heatmap)
    setFailureRate(cached.failureRate)
    setUserDates(cached.userDates)
    setUserSeries(cached.userSeries)
    setCompletedJobs(cached.completedJobs)
    setFailedJobs(cached.failedJobs)
    setLoading(false)
    setError(null)
    setProgress(null)
  }, [])

  const fetchSeries = useCallback((): void => {
    abortControllerRef.current?.abort()

    if (!enabled) {
      setLoading(false)
      return
    }

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
    const cached = timeViewCache.get(cacheKey)
    if (cached) {
      applyCache(cached)
      return
    }

    setLoading(true)
    setError(null)
    setProgress({ current: 0, total: 2 })
    setWorkflowDates([])
    setWorkflowSeries([])
    setServerDates([])
    setServerSeries([])
    setHeatmap(null)
    setFailureRate(null)
    setUserDates([])
    setUserSeries([])
    setCompletedJobs([])
    setFailedJobs([])

    // Fetch completed + failed jobs in parallel
    Promise.all([
      getUsageStatsTimeRangeWithJobs(bounds.from, bounds.to, (current, total) => {
        if (fetchIdRef.current === localId) setProgress({ current, total: total * 2 })
      }, controller.signal),
      getFailedJobsTimeRange(bounds.from, bounds.to, (current, total) => {
        if (fetchIdRef.current === localId) setProgress((prev) => ({
          current: (prev?.total ?? total) / 2 + current,
          total: (prev?.total ?? total * 2),
        }))
      }, controller.signal),
    ])
      .then(([completedRes, failedRes]) => {
        if (fetchIdRef.current !== localId) return
        setProgress(null)
        if (!completedRes.configured || completedRes.error) {
          setError(completedRes.error ?? 'Stats not configured')
          return
        }
        const cJobs = completedRes.jobs
        const fJobs = failedRes.jobs ?? []

        // All jobs (completed + failed) for heatmap
        const allJobs = [...cJobs, ...fJobs]

        const agg = aggregateJobsByDay(cJobs)
        const hm = aggregateHeatmap(allJobs)
        const fr = aggregateFailureRate(cJobs, fJobs)
        const userAgg = aggregateByUserAndDay(cJobs)
        const uSeries = buildUserSeries(userAgg)

        const cacheData: CachedData = {
          agg,
          heatmap: hm,
          failureRate: fr,
          userDates: uSeries.dates,
          userSeries: uSeries.series,
          completedJobs: cJobs,
          failedJobs: fJobs,
        }
        cacheSet(cacheKey, cacheData)
        applyCache(cacheData)
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
    enabled,
    applyCache,
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
    heatmap,
    failureRate,
    userDates,
    userSeries,
    loading,
    error,
    progress,
    refetch: fetchSeries,
    completedJobs,
    failedJobs,
  }
}
