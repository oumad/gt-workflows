/**
 * Read-only client for the AI-Toolkit UI API (the trainer's web server,
 * typically :8675). Enriches LoRA jobs with live training data the Redis
 * mirror can't see: the training log and current step/status/speed.
 *
 * The bridge: our training_jobs.remote_job_name is the toolkit's `job_ref` —
 * GET /api/jobs?job_ref=… resolves it to the toolkit's own job row. The
 * resolved id is cached in memory (a ref maps to one job for its lifetime;
 * if the toolkit job is deleted and recreated, the stale id is detected and
 * re-resolved).
 *
 * All calls go through internalFetch (LAN routing policy) with the standard
 * COMFY_TIMEOUT_MS budget, and degrade with precise HttpErrors — an older
 * toolkit without these routes or a purged job reads as a clear message in
 * the UI, never a hang. NOTE: if a toolkit box sets AI_TOOLKIT_AUTH, all its
 * /api/* routes demand a bearer token and these calls would 401 — same as
 * the health probes; per-server tokens are a future credentials feature.
 */
import { internalFetch } from '../lib/proxy.js'
import { config } from '../config/index.js'
import { HttpError } from '../lib/httpError.js'

const LOG_TAIL_LINES = 300

/** The slice of the toolkit's Job row we surface (prisma model `Job`). */
export type AitJobProgress = {
  aitJobId: string
  name: string | null
  status: string | null
  step: number | null
  info: string | null
  speedString: string | null
  queuePosition: number | null
  updatedAt: string | null
}

export type TrainingLog = {
  progress: AitJobProgress
  log: string
  /** True when the log was tailed to the last LOG_TAIL_LINES lines. */
  truncated: boolean
}

// `${base}|${ref}` → toolkit job id. Set-once per training run.
const refCache = new Map<string, string>()

const trimBase = (u: string) => u.replace(/\/+$/, '')

async function aitGet(base: string, path: string): Promise<Response> {
  try {
    return await internalFetch(`${trimBase(base)}${path}`, {
      timeoutMs: config.COMFY_TIMEOUT_MS,
    })
  } catch (err) {
    throw new HttpError(
      502,
      'ait_unreachable',
      `AI-Toolkit at ${trimBase(base)} is unreachable: ${
        err instanceof Error ? err.message : 'fetch failed'
      }`,
    )
  }
}

function pickProgress(job: Record<string, unknown>, id: string): AitJobProgress {
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    aitJobId: id,
    name: s(job['name']),
    status: s(job['status']),
    step: n(job['step']),
    info: s(job['info']),
    speedString: s(job['speed_string']),
    queuePosition: n(job['queue_position']),
    updatedAt: s(job['updated_at']),
  }
}

async function fetchJob(base: string, query: string): Promise<Record<string, unknown> | null> {
  const res = await aitGet(base, `/api/jobs?${query}`)
  if (!res.ok) {
    // 404 → the toolkit answered but has no such route/job; anything else is
    // an upstream failure. Old toolkit builds without ?job_ref land here too.
    throw new HttpError(
      502,
      'ait_bad_response',
      `AI-Toolkit returned ${res.status} for the job lookup — the box may run ` +
        'an older AI-Toolkit without this API.',
    )
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return body && typeof body['id'] === 'string' ? body : null
}

/** Resolve remote_job_name → the toolkit's job row (cached id fast-path). */
async function resolveJob(
  base: string,
  ref: string,
): Promise<{ id: string; job: Record<string, unknown> }> {
  const cacheKey = `${trimBase(base)}|${ref}`

  const cachedId = refCache.get(cacheKey)
  if (cachedId) {
    // A cached id goes stale when the toolkit job is deleted/recreated. The
    // by-id lookup may then return null (200, no row) OR throw (404/502) — in
    // either case the cache is stale, so swallow it and re-resolve by ref
    // below rather than surfacing a hard error to the caller.
    const job = await fetchJob(base, `id=${encodeURIComponent(cachedId)}`).catch(() => null)
    if (job) return { id: cachedId, job }
    refCache.delete(cacheKey)
  }

  const job = await fetchJob(base, `job_ref=${encodeURIComponent(ref)}`)
  if (!job) {
    throw new HttpError(
      404,
      'ait_job_not_found',
      `No AI-Toolkit job matches ref "${ref}" — it may have been deleted on the trainer.`,
    )
  }
  const id = job['id'] as string
  refCache.set(cacheKey, id)
  return { id, job }
}

export async function getTrainingProgress(base: string, ref: string): Promise<AitJobProgress> {
  const { id, job } = await resolveJob(base, ref)
  return pickProgress(job, id)
}

export async function getTrainingLog(base: string, ref: string): Promise<TrainingLog> {
  const { id, job } = await resolveJob(base, ref)
  const res = await aitGet(base, `/api/jobs/${encodeURIComponent(id)}/log`)
  if (!res.ok) {
    throw new HttpError(502, 'ait_bad_response', `AI-Toolkit /log returned ${res.status}`)
  }
  const body = (await res.json().catch(() => null)) as { log?: unknown } | null
  const full = typeof body?.log === 'string' ? body.log : ''
  const lines = full.split('\n')
  const truncated = lines.length > LOG_TAIL_LINES
  return {
    progress: pickProgress(job, id),
    log: truncated ? lines.slice(-LOG_TAIL_LINES).join('\n') : full,
    truncated,
  }
}
