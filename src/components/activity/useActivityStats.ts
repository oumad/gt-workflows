import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/features/auth'
import {
  getCompletedStats, getCompletedJobs, getQueueStatsWithJobLists,
  type CompletedStatsResponse, type DoctorRankItem, type CompletedJobSummary, type ActivityJob,
  type JobFilters,
} from '@/services/api/stats'

export type { DoctorRankItem, CompletedJobSummary, ActivityJob, JobFilters }

export const ACTIVITY_STATS_PERIODS = [
  { id: '1h', label: 'Last hour' },
  { id: '1d', label: 'Last 24 hours' },
  { id: '1w', label: 'Last 7 days' },
  { id: '1m', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
] as const

export type ActivityStatsPeriod = '1h' | '1d' | '1w' | '1m' | 'all'

export const ACTIVITY_STATS_PAGE_SIZE = 25

const AUTO_INTERVALS = [5, 30, 60, 300, null] as const
export type AutoInterval = 5 | 30 | 60 | 300 | null

export interface ActivityStatsState {
  configured: boolean | null
  loading: boolean
  error: string | null
  totalCompleted: number
  weeklyHistory: { label: string; count: number }[]
  topWorkflows: DoctorRankItem[]
  topServers: DoctorRankItem[]
  topUsers: DoctorRankItem[]
  period: ActivityStatsPeriod
  setPeriod: (p: ActivityStatsPeriod) => void
  lastRefreshed: Date | null
  refresh: () => void
  autoInterval: AutoInterval
  cycleAutoInterval: () => void
  jobs: CompletedJobSummary[]
  jobsTotal: number
  jobsPage: number
  jobsLoading: boolean
  jobsSearch: string
  searchPending: boolean
  setJobsSearch: (q: string) => void
  setJobsPage: (page: number) => void
  jobsSort: string
  jobsSortDir: string
  setJobsSort: (sort: string, dir: string) => void
  jobsFilters: JobFilters
  setJobsFilter: (key: keyof JobFilters, value: string) => void
  clearJobsFilters: () => void
  // Live queue
  activeJobs: ActivityJob[]
  waitingCount: number
  queueLoading: boolean
}

export function useActivityStats(externalPeriod?: ActivityStatsPeriod, externalSetPeriod?: (p: ActivityStatsPeriod) => void): ActivityStatsState {
  const { authStatus } = useAuth()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CompletedStatsResponse | null>(null)
  const [internalPeriod, setInternalPeriod] = useState<ActivityStatsPeriod>('1d')
  const period = externalPeriod ?? internalPeriod
  const setPeriod = externalSetPeriod ?? setInternalPeriod
  const [autoInterval, setAutoInterval] = useState<AutoInterval>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const loadIdRef = useRef(0)
  const statsAbortRef = useRef<AbortController | null>(null)
  const jobsAbortRef = useRef<AbortController | null>(null)

  const [jobs, setJobs] = useState<CompletedJobSummary[]>([])
  const [jobsTotal, setJobsTotal] = useState(0)
  const [jobsPage, setJobsPage] = useState(1)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsSearch, setJobsSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchPending, setSearchPending] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [jobsSort, setJobsSortKey] = useState('')
  const [jobsSortDir, setJobsSortDir] = useState('')
  const setJobsSort = useCallback((sort: string, dir: string) => {
    setJobsSortKey(sort)
    setJobsSortDir(dir)
    setJobsPage(1)
  }, [])

  const [jobsFilters, setJobsFilters] = useState<JobFilters>({})

  const setJobsFilter = useCallback((key: keyof JobFilters, value: string) => {
    setJobsFilters((prev) => ({ ...prev, [key]: value }))
    setJobsPage(1)
  }, [])

  const clearJobsFilters = useCallback(() => {
    setJobsFilters({})
    setJobsPage(1)
  }, [])

  const [activeJobs, setActiveJobs] = useState<ActivityJob[]>([])
  const [waitingCount, setWaitingCount] = useState(0)
  const [queueLoading, setQueueLoading] = useState(false)

  useEffect(() => {
    return () => {
      statsAbortRef.current?.abort()
      jobsAbortRef.current?.abort()
    }
  }, [])

  const setJobsSearch = useCallback((q: string) => {
    setJobsSearchRaw(q)
    setSearchPending(true)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchPending(false)
      setDebouncedSearch(q)
      setJobsPage(1)
    }, 300)
  }, [])

  const load = useCallback(async (p: ActivityStatsPeriod, force = false) => {
    statsAbortRef.current?.abort()
    const controller = new AbortController()
    statsAbortRef.current = controller
    const id = ++loadIdRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await getCompletedStats(p, controller.signal, force)
      if (controller.signal.aborted || id !== loadIdRef.current) return
      setConfigured(res.configured)
      if (res.error) setError(res.error)
      else { setData(res); setLastRefreshed(new Date()) }
    } catch (err) {
      if (controller.signal.aborted || id !== loadIdRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!controller.signal.aborted && id === loadIdRef.current) setLoading(false)
    }
  }, [])

  const loadQueue = useCallback(async () => {
    setQueueLoading(true)
    try {
      const res = await getQueueStatsWithJobLists()
      setActiveJobs(res.active ?? [])
      setWaitingCount(res.waiting?.length ?? 0)
    } catch {
      // silently ignore — queue may not be configured
    } finally {
      setQueueLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok') return
    load(period)
  }, [period, load, authStatus])

  useEffect(() => {
    if (authStatus !== 'ok') return
    loadQueue()
  }, [loadQueue, authStatus])

  const loadJobs = useCallback(async (page: number, search: string, sort = '', sortDir = '', filters?: JobFilters) => {
    jobsAbortRef.current?.abort()
    const controller = new AbortController()
    jobsAbortRef.current = controller
    setJobsLoading(true)
    try {
      const res = await getCompletedJobs(page, ACTIVITY_STATS_PAGE_SIZE, search, controller.signal, sort, sortDir, filters)
      if (controller.signal.aborted) return
      setJobs(res.jobs ?? [])
      setJobsTotal(res.total ?? 0)
    } catch {
      if (controller.signal.aborted) return
      setJobs([])
    } finally {
      if (!controller.signal.aborted) setJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok' || configured !== true) return
    loadJobs(jobsPage, debouncedSearch, jobsSort, jobsSortDir, jobsFilters)
  }, [jobsPage, debouncedSearch, jobsSort, jobsSortDir, jobsFilters, loadJobs, authStatus, configured])

  const cycleAutoInterval = useCallback(() => {
    setAutoInterval((cur) => {
      const idx = AUTO_INTERVALS.indexOf(cur)
      return AUTO_INTERVALS[(idx + 1) % AUTO_INTERVALS.length]
    })
  }, [])

  const refresh = useCallback(() => {
    load(period, true)
    loadJobs(jobsPage, debouncedSearch, jobsSort, jobsSortDir, jobsFilters)
    loadQueue()
  }, [load, loadJobs, loadQueue, period, jobsPage, debouncedSearch, jobsSort, jobsSortDir, jobsFilters])

  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  useEffect(() => {
    if (!autoInterval) return
    const id = setInterval(() => { refreshRef.current() }, autoInterval * 1000)
    return () => clearInterval(id)
  }, [autoInterval])

  return {
    configured, loading, error,
    totalCompleted: data?.totalCompleted ?? 0,
    weeklyHistory: data?.weeklyHistory ?? [],
    topWorkflows: data?.topWorkflows ?? [],
    topServers: data?.topServers ?? [],
    topUsers: data?.topUsers ?? [],
    period, setPeriod,
    lastRefreshed, refresh,
    autoInterval, cycleAutoInterval,
    jobs, jobsTotal, jobsPage, jobsLoading,
    jobsSearch, searchPending, setJobsSearch, setJobsPage,
    jobsSort, jobsSortDir, setJobsSort,
    jobsFilters, setJobsFilter, clearJobsFilters,
    activeJobs, waitingCount, queueLoading,
  }
}
