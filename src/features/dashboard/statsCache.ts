import type { QueueStatsResponse, UsageStatsResponse } from '@/services/api/stats'

export interface JobStatsCacheParams {
  rangeMode: 'jobs' | 'time'
  jobsLimit: number
  timeRangeId: string
  selectedUser: string | null
}

function cacheKey(params: JobStatsCacheParams): string {
  return JSON.stringify({
    rangeMode: params.rangeMode,
    jobsLimit: params.jobsLimit,
    timeRangeId: params.timeRangeId,
    selectedUser: params.selectedUser,
  })
}

let cachedQueue: QueueStatsResponse | null = null
const usageCache = new Map<string, UsageStatsResponse>()

export function getCachedQueueStats(): QueueStatsResponse | null {
  return cachedQueue
}

export function setCachedQueueStats(data: QueueStatsResponse): void {
  cachedQueue = data
}

export function getCachedUsageStats(params: JobStatsCacheParams): UsageStatsResponse | null {
  return usageCache.get(cacheKey(params)) ?? null
}

export function setCachedUsageStats(params: JobStatsCacheParams, data: UsageStatsResponse): void {
  usageCache.set(cacheKey(params), data)
}

export function hasCachedUsageStats(params: JobStatsCacheParams): boolean {
  return usageCache.has(cacheKey(params))
}
