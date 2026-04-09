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
  users?: { user: string; count: number }[]
}

export interface ServerUsageItem {
  server: string
  count: number
}

export interface ServerWorkflowItem {
  name: string
  count: number
}

export interface ServerWorkflowsEntry {
  server: string
  workflows: ServerWorkflowItem[]
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
  serverWorkflows?: ServerWorkflowsEntry[]
  userActivity: UserActivityItem[]
  jobsSampled?: number
  offset?: number
  limit?: number
  from?: string
  to?: string
  totalScanned?: number
  /** When true, this chunk included jobs older than `from`; client can stop scanning. */
  reachedRangeStart?: boolean
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
  timeout?: number
  failedReason?: string
  data?: Record<string, unknown>
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

export type DoctorPeriod = '1h' | '1d' | '1w' | '1m' | 'all'

export interface DoctorRankItem {
  name: string
  count: number
}

export interface WeeklyHistoryItem {
  label: string
  count: number
  total: number
}

export interface DoctorStatsResponse {
  configured: boolean
  totalFailed?: number
  thisWeekFailed?: number
  prevWeekFailed?: number
  weeklyHistory?: WeeklyHistoryItem[]
  topWorkflows?: DoctorRankItem[]
  topServers?: DoctorRankItem[]
  topUsers?: DoctorRankItem[]
  topErrors?: DoctorRankItem[]
  period?: string
  message?: string
  error?: string
}

export interface FailedJobSummary {
  id: string
  name: string
  server: string
  user: string
  failedReason: string | null
  stacktrace: string[]
  timestamp: number | null
  processedOn: number | null
  finishedOn: number | null
  attemptsMade: number
  data: Record<string, unknown>
}

export interface FailedJobsResponse {
  configured: boolean
  jobs: FailedJobSummary[]
  total: number
  page: number
  pageSize: number
  error?: string
}

export interface JobFullData {
  id: string
  name: string
  status: string
  timestamp: number | null
  processedOn: number | null
  finishedOn: number | null
  failedReason: string | null
  data: Record<string, unknown> | null
}

export type FailureCategory = 'timeout' | 'oom' | 'cancelled' | 'network' | 'server_error' | 'unknown'

export interface SlowJob {
  id: string
  name: string
  server: string
  user: string
  status: 'completed' | 'failed'
  processedOn: number | null
  finishedOn: number | null
  timestamp: number | null
  duration: number | null       // ms — generation time
  queueWait: number | null      // ms — time in Bull queue before processing
  failedReason: string | null
  reasonCategory: FailureCategory | null
  timeoutMs: number | null
}

export interface SlowJobsResponse {
  configured: boolean
  jobs: SlowJob[]
  thresholdSec: number
  error?: string
}

export async function getSlowJobs(thresholdSec = 600, limit = 100, period?: string): Promise<SlowJobsResponse> {
  const params = new URLSearchParams({ threshold: String(thresholdSec), limit: String(limit) })
  if (period) params.set('period', period)
  const res = await fetchWithAuth(`/api/stats/slow-jobs?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface ServerComparisonEntry {
  server: string
  totalCount: number
  failCount: number
  failRate: number   // percentage 0-100
  avgMs: number | null
}

export interface ServerComparisonResponse {
  configured: boolean
  servers: ServerComparisonEntry[]
  period: string
  error?: string
}

export async function getServerComparison(period = '1d', signal?: AbortSignal): Promise<ServerComparisonResponse> {
  const res = await fetchWithAuth(`/api/stats/server-comparison?period=${period}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface WorkflowPerfEntry {
  name: string
  totalCount: number
  failCount: number
  failRate: number    // percentage 0-100
  avgMs: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface WorkflowPerfResponse {
  configured: boolean
  workflows: WorkflowPerfEntry[]
  period: string
  error?: string
}

export async function getWorkflowPerformance(period = 'all', signal?: AbortSignal): Promise<WorkflowPerfResponse> {
  const res = await fetchWithAuth(`/api/stats/workflow-performance?period=${period}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getJobFullData(jobId: string): Promise<JobFullData> {
  const res = await fetchWithAuth(`/api/stats/job/${jobId}/data`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface CompletedJobSummary {
  id: string
  name: string
  server: string
  user: string
  timestamp: number | null
  processedOn: number | null
  finishedOn: number | null
  duration: number | null
  status?: string
}

export interface CompletedJobsResponse {
  configured: boolean
  jobs: CompletedJobSummary[]
  total: number
  page: number
  pageSize: number
  error?: string
}

export interface CompletedStatsResponse {
  configured: boolean
  totalCompleted?: number
  weeklyHistory?: { label: string; count: number }[]
  topWorkflows?: DoctorRankItem[]
  topServers?: DoctorRankItem[]
  topUsers?: DoctorRankItem[]
  period?: string
  message?: string
  error?: string
}

const STATS_REQUEST_TIMEOUT_MS = 30_000

function fetchWithTimeout(url: string, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId)
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
  return fetchWithAuth(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId))
}

function mergeWorkflowUsage(a: WorkflowUsageItem[], b: WorkflowUsageItem[]): WorkflowUsageItem[] {
  const countBy = new Map<string, number>()
  const usersBy = new Map<string, Map<string, number>>()
  for (const item of [...a, ...b]) {
    countBy.set(item.name, (countBy.get(item.name) ?? 0) + item.count)
    const map = usersBy.get(item.name) ?? new Map<string, number>()
    for (const u of item.users ?? []) map.set(u.user, (map.get(u.user) ?? 0) + u.count)
    usersBy.set(item.name, map)
  }
  return Array.from(countBy.entries(), ([name, count]) => ({
    name,
    count,
    users: Array.from(usersBy.get(name) ?? [], ([user, c]) => ({ user, count: c })).sort((x, y) => y.count - x.count),
  })).sort((x, y) => y.count - x.count)
}

function mergeServerUsage(a: ServerUsageItem[], b: ServerUsageItem[]): ServerUsageItem[] {
  const map = new Map<string, number>()
  for (const item of a) map.set(item.server, (map.get(item.server) ?? 0) + item.count)
  for (const item of b) map.set(item.server, (map.get(item.server) ?? 0) + item.count)
  return Array.from(map.entries(), ([server, count]) => ({ server, count })).sort((x, y) => y.count - x.count)
}

function mergeServerWorkflows(a: ServerWorkflowsEntry[], b: ServerWorkflowsEntry[]): ServerWorkflowsEntry[] {
  const map = new Map<string, Map<string, number>>()
  for (const entry of [...a, ...b]) {
    let wfMap = map.get(entry.server)
    if (!wfMap) { wfMap = new Map(); map.set(entry.server, wfMap) }
    for (const wf of entry.workflows) {
      wfMap.set(wf.name, (wfMap.get(wf.name) ?? 0) + wf.count)
    }
  }
  return Array.from(map.entries(), ([server, wfMap]) => ({
    server,
    workflows: Array.from(wfMap.entries(), ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }))
}

function mergeUserActivity(a: UserActivityItem[], b: UserActivityItem[]): UserActivityItem[] {
  const map = new Map<string, number>()
  for (const item of a) map.set(item.user, (map.get(item.user) ?? 0) + item.count)
  for (const item of b) map.set(item.user, (map.get(item.user) ?? 0) + item.count)
  return Array.from(map.entries(), ([user, count]) => ({ user, count })).sort((x, y) => y.count - x.count)
}

export async function getDoctorStats(period: DoctorPeriod = '1w', signal?: AbortSignal, hideAborted = false, force = false): Promise<DoctorStatsResponse> {
  const params = new URLSearchParams({ period })
  if (hideAborted) params.set('hideAborted', '1')
  if (force) params.set('force', '1')
  const response = await fetchWithTimeout(`/api/stats/doctor?${params.toString()}`, STATS_REQUEST_TIMEOUT_MS, signal)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Doctor stats failed (${response.status}): ${body || response.statusText}`)
  }
  return response.json()
}

export async function getFailedJobs(page = 1, pageSize = 25, search = '', signal?: AbortSignal, hideAborted = false, filters?: JobFilters): Promise<FailedJobsResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (search) params.set('search', search)
  if (hideAborted) params.set('hideAborted', '1')
  if (filters?.workflow) params.set('workflow', filters.workflow)
  if (filters?.server) params.set('server', filters.server)
  if (filters?.user) params.set('user', filters.user)
  if (filters?.error) params.set('error', filters.error)
  const response = await fetchWithTimeout(
    `/api/stats/doctor/failed-jobs?${params.toString()}`,
    STATS_REQUEST_TIMEOUT_MS,
    signal,
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed jobs fetch failed (${response.status}): ${body || response.statusText}`)
  }
  return response.json()
}

export interface UserServerEntry {
  user: string
  total: number
  totalDurationMs?: number
  servers: { server: string; count: number; pct: number; durationMs?: number; durationPct?: number }[]
  workflows?: { name: string; count: number; pct: number; durationMs?: number; durationPct?: number }[]
}

export interface ServerUserEntry {
  server: string
  total: number
  totalDurationMs?: number
  users: { user: string; count: number; pct: number; durationMs?: number; durationPct?: number }[]
}

export interface ServerWorkflowEntry {
  server: string
  total: number
  workflows: { name: string; count: number; pct: number }[]
}

export interface UserServerStats {
  configured: boolean
  byUser: UserServerEntry[]
  byServer: ServerUserEntry[]
  byServerWorkflow: ServerWorkflowEntry[]
  period: string
  error?: string
}

export async function getUserServerStats(
  period: ActivityStatsPeriod = '1w',
  signal?: AbortSignal,
  force = false
): Promise<UserServerStats> {
  const params = new URLSearchParams({ period })
  if (force) params.set('force', '1')
  const res = await fetchWithAuth(`/api/stats/usage/user-server?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getCompletedStats(period = '1w', signal?: AbortSignal, force = false): Promise<CompletedStatsResponse> {
  const params = new URLSearchParams({ period })
  if (force) params.set('force', '1')
  const response = await fetchWithTimeout(`/api/stats/completed?${params.toString()}`, STATS_REQUEST_TIMEOUT_MS, signal)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Completed stats failed (${response.status}): ${body || response.statusText}`)
  }
  return response.json()
}

export interface JobFilters {
  user?: string
  server?: string
  workflow?: string
  error?: string
}

export async function getCompletedJobs(page = 1, pageSize = 25, search = '', signal?: AbortSignal, sort = '', sortDir = '', filters?: JobFilters): Promise<CompletedJobsResponse> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  if (sortDir) params.set('sortDir', sortDir)
  if (filters?.user) params.set('filterUser', filters.user)
  if (filters?.server) params.set('filterServer', filters.server)
  if (filters?.workflow) params.set('filterWorkflow', filters.workflow)
  const response = await fetchWithTimeout(`/api/stats/completed/jobs?${params.toString()}`, STATS_REQUEST_TIMEOUT_MS, signal)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Completed jobs fetch failed (${response.status}): ${body || response.statusText}`)
  }
  return response.json()
}

export async function getQueueStats(): Promise<QueueStatsResponse> {
  const response = await fetchWithTimeout('/api/stats/queue', STATS_REQUEST_TIMEOUT_MS)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Queue stats failed (${response.status}): ${body || response.statusText}`)
  }
  return response.json()
}

export async function getQueueStatsWithJobLists(): Promise<QueueStatsWithJobsResponse> {
  const response = await fetchWithTimeout('/api/stats/queue?list=1', STATS_REQUEST_TIMEOUT_MS)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Queue stats failed (${response.status}): ${body || response.statusText}`)
  }
  const data = await response.json()
  return {
    configured: data.configured ?? false,
    counts: data.counts ?? null,
    error: data.error,
    active: Array.isArray(data.active) ? data.active : [],
    waiting: Array.isArray(data.waiting) ? data.waiting : [],
  }
}

export async function getPromptMap(serverUrl: string): Promise<{ promptId: string; bullJobId: string }[]> {
  const res = await fetchWithAuth(`/api/stats/prompt-map?server=${encodeURIComponent(serverUrl)}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.map ?? []
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
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Usage stats failed (${response.status}): ${body || response.statusText}`)
  }
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
    serverWorkflows: [] as ServerWorkflowsEntry[],
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
    merged.serverWorkflows = mergeServerWorkflows(merged.serverWorkflows, res.serverWorkflows ?? [])
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
    serverWorkflows: [] as ServerWorkflowsEntry[],
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
    merged.serverWorkflows = mergeServerWorkflows(merged.serverWorkflows, res.serverWorkflows ?? [])
    merged.userActivity = mergeUserActivity(merged.userActivity, res.userActivity ?? [])
    merged.jobsSampled += res.jobsSampled ?? 0
    onProgress(offset + limit, scanLimit)
    if (res.reachedRangeStart) break
    if (res.totalScanned != null && res.totalScanned - offset < limit) break
  }
  return merged
}

const TIME_VIEW_CHUNK_SIZE = 2000
/** Scan up to 200k completed jobs so day/month in the past can be found. */
const TIME_VIEW_SCAN_LIMIT_MAX = 200000

export interface TimeViewJobsResult {
  jobs: ActivityJob[]
  configured: boolean
  error?: string
}

/** Fetches all jobs in a time range for Time View usage-by-day aggregation. */
export async function getUsageStatsTimeRangeWithJobs(
  from: string,
  to: string,
  onProgress?: (scanned: number, total: number) => void,
  signal?: AbortSignal,
): Promise<TimeViewJobsResult> {
  const scanLimit = TIME_VIEW_SCAN_LIMIT_MAX
  const allJobs: ActivityJob[] = []
  for (let offset = 0; offset < scanLimit; offset += TIME_VIEW_CHUNK_SIZE) {
    if (signal?.aborted) break
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
    onProgress?.(offset + limit, scanLimit)
    if (res.reachedRangeStart) break
    // Use raw jobs scanned (not time-filtered count) to detect true end of queue.
    // chunk.length < limit would misfire when the batch contains jobs outside the time range.
    if (res.totalScanned != null && res.totalScanned - offset < limit) break
  }
  return { jobs: allJobs, configured: true }
}

/** Fetches failed jobs in a time range for failure rate / heatmap analytics. */
export async function getFailedJobsTimeRange(
  from: string,
  to: string,
  onProgress?: (scanned: number, total: number) => void,
  signal?: AbortSignal,
): Promise<TimeViewJobsResult> {
  const scanLimit = 200000
  const allJobs: ActivityJob[] = []
  for (let offset = 0; offset < scanLimit; offset += TIME_VIEW_CHUNK_SIZE) {
    if (signal?.aborted) break
    const limit = Math.min(TIME_VIEW_CHUNK_SIZE, scanLimit - offset)
    const params = new URLSearchParams({
      from,
      to,
      offset: String(offset),
      limit: String(limit),
    })
    const response = await fetchWithTimeout(
      `/api/stats/failed-range?${params.toString()}`,
      STATS_REQUEST_TIMEOUT_MS,
      signal,
    )
    if (!response.ok) {
      const body = await response.text()
      return { jobs: [], configured: true, error: `Failed range fetch failed (${response.status}): ${body}` }
    }
    const res = await response.json()
    if (!res.configured) return { jobs: [], configured: false }
    if (res.error) return { jobs: [], configured: true, error: res.error }
    allJobs.push(...(res.jobs ?? []))
    onProgress?.(offset + limit, scanLimit)
    if (res.reachedRangeStart) break
    if (res.totalScanned != null && res.totalScanned - offset < limit) break
  }
  return { jobs: allJobs, configured: true }
}
