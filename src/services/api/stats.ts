import { fetchWithAuth } from '@/utils/auth'

export interface QueueCounts {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export interface QueueStatsResponse {
  configured: boolean
  message?: string
  counts: QueueCounts | null
  error?: string
}

export interface WorkflowUsageItem {
  name: string
  count: number
  users?: string[]
}

export interface ServerUsageItem {
  server: string
  count: number
}

export interface UserActivityItem {
  user: string
  count: number
}

export interface UsageStatsResponse {
  configured: boolean
  message?: string
  workflowUsage: WorkflowUsageItem[]
  serverUsage: ServerUsageItem[]
  userActivity: UserActivityItem[]
  jobsSampled?: number
  offset?: number
  limit?: number
  from?: string
  to?: string
  totalScanned?: number
  userFilter?: string
  jobs?: ActivityJob[]
  error?: string
}

export interface UsageStatsOptions {
  limit?: number
  offset?: number
  from?: string
  to?: string
  user?: string
  scanLimit?: number
  includeJobs?: boolean
}

export interface ActivityJob {
  id: string
  name: string
  user: string
  server: string
  processedOn: number
  finishedOn?: number
  timestamp?: number
}

export interface ActivityResponse {
  configured: boolean
  active: ActivityJob[]
  waiting: ActivityJob[]
  error?: string
}

export interface QueueStatsWithJobsResponse extends QueueStatsResponse {
  active?: ActivityJob[]
  waiting?: ActivityJob[]
}

export interface JobLogsResponse {
  logs: string[]
  count: number
  error?: string
}

const STATS_REQUEST_TIMEOUT_MS = 120000

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return fetchWithAuth(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId))
}

function mergeWorkflowUsage(a: WorkflowUsageItem[], b: WorkflowUsageItem[]): WorkflowUsageItem[] {
  const countBy = new Map<string, number>()
  const usersBy = new Map<string, Set<string>>()
  for (const item of a) {
    countBy.set(item.name, (countBy.get(item.name) ?? 0) + item.count)
    const set = usersBy.get(item.name) ?? new Set<string>()
    for (const u of item.users ?? []) set.add(u)
    usersBy.set(item.name, set)
  }
  for (const item of b) {
    countBy.set(item.name, (countBy.get(item.name) ?? 0) + item.count)
    const set = usersBy.get(item.name) ?? new Set<string>()
    for (const u of item.users ?? []) set.add(u)
    usersBy.set(item.name, set)
  }
  return Array.from(countBy.entries(), ([name, count]) => ({
    name,
    count,
    users: Array.from(usersBy.get(name) ?? []),
  })).sort((x, y) => y.count - x.count)
}

function mergeServerUsage(a: ServerUsageItem[], b: ServerUsageItem[]): ServerUsageItem[] {
  const map = new Map<string, number>()
  for (const item of a) map.set(item.server, (map.get(item.server) ?? 0) + item.count)
  for (const item of b) map.set(item.server, (map.get(item.server) ?? 0) + item.count)
  return Array.from(map.entries(), ([server, count]) => ({ server, count })).sort((x, y) => y.count - x.count)
}

function mergeUserActivity(a: UserActivityItem[], b: UserActivityItem[]): UserActivityItem[] {
  const map = new Map<string, number>()
  for (const item of a) map.set(item.user, (map.get(item.user) ?? 0) + item.count)
  for (const item of b) map.set(item.user, (map.get(item.user) ?? 0) + item.count)
  return Array.from(map.entries(), ([user, count]) => ({ user, count })).sort((x, y) => y.count - x.count)
}

export async function getQueueStats(): Promise<QueueStatsResponse> {
  const response = await fetchWithTimeout('/api/stats/queue', STATS_REQUEST_TIMEOUT_MS)
  return response.json()
}

export async function getQueueStatsWithJobLists(): Promise<QueueStatsWithJobsResponse> {
  const response = await fetchWithTimeout('/api/stats/queue?list=1', STATS_REQUEST_TIMEOUT_MS)
  const data = await response.json()
  return {
    configured: data.configured ?? false,
    counts: data.counts ?? null,
    error: data.error,
    active: Array.isArray(data.active) ? data.active : [],
    waiting: Array.isArray(data.waiting) ? data.waiting : [],
  }
}

export async function getJobLogs(jobId: string): Promise<JobLogsResponse> {
  const response = await fetchWithAuth(`/api/stats/job/${encodeURIComponent(jobId)}/logs`)
  if (!response.ok) {
    const err = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }
    return { logs: [], count: 0, error: err.error ?? response.statusText }
  }
  return response.json()
}

export async function getUsageStatsChunk(options: UsageStatsOptions): Promise<UsageStatsResponse> {
  const params = new URLSearchParams()
  if (options.limit != null) params.set('limit', String(options.limit))
  if (options.offset != null) params.set('offset', String(options.offset))
  if (options.from != null) params.set('from', options.from)
  if (options.to != null) params.set('to', options.to)
  if (options.user != null) params.set('user', options.user)
  if (options.scanLimit != null) params.set('scanLimit', String(options.scanLimit))
  if (options.includeJobs) params.set('includeJobs', '1')
  const url = `/api/stats/usage?${params.toString()}`
  const response = await fetchWithTimeout(url, STATS_REQUEST_TIMEOUT_MS)
  return response.json()
}

export async function getUsageStatsChunked(
  totalJobs: number,
  chunkSize: number,
  options: { user?: string },
  onProgress: (current: number, total: number) => void
): Promise<UsageStatsResponse> {
  const merged = {
    workflowUsage: [] as WorkflowUsageItem[],
    serverUsage: [] as ServerUsageItem[],
    userActivity: [] as UserActivityItem[],
    jobsSampled: 0,
    configured: true as const,
  }
  for (let offset = 0; offset < totalJobs; offset += chunkSize) {
    const limit = Math.min(chunkSize, totalJobs - offset)
    const res = await getUsageStatsChunk({ limit, offset, user: options.user })
    if (res.error) throw new Error(res.error)
    if (!res.configured) return res
    merged.workflowUsage = mergeWorkflowUsage(merged.workflowUsage, res.workflowUsage ?? [])
    merged.serverUsage = mergeServerUsage(merged.serverUsage, res.serverUsage ?? [])
    merged.userActivity = mergeUserActivity(merged.userActivity, res.userActivity ?? [])
    merged.jobsSampled += res.jobsSampled ?? 0
    onProgress(Math.min(offset + limit, totalJobs), totalJobs)
  }
  return merged
}

export async function getUsageStats(options: UsageStatsOptions): Promise<UsageStatsResponse> {
  return getUsageStatsChunk(options)
}

const TIME_RANGE_CHUNK_SIZE = 2000

export async function getUsageStatsTimeRangeChunked(
  from: string,
  to: string,
  scanLimit: number,
  options: { user?: string },
  onProgress: (scanned: number, total: number) => void
): Promise<UsageStatsResponse> {
  const merged = {
    workflowUsage: [] as WorkflowUsageItem[],
    serverUsage: [] as ServerUsageItem[],
    userActivity: [] as UserActivityItem[],
    jobsSampled: 0,
    configured: true as const,
    from,
    to,
  }
  for (let offset = 0; offset < scanLimit; offset += TIME_RANGE_CHUNK_SIZE) {
    const limit = Math.min(TIME_RANGE_CHUNK_SIZE, scanLimit - offset)
    const res = await getUsageStatsChunk({
      from,
      to,
      offset,
      limit,
      scanLimit,
      user: options.user,
    })
    if (res.error) throw new Error(res.error)
    if (!res.configured) return res
    merged.workflowUsage = mergeWorkflowUsage(merged.workflowUsage, res.workflowUsage ?? [])
    merged.serverUsage = mergeServerUsage(merged.serverUsage, res.serverUsage ?? [])
    merged.userActivity = mergeUserActivity(merged.userActivity, res.userActivity ?? [])
    merged.jobsSampled += res.jobsSampled ?? 0
    onProgress(offset + limit, scanLimit)
  }
  return merged
}

const TIME_VIEW_CHUNK_SIZE = 2000
const TIME_VIEW_SCAN_LIMIT_MAX = 15000

export interface TimeViewJobsResult {
  jobs: ActivityJob[]
  configured: boolean
  error?: string
}

/** Fetches all jobs in a time range for Time View usage-by-day aggregation. */
export async function getUsageStatsTimeRangeWithJobs(
  from: string,
  to: string,
  onProgress?: (scanned: number, total: number) => void
): Promise<TimeViewJobsResult> {
  const scanLimit = TIME_VIEW_SCAN_LIMIT_MAX
  const allJobs: ActivityJob[] = []
  for (let offset = 0; offset < scanLimit; offset += TIME_VIEW_CHUNK_SIZE) {
    const limit = Math.min(TIME_VIEW_CHUNK_SIZE, scanLimit - offset)
    const res = await getUsageStatsChunk({
      from,
      to,
      offset,
      limit,
      scanLimit,
      includeJobs: true,
    })
    if (res.error) return { jobs: [], configured: res.configured, error: res.error }
    if (!res.configured) return { jobs: [], configured: false }
    const chunk = res.jobs ?? []
    allJobs.push(...chunk)
    onProgress?.(offset + chunk.length, scanLimit)
    if (chunk.length < limit) break
  }
  return { jobs: allJobs, configured: true }
}
