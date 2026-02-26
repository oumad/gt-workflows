import { useState, useCallback, useRef, useEffect } from 'react'
import {
  getQueueStats,
  getUsageStatsChunked,
  getUsageStatsTimeRangeChunked,
  getUsageStatsChunk,
} from '@/services/api/stats'
import type {
  QueueCounts,
  WorkflowUsageItem,
  ServerUsageItem,
  UserActivityItem,
  ActivityJob,
  UsageStatsResponse,
} from '@/services/api/stats'
import {
  getCachedQueueStats,
  setCachedQueueStats,
  getCachedUsageStats,
  setCachedUsageStats,
  hasCachedUsageStats,
  type JobStatsCacheParams,
} from './statsCache'

const CHUNK_SIZE = 500
const TIME_RANGE_SCAN_LIMIT = 15000
const TIME_RANGE_CHUNK_SIZE = 2000

export type TimeRangeId = '24h' | '7d' | '15d' | '30d'

export function getTimeRangeBounds(rangeId: TimeRangeId): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (rangeId === '24h') from.setHours(from.getHours() - 24)
  else if (rangeId === '7d') from.setDate(from.getDate() - 7)
  else if (rangeId === '15d') from.setDate(from.getDate() - 15)
  else from.setDate(from.getDate() - 30)
  return { from: from.toISOString(), to: to.toISOString() }
}

const TIME_RANGES: { id: TimeRangeId; label: string }[] = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '15d', label: 'Last 15 days' },
  { id: '30d', label: 'Last 30 days' },
]

export const JOBS_LIMIT_OPTIONS = [500, 1000, 2000, 3000, 5000] as const
export { TIME_RANGES }

export interface UseJobStatsParams {
  rangeMode: 'jobs' | 'time'
  jobsLimit: number
  timeRangeId: TimeRangeId
  selectedUser: string | null
}

export interface UseJobStatsResult {
  queueCounts: QueueCounts | null
  workflowUsage: WorkflowUsageItem[]
  serverUsage: ServerUsageItem[]
  userActivity: UserActivityItem[]
  jobsSampled: number | null
  timeRangeLabel: string | null
  configured: boolean | null
  loading: boolean
  error: string | null
  progress: { current: number; total: number } | null
  userJobs: ActivityJob[]
  userJobsLoading: boolean
  loadStats: (forceRefresh?: boolean) => Promise<void>
}

function applyUsageResponse(
  res: UsageStatsResponse,
  setState: {
    setWorkflowUsage: (v: WorkflowUsageItem[]) => void
    setServerUsage: (v: ServerUsageItem[]) => void
    setUserActivity: (v: UserActivityItem[]) => void
    setJobsSampled: (v: number | null) => void
    setTimeRangeLabel: (v: string | null) => void
  },
  selectedUser: string | null,
  timeRangeId: TimeRangeId
): void {
  if (res.workflowUsage) setState.setWorkflowUsage(res.workflowUsage)
  if (res.serverUsage) setState.setServerUsage(res.serverUsage)
  if (!selectedUser && res.userActivity) setState.setUserActivity(res.userActivity)
  if (res.jobsSampled != null) setState.setJobsSampled(res.jobsSampled)
  const label =
    res.from && res.to
      ? `${new Date(res.from).toLocaleDateString()} – ${new Date(res.to).toLocaleDateString()}`
      : TIME_RANGES.find((r) => r.id === timeRangeId)?.label ?? null
  setState.setTimeRangeLabel(label)
}

export function useJobStats(params: UseJobStatsParams): UseJobStatsResult {
  const { rangeMode, jobsLimit, timeRangeId, selectedUser } = params
  const cacheParams: JobStatsCacheParams = { rangeMode, jobsLimit, timeRangeId, selectedUser }

  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [workflowUsage, setWorkflowUsage] = useState<WorkflowUsageItem[]>([])
  const [serverUsage, setServerUsage] = useState<ServerUsageItem[]>([])
  const [userActivity, setUserActivity] = useState<UserActivityItem[]>([])
  const [jobsSampled, setJobsSampled] = useState<number | null>(null)
  const [timeRangeLabel, setTimeRangeLabel] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [userJobs, setUserJobs] = useState<ActivityJob[]>([])
  const [userJobsLoading, setUserJobsLoading] = useState(false)

  const setState = {
    setWorkflowUsage,
    setServerUsage,
    setUserActivity,
    setJobsSampled,
    setTimeRangeLabel,
  }

  const loadUserJobs = useCallback(
    async (user: string) => {
      setUserJobsLoading(true)
      setUserJobs([])
      try {
        const allJobs: ActivityJob[] = []
        if (rangeMode === 'time') {
          const { from, to } = getTimeRangeBounds(timeRangeId)
          for (let offset = 0; offset < TIME_RANGE_SCAN_LIMIT; offset += TIME_RANGE_CHUNK_SIZE) {
            const limit = Math.min(TIME_RANGE_CHUNK_SIZE, TIME_RANGE_SCAN_LIMIT - offset)
            const res = await getUsageStatsChunk({
              from,
              to,
              limit,
              offset,
              scanLimit: TIME_RANGE_SCAN_LIMIT,
              user,
              includeJobs: true,
            })
            allJobs.push(...(res.jobs ?? []))
          }
        } else {
          for (let offset = 0; offset < jobsLimit; offset += CHUNK_SIZE) {
            const limit = Math.min(CHUNK_SIZE, jobsLimit - offset)
            const res = await getUsageStatsChunk({
              limit,
              offset,
              user,
              includeJobs: true,
            })
            allJobs.push(...(res.jobs ?? []))
          }
        }
        setUserJobs(allJobs)
      } catch {
        setUserJobs([])
      } finally {
        setUserJobsLoading(false)
      }
    },
    [rangeMode, jobsLimit, timeRangeId]
  )

  const loadStats = useCallback(
    async (forceRefresh = false) => {
      const useCache = !forceRefresh && hasCachedUsageStats(cacheParams)
      const cachedQueue = getCachedQueueStats()
      const cachedUsage = getCachedUsageStats(cacheParams)

      if (useCache && cachedUsage && cachedQueue !== null) {
        setConfigured(cachedQueue.configured)
        if (cachedQueue.counts) setQueueCounts(cachedQueue.counts)
        if (cachedQueue.error) setError(cachedQueue.error)
        applyUsageResponse(
          cachedUsage,
          {
            setWorkflowUsage,
            setServerUsage,
            setUserActivity,
            setJobsSampled,
            setTimeRangeLabel,
          },
          selectedUser,
          timeRangeId
        )
        setLoading(false)
        setError(null)
        setProgress(null)
        if (selectedUser) loadUserJobs(selectedUser)
        return
      }

      setLoading(true)
      setError(null)
      setProgress(null)
      setUserJobs([])

      try {
        const queueRes = await getQueueStats()
        setConfigured(queueRes.configured)
        if (queueRes.counts) setQueueCounts(queueRes.counts)
        if (queueRes.error) setError(queueRes.error)
        setCachedQueueStats(queueRes)

        if (!queueRes.configured) {
          setLoading(false)
          return
        }

        const userOpt = selectedUser ? { user: selectedUser } : {}

        if (rangeMode === 'time') {
          const { from, to } = getTimeRangeBounds(timeRangeId)
          const usageRes = await getUsageStatsTimeRangeChunked(
            from,
            to,
            TIME_RANGE_SCAN_LIMIT,
            userOpt,
            (scanned, total) => setProgress({ current: scanned, total })
          )
          if (usageRes.error) setError(usageRes.error)
          applyUsageResponse(usageRes, setState, selectedUser, timeRangeId)
          setCachedUsageStats(cacheParams, usageRes)
          if (selectedUser) loadUserJobs(selectedUser)
        } else {
          const usageRes = await getUsageStatsChunked(
            jobsLimit,
            CHUNK_SIZE,
            userOpt,
            (current, total) => setProgress({ current, total })
          )
          if (usageRes.error) setError(usageRes.error)
          applyUsageResponse(usageRes, setState, selectedUser, timeRangeId)
          setCachedUsageStats(cacheParams, usageRes)
          if (selectedUser) loadUserJobs(selectedUser)
        }

        setProgress(null)
      } catch (err) {
        const message =
          err instanceof Error && err.name === 'AbortError'
            ? 'Request took too long. Try a smaller range or fewer jobs.'
            : err instanceof Error
              ? err.message
              : 'Failed to load stats'
        setError(message)
        setProgress(null)
      } finally {
        setLoading(false)
      }
    },
    [
      rangeMode,
      jobsLimit,
      timeRangeId,
      selectedUser,
      loadUserJobs,
    ]
  )

  const prevParamsRef = useRef<string | null>(null)
  useEffect(() => {
    const key = JSON.stringify(cacheParams)
    if (prevParamsRef.current !== key) {
      prevParamsRef.current = key
      loadStats()
    }
  }, [rangeMode, jobsLimit, timeRangeId, selectedUser, loadStats])

  return {
    queueCounts,
    workflowUsage,
    serverUsage,
    userActivity,
    jobsSampled,
    timeRangeLabel,
    configured,
    loading,
    error,
    progress,
    userJobs,
    userJobsLoading,
    loadStats,
  }
}
