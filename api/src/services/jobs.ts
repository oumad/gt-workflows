/**
 * Business logic for the unified jobs view.
 *
 * Composes the repository's SQL helpers + Redis live readers + Discord webhook
 * into the wire-format responses. In-memory caches (stats, live) live here
 * because they're a cross-cutting concern, not a DB property. The route file
 * stays a thin HTTP adapter.
 */
import { getLiveWfJobs, getLiveLoraJobs } from './redis.js'
import { sendJobReport } from '../lib/discord.js'
import { notFound } from '../lib/httpError.js'
import { serverMatchKey } from '../lib/serverUrl.js'
import { TtlCache } from '../lib/ttlCache.js'
import * as repo from '../repositories/jobs.js'
import type {
  UnifiedJob,
  UnifiedLiveJob,
  JobsListResponse,
  JobsStatsResponse,
  JobsLivePayload,
} from '../models/jobs.js'
import type { ListJobsQuery, JobReportInput } from '../validators/jobs.js'
import { JOBS_DEFAULT_LIMIT } from '../validators/jobs.js'

/** Convert the "days" string param to a clamped integer. */
function parseDays(raw: string | undefined): number {
  if (raw === 'all' || raw === '0' || raw === '') return 0
  const n = parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return 0
  return Math.min(n, 90)
}

function isoString(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return new Date(v).toISOString()
  return String(v)
}

function rowToUnified(r: Record<string, unknown>): UnifiedJob {
  return {
    type: r['type'] as 'wf' | 'lora',
    id: r['id'] as string,
    name: (r['name'] as string | null) ?? null,
    arch: (r['arch'] as string | null) ?? null,
    serverId: (r['server_id'] as string | null) ?? null,
    serverUrl: (r['server_url'] as string | null) ?? null,
    clientId: (r['client_id'] as string | null) ?? null,
    userName: (r['user_name'] as string | null) ?? null,
    status: r['status'] as string,
    durationMs: r['duration_ms'] != null ? Number(r['duration_ms']) : null,
    failedReason: (r['failed_reason'] as string | null) ?? null,
    createdAt: isoString(r['created_at']),
    startedAt: r['started_at'] ? isoString(r['started_at']) : null,
    finishedAt: r['finished_at'] ? isoString(r['finished_at']) : null,
    workflowId: (r['workflow_id'] as string | null) ?? null,
    comfyStartedAt: r['comfy_started_at'] ? isoString(r['comfy_started_at']) : null,
    waitMs: r['wait_ms'] != null ? Number(r['wait_ms']) : null,
    comfyQueueMs: r['comfy_queue_ms'] != null ? Number(r['comfy_queue_ms']) : null,
    comfyRunMs: r['comfy_run_ms'] != null ? Number(r['comfy_run_ms']) : null,
  }
}

function toFilters(q: ListJobsQuery): repo.JobFilters {
  // workflowId / workflowName only exist on WF rows — narrow the type accordingly.
  const type = q.workflowId || q.workflowName ? 'wf' : (q.type ?? 'all')
  return {
    type,
    status: q.status,
    userId: q.userId,
    serverId: q.serverId,
    workflowId: q.workflowId,
    workflowName: q.workflowName,
    q: q.q,
    days: parseDays(q.days),
    excludeAborted: !!q.excludeAborted,
  }
}

export async function list(q: ListJobsQuery): Promise<JobsListResponse> {
  const page = q.page ?? 1
  const limit = q.limit ?? JOBS_DEFAULT_LIMIT
  const filters = toFilters(q)

  const { rows, totalFromWindow } = await repo.listJobsPage(filters, page, limit)
  let total = totalFromWindow
  // Past-end-of-results page: data query returned no rows so __total is also
  // absent. Fall back to a dedicated count so the UI can recover.
  if (rows.length === 0 && page > 1) {
    total = await repo.countJobs(filters)
  }
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return {
    items: rows.map(rowToUnified),
    page,
    totalPages,
    total,
  }
}

// ── stats (60s in-memory cache) ───────────────────
const statsCache = new TtlCache(60_000)

export function stats(): Promise<JobsStatsResponse> {
  return statsCache.memo('stats', async () => {
    const { wfByStatus, loraByStatus } = await repo.statsByStatus()
    const sumVals = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0)
    return {
      wf: {
        total: sumVals(wfByStatus),
        active: wfByStatus['active'] ?? 0,
        waiting: wfByStatus['waiting'] ?? 0,
        completed: wfByStatus['completed'] ?? 0,
        failed: wfByStatus['failed'] ?? 0,
      },
      lora: {
        total: sumVals(loraByStatus),
        running: loraByStatus['running'] ?? 0,
        pending: loraByStatus['pending'] ?? 0,
        completed: loraByStatus['completed'] ?? 0,
        failed: loraByStatus['failed'] ?? 0,
      },
      running: (wfByStatus['active'] ?? 0) + (loraByStatus['running'] ?? 0),
      waiting: (wfByStatus['waiting'] ?? 0) + (loraByStatus['pending'] ?? 0),
    }
  })
}

// ── live feed (3s in-memory cache) ────────────────
const liveCache = new TtlCache(3_000)

export function live(): Promise<JobsLivePayload> {
  return liveCache.memo('live', async () => {
    const [wf, lora, maps] = await Promise.all([
      getLiveWfJobs(),
      getLiveLoraJobs(),
      repo.loadServerAndUserMaps(),
    ])

    const serverByKey = new Map(maps.serverRows.map((s) => [serverMatchKey(s.url), s.id]))
    const userByExt = new Map(maps.userRows.map((u) => [u.externalId, u.id]))
    const resolveServerId = (url: string | null) =>
      url ? (serverByKey.get(serverMatchKey(url)) ?? null) : null
    const resolveClientId = (ext: string) => (ext ? (userByExt.get(ext) ?? null) : null)

    const toWf = (j: (typeof wf.active)[number]): UnifiedLiveJob => ({
      type: 'wf',
      id: j.id,
      name: j.name,
      arch: null,
      serverUrl: j.serverUrl,
      serverId: resolveServerId(j.serverUrl),
      clientId: resolveClientId(j.userExternalId),
      userName: j.userName,
      createdAt: j.createdAt,
      processedOn: j.processedOn,
      comfyStartedAt: j.comfyStartedAt,
      priority: j.priority,
      attempts: j.attempts,
    })
    const toLora = (j: (typeof lora.active)[number]): UnifiedLiveJob => ({
      type: 'lora',
      id: j.id,
      name: j.name,
      arch: j.baseModel,
      serverUrl: j.serverUrl,
      serverId: resolveServerId(j.serverUrl),
      clientId: resolveClientId(j.userExternalId),
      userName: j.userName,
      createdAt: j.createdAt,
      processedOn: j.processedOn,
      comfyStartedAt: null,
      priority: j.priority,
      attempts: j.attempts,
    })
    const data: JobsLivePayload = {
      running: [...wf.active.map(toWf), ...lora.active.map(toLora)],
      waiting: [...wf.waiting.map(toWf), ...lora.waiting.map(toLora)],
      ts: Date.now(),
    }
    return data
  })
}

export async function report(
  id: string,
  input: JobReportInput,
  reporterUsername: string,
): Promise<void> {
  const found = await repo.findJobAnywhere(id)
  if (!found) throw notFound('Job not found')

  const jobName = found.type === 'wf' ? found.row.workflowName : found.row.baseModel
  const status = found.row.status
  // Prefer the server label sent by the client (already-resolved name), fall
  // back to the URL stored on the job row.
  const srvLabel = input.server ?? found.row.serverUrl ?? null

  try {
    await sendJobReport({
      jobId: id,
      jobType: found.type,
      jobName: jobName ?? null,
      status,
      server: srvLabel,
      reporter: reporterUsername,
      message: input.message,
      findings: input.findings,
    })
  } catch (err) {
    console.warn('[discord] job-report webhook failed:', err instanceof Error ? err.message : err)
  }
}
