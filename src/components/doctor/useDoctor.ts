import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/features/auth'
import {
  getDoctorStats, getFailedJobs,
  type DoctorStatsResponse, type DoctorPeriod, type DoctorRankItem, type FailedJobSummary, type WeeklyHistoryItem,
} from '@/services/api/stats'

export const DOCTOR_PERIODS: { id: DoctorPeriod; label: string }[] = [
  { id: '1h', label: 'Last hour' },
  { id: '1d', label: 'Last 24 hours' },
  { id: '1w', label: 'Last 7 days' },
  { id: '1m', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
]

export const FAILED_JOBS_PAGE_SIZE = 25

export interface DoctorState {
  configured: boolean | null
  loading: boolean
  error: string | null
  totalFailed: number
  thisWeekFailed: number
  prevWeekFailed: number
  trend: number | null
  weeklyHistory: WeeklyHistoryItem[]
  period: DoctorPeriod
  setPeriod: (p: DoctorPeriod) => void
  topWorkflows: DoctorRankItem[]
  topServers: DoctorRankItem[]
  topUsers: DoctorRankItem[]
  topErrors: DoctorRankItem[]
  refresh: () => void
  failedJobs: FailedJobSummary[]
  failedJobsTotal: number
  failedJobsPage: number
  failedJobsLoading: boolean
  failedJobsSearch: string
  setFailedJobsSearch: (q: string) => void
  setFailedJobsPage: (page: number) => void
}

export function useDoctor(): DoctorState {
  const { authStatus } = useAuth()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DoctorStatsResponse | null>(null)
  const [period, setPeriod] = useState<DoctorPeriod>('1d')
  const loadIdRef = useRef(0)
  const statsAbortRef = useRef<AbortController | null>(null)
  const failedJobsAbortRef = useRef<AbortController | null>(null)

  const [failedJobs, setFailedJobs] = useState<FailedJobSummary[]>([])
  const [failedJobsTotal, setFailedJobsTotal] = useState(0)
  const [failedJobsPage, setFailedJobsPage] = useState(1)
  const [failedJobsLoading, setFailedJobsLoading] = useState(false)
  const [failedJobsSearch, setFailedJobsSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel all in-flight requests on unmount
  useEffect(() => {
    return () => {
      statsAbortRef.current?.abort()
      failedJobsAbortRef.current?.abort()
    }
  }, [])

  const setFailedJobsSearch = useCallback((q: string) => {
    setFailedJobsSearchRaw(q)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(q)
      setFailedJobsPage(1)
    }, 300)
  }, [])

  const load = useCallback(async (p: DoctorPeriod) => {
    statsAbortRef.current?.abort()
    const controller = new AbortController()
    statsAbortRef.current = controller

    const id = ++loadIdRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await getDoctorStats(p, controller.signal)
      if (controller.signal.aborted || id !== loadIdRef.current) return
      setConfigured(res.configured)
      if (res.error) setError(res.error)
      else setData(res)
    } catch (err) {
      if (controller.signal.aborted || id !== loadIdRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!controller.signal.aborted && id === loadIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok') return
    load(period)
  }, [period, load, authStatus])

  const loadFailedJobs = useCallback(async (page: number, search: string) => {
    failedJobsAbortRef.current?.abort()
    const controller = new AbortController()
    failedJobsAbortRef.current = controller

    setFailedJobsLoading(true)
    try {
      const res = await getFailedJobs(page, FAILED_JOBS_PAGE_SIZE, search, controller.signal)
      if (controller.signal.aborted) return
      setFailedJobs(res.jobs ?? [])
      setFailedJobsTotal(res.total ?? 0)
    } catch {
      if (controller.signal.aborted) return
      setFailedJobs([])
    } finally {
      if (!controller.signal.aborted) setFailedJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok' || configured !== true) return
    loadFailedJobs(failedJobsPage, debouncedSearch)
  }, [failedJobsPage, debouncedSearch, loadFailedJobs, authStatus, configured])

  const totalFailed = data?.totalFailed ?? 0
  const thisWeekFailed = data?.thisWeekFailed ?? 0
  const prevWeekFailed = data?.prevWeekFailed ?? 0

  let trend: number | null = null
  if (data && prevWeekFailed > 0) {
    trend = ((thisWeekFailed - prevWeekFailed) / prevWeekFailed) * 100
  } else if (data && thisWeekFailed > 0) {
    trend = 100
  } else if (data) {
    trend = 0
  }

  const refresh = useCallback(() => {
    load(period)
    loadFailedJobs(failedJobsPage, debouncedSearch)
  }, [load, loadFailedJobs, period, failedJobsPage, debouncedSearch])

  return {
    configured, loading, error,
    totalFailed, thisWeekFailed, prevWeekFailed, trend,
    weeklyHistory: data?.weeklyHistory ?? [],
    period, setPeriod,
    topWorkflows: data?.topWorkflows ?? [],
    topServers: data?.topServers ?? [],
    topUsers: data?.topUsers ?? [],
    topErrors: data?.topErrors ?? [],
    refresh,
    failedJobs, failedJobsTotal, failedJobsPage, failedJobsLoading,
    failedJobsSearch, setFailedJobsSearch, setFailedJobsPage,
  }
}
