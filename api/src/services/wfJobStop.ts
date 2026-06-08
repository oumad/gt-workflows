/**
 * Manual stop for an in-flight ComfyUI workflow job.
 *
 * The catch: our job IDs (BullMQ / Postgres) don't match ComfyUI's internal
 * prompt id, and the queue is owned by gt-workflows so we can't ask Redis
 * directly. The only durable handle is in the per-job service log, which
 * carries a line like:
 *
 *   "workflow initialized with id 62ddc2c6-b443-4310-aec7-d08267af7a14"
 *
 * The flow:
 *   1. Look up the job (Postgres) — refuse if it's already in a terminal state.
 *   2. Read its service log (Redis, owned by gt-workflows — read-only) and
 *      scrape the prompt id off the "workflow initialized with id …" line.
 *   3. Ask the ComfyUI server's GET /queue what state the prompt is in so we
 *      target the right cancellation primitive:
 *        - currently running → POST /interrupt
 *        - still pending in the queue → POST /queue { delete: [<id>] }
 *      We never blind-fire /interrupt — that affects whatever is running on
 *      the server right now, which could be a different user's job.
 *   4. Poll GET /history/<id> for up to STOP_CONFIRM_TIMEOUT_MS to verify
 *      ComfyUI no longer considers the prompt active.
 *   5. Append a row to workflow_jobs.cm_audit_log: who did it, when, what
 *      happened. This is our postgres-side log; gt-workflows' Redis logs
 *      stay untouched.
 *
 * Throws an HttpError with a precise reason at every failure mode so the
 * frontend can surface a useful message instead of "Stop failed".
 */
import { eq, sql } from 'drizzle-orm'
import { db, workflowJobs } from '../db/index.js'
import { getRedisJobLogs } from './redis.js'
import { badRequest, notFound, HttpError } from '../lib/httpError.js'

const COMFY_TIMEOUT_MS = 5_000
const STOP_CONFIRM_TIMEOUT_MS = 5_000
const STOP_CONFIRM_INTERVAL_MS = 500
// Don't fetch the whole log list if it's huge — the line we care about is
// emitted early in the job's lifetime so the most recent N is enough.
const LOG_SCAN_LIMIT = 200

const PROMPT_ID_PATTERN =
  /workflow\s+initialized\s+with\s+id\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export type StopResult = {
  ok: true
  comfyPromptId: string
  /** Where ComfyUI reported it was when we started: 'running' | 'pending' |
   *  'unknown' (not in queue when checked). */
  state: 'running' | 'pending' | 'unknown'
  /** Did /history/<id> confirm it's done within the timeout? */
  confirmedDone: boolean
}

type AuditEntry = {
  at: string
  who: string
  action: string
  message: string
  extra?: Record<string, unknown>
}

async function comfyFetch(baseUrl: string, path: string): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), COMFY_TIMEOUT_MS)
  try {
    return await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, { signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function comfyPost(baseUrl: string, path: string, body: unknown): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), COMFY_TIMEOUT_MS)
  try {
    return await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Scrape ComfyUI's prompt id off the service log. Returns null if the
 *  signature line isn't there (job not started in comfy yet, or evicted). */
export function extractComfyPromptId(logs: string[]): string | null {
  for (const line of logs) {
    const m = line.match(PROMPT_ID_PATTERN)
    if (m && m[1]) return m[1]
  }
  return null
}

/** Snapshot of ComfyUI queue, narrowed to the bits we need. ComfyUI returns
 *  arrays of `[seq, prompt_id, prompt, extra, outputs_to_execute]`; we only
 *  care about index [1]. */
type ComfyQueueState = {
  queue_running?: unknown[]
  queue_pending?: unknown[]
}

function promptStateFromQueue(
  queue: ComfyQueueState,
  promptId: string,
): 'running' | 'pending' | 'unknown' {
  const matches = (entry: unknown): boolean => Array.isArray(entry) && entry[1] === promptId
  if ((queue.queue_running ?? []).some(matches)) return 'running'
  if ((queue.queue_pending ?? []).some(matches)) return 'pending'
  return 'unknown'
}

async function isInHistory(serverUrl: string, promptId: string): Promise<boolean> {
  let res: Response
  try {
    res = await comfyFetch(serverUrl, `/history/${encodeURIComponent(promptId)}`)
  } catch {
    return false
  }
  if (!res.ok) return false
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return !!body && Object.prototype.hasOwnProperty.call(body, promptId)
}

async function appendAudit(jobId: string, entry: AuditEntry): Promise<void> {
  // jsonb || jsonb concatenates arrays — atomic on the row, no read-modify-
  // write race even if two coffee-maker tabs hit Stop in parallel.
  await db
    .update(workflowJobs)
    .set({
      cmAuditLog: sql`COALESCE(${workflowJobs.cmAuditLog}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`,
    })
    .where(eq(workflowJobs.id, jobId))
}

export async function stopWfJob(jobId: string, username: string): Promise<StopResult> {
  const job = await db.query.workflowJobs.findFirst({
    where: (j, { eq: e }) => e(j.id, jobId),
  })
  if (!job) throw notFound('Workflow job not found')
  if (TERMINAL_STATUSES.has(job.status)) {
    throw badRequest(`Job is already ${job.status} — nothing to stop.`)
  }
  if (!job.serverUrl) {
    throw badRequest('Job has no server URL — cannot reach ComfyUI.')
  }

  // 1. Scrape prompt id from Redis logs.
  const logs = await getRedisJobLogs(jobId, -LOG_SCAN_LIMIT, -1)
  const promptId = extractComfyPromptId(logs)
  if (!promptId) {
    throw badRequest(
      'ComfyUI prompt id not found in service logs — the workflow likely has not started yet. Retry once it begins running.',
    )
  }

  // 2. Inspect the queue to choose the right cancellation primitive.
  let state: 'running' | 'pending' | 'unknown' = 'unknown'
  try {
    const queueRes = await comfyFetch(job.serverUrl, '/queue')
    if (queueRes.ok) {
      const queueBody = (await queueRes.json().catch(() => ({}))) as ComfyQueueState
      state = promptStateFromQueue(queueBody, promptId)
    }
  } catch (err) {
    throw new HttpError(
      502,
      'comfy_unreachable',
      `Could not reach ComfyUI at ${job.serverUrl}: ${err instanceof Error ? err.message : err}`,
    )
  }

  // If the prompt isn't in either queue, it may already be done — check
  // /history before refusing. A successful history hit means we missed a
  // very recent completion; surfacing that as "already done" reads better
  // than "not found".
  if (state === 'unknown') {
    if (await isInHistory(job.serverUrl, promptId)) {
      throw badRequest(
        'Prompt is already complete on ComfyUI (in /history). Postgres status may not have caught up yet.',
      )
    }
    // Genuinely not on this server. Most likely the job moved (rare) or the
    // prompt id we scraped is stale. Surface a precise error rather than
    // /interrupt-ing something else.
    throw badRequest(
      `ComfyUI does not have prompt ${promptId} in its queue. Refuse to fire /interrupt — would affect a different job.`,
    )
  }

  // 3. Target the right cancel API.
  if (state === 'pending') {
    const res = await comfyPost(job.serverUrl, '/queue', { delete: [promptId] }).catch(() => null)
    if (!res || !res.ok) {
      throw new HttpError(
        502,
        'comfy_bad_response',
        `ComfyUI rejected /queue delete: ${res?.status ?? 'no response'}`,
      )
    }
  } else {
    // state === 'running'. /interrupt is safe now because we verified our
    // prompt is the currently-running one on this server.
    const res = await comfyPost(job.serverUrl, '/interrupt', {}).catch(() => null)
    if (!res || !res.ok) {
      throw new HttpError(
        502,
        'comfy_bad_response',
        `ComfyUI rejected /interrupt: ${res?.status ?? 'no response'}`,
      )
    }
  }

  // 4. Wait for ComfyUI to confirm the prompt is done. /history is the
  // authoritative source; the BullMQ worker will catch up on its own poll.
  const deadline = Date.now() + STOP_CONFIRM_TIMEOUT_MS
  let confirmedDone = false
  while (Date.now() < deadline) {
    if (await isInHistory(job.serverUrl, promptId)) {
      confirmedDone = true
      break
    }
    await new Promise((r) => setTimeout(r, STOP_CONFIRM_INTERVAL_MS))
  }

  // 5. Audit log. Append regardless of whether we got confirmation within
  // the timeout — the cancel was sent, the user took the action; an
  // "unconfirmed" flag preserves the truth for forensics.
  await appendAudit(jobId, {
    at: new Date().toISOString(),
    who: username,
    action: 'manual_stop',
    message: `[CM] User ${username} shot down the job manually`,
    extra: { comfyPromptId: promptId, state, confirmedDone },
  })

  return { ok: true, comfyPromptId: promptId, state, confirmedDone }
}
