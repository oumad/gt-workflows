import Redis from 'ioredis'
import { config } from '../config/index.js'
import type { BullJob } from '../types.js'
import { detectAndRecordComfyStart, getComfyStartedAt } from './liveTracker.js'
import {
  parseJobData,
  str,
  extractWfServerUrl,
  extractWfName,
  extractUserName,
  extractUserExternalId,
  extractLoraServerUrl,
} from './jobDataUtils.js'

// ─────────────────────────────────────────────
// Redis service — READ-ONLY access to production BullMQ
// ─────────────────────────────────────────────
// This stack never writes to Redis.  The queue is owned by gt-workflows.
// We connect only to read live job state and logs for the detail view.
// ─────────────────────────────────────────────

const KEY = `${config.REDIS_BULLMQ_PREFIX}:${config.REDIS_BULLMQ_QUEUE}`
const LORA_KEY = `${config.REDIS_BULLMQ_PREFIX}:${config.REDIS_LORA_QUEUE}`

let _client: Redis | null = null

function getClient(): Redis {
  if (!_client) {
    _client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: false, // fail fast — don't queue commands when disconnected
      readOnly: true, // enforce read-only mode at the client level
    })
    _client.on('error', (err) => {
      console.error('[redis]', err.message)
    })
  }
  return _client
}

// ── Hash key helpers ──────────────────────────

function jobKey(id: string) {
  return `${KEY}:${id}`
}
function logsKey(id: string) {
  return `${KEY}:${id}:logs`
}
function loraJobKey(id: string) {
  return `${LORA_KEY}:${id}`
}

// ── Public API ────────────────────────────────

/**
 * Fetch the full BullMQ hash for a single job.
 * Returns null if the job doesn't exist in Redis (may have been evicted).
 */
export async function getRedisJob(id: string): Promise<BullJob | null> {
  try {
    const r = getClient()
    const hash = await r.hgetall(jobKey(id))
    if (!hash || Object.keys(hash).length === 0) return null
    return deserializeJob(id, hash)
  } catch {
    return null
  }
}

/**
 * Fetch log lines for a job from the :logs list.
 * Returns an empty array if logs don't exist.
 */
export async function getRedisJobLogs(id: string, start = 0, end = -1): Promise<string[]> {
  try {
    const r = getClient()
    return await r.lrange(logsKey(id), start, end)
  } catch {
    return []
  }
}

/**
 * Resolve the live status of a job by checking the BullMQ sorted sets.
 * Returns 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown'
 */
export async function getRedisJobStatus(id: string): Promise<string> {
  try {
    const r = getClient()
    const sets: [string, string][] = [
      [`${KEY}:active`, 'active'],
      [`${KEY}:wait`, 'waiting'],
      [`${KEY}:delayed`, 'delayed'],
      [`${KEY}:failed`, 'failed'],
      [`${KEY}:completed`, 'completed'],
    ]
    const checks = await Promise.all(sets.map(([key]) => r.zscore(key, id)))
    const idx = checks.findIndex((s) => s !== null)
    return idx >= 0 ? (sets[idx]![1] ?? 'unknown') : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Get queue depth (waiting + active) directly from Redis.
 * Used as fallback when the ComfyUI /queue endpoint is unreachable.
 */
export async function getQueueDepth(): Promise<{ waiting: number; active: number }> {
  try {
    const r = getClient()
    const [waiting, active] = await Promise.all([r.llen(`${KEY}:wait`), r.llen(`${KEY}:active`)])
    return { waiting, active }
  } catch {
    return { waiting: 0, active: 0 }
  }
}

// ── Live batch reader ─────────────────────────

/** Minimal WF job shape returned by getLiveWfJobs — built from Redis only */
export interface LiveWfJob {
  id: string
  name: string
  serverUrl: string
  userName: string
  userExternalId: string // MongoDB ObjectId — '' when absent
  createdAt: number // epoch ms
  processedOn: number | null // epoch ms
  comfyStartedAt: number | null // epoch ms — from in-memory liveTracker
  priority: number
  attempts: number
}

/**
 * For a batch of BullMQ wf job ids, read each job's log stream and detect the
 * ComfyUI "running" marker. Updates the in-memory liveTracker map for any id
 * not yet recorded. Ids that already have a recorded comfyStartedAt are
 * skipped so we never pay the log-read cost twice.
 *
 * Called from two places now:
 *   1. The live-feed endpoint (the original site), so opening the Live tab
 *      gives instant exec_at on rendering jobs.
 *   2. The sync loop, which runs unconditionally. This means jobs whose
 *      ComfyUI execution begins while no user is on the Live tab still get
 *      their comfyStartedAt captured — fixing the original gap where exec_at
 *      was effectively gated on UI activity.
 *
 * Safe to call with an empty array (no-op) and across overlapping batches
 * (the liveTracker map dedups).
 *
 * Exported so the sync service can call it without duplicating the Redis-key
 * construction (`logsKey`) which stays private to this module.
 */
export async function detectComfyStartsForJobs(
  client: Redis,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const needsLogs = ids.filter((id) => getComfyStartedAt(id) === null)
  if (needsLogs.length === 0) return
  const pipe = client.pipeline()
  needsLogs.forEach((id) => pipe.lrange(logsKey(id), 0, -1))
  const results = await pipe.exec()
  needsLogs.forEach((id, i) => {
    const res = results?.[i]
    if (res && !res[0]) detectAndRecordComfyStart(id, res[1] as string[])
  })
}

/**
 * Read the live WF queue from Redis in ~3 round-trips regardless of job count.
 *
 * 1. LRANGE active + LRANGE wait  (2 commands, 1 round-trip)
 * 2. Pipeline HGETALL for all IDs (1 round-trip)
 * 3. Pipeline LRANGE :logs for active jobs not yet in liveTracker (1 round-trip, often skipped)
 *
 * Returns { active, waiting } arrays of LiveWfJob.
 */
export async function getLiveWfJobs(): Promise<{ active: LiveWfJob[]; waiting: LiveWfJob[] }> {
  try {
    const r = getClient()

    // 1. Read both lists in parallel
    const [activeIds, waitIds] = await Promise.all([
      r.lrange(`${KEY}:active`, 0, -1),
      r.lrange(`${KEY}:wait`, 0, -1),
    ])

    const allIds = [...new Set([...activeIds, ...waitIds])]
    if (allIds.length === 0) return { active: [], waiting: [] }

    // 2. Batch hgetall — one pipeline for all IDs
    const hashPipe = r.pipeline()
    allIds.forEach((id) => hashPipe.hgetall(jobKey(id)))
    const hashResults = await hashPipe.exec()

    const hashById = new Map<string, Record<string, string>>()
    allIds.forEach((id, i) => {
      const res = hashResults?.[i]
      if (!res || res[0]) return
      const h = res[1] as Record<string, string>
      if (h && Object.keys(h).length > 0) hashById.set(id, h)
    })

    // 3. For active jobs not yet in liveTracker, batch-read logs to detect comfy start.
    //    The same helper is called by the sync loop so detection happens even
    //    when nobody has the Live tab open.
    const activeSet = new Set(activeIds)
    await detectComfyStartsForJobs(r, activeIds)

    // 4. Build result arrays
    const active: LiveWfJob[] = []
    const waiting: LiveWfJob[] = []

    for (const id of activeIds) {
      const h = hashById.get(id)
      if (!h) continue
      const data = parseJobData(h)
      active.push({
        id,
        name: h['name'] || extractWfName(data) || 'Unknown',
        serverUrl: extractWfServerUrl(data),
        userName: extractUserName(data),
        userExternalId: extractUserExternalId(data),
        createdAt: Number(h['timestamp'] ?? 0),
        processedOn: h['processedOn'] ? Number(h['processedOn']) : null,
        comfyStartedAt: getComfyStartedAt(id),
        priority: Number(h['priority'] ?? 0),
        attempts: Number(h['attempts'] ?? 0),
      })
    }

    for (const id of waitIds) {
      if (activeSet.has(id)) continue // deduplicate IDs that appear in both lists
      const h = hashById.get(id)
      if (!h) continue
      const data = parseJobData(h)
      waiting.push({
        id,
        name: h['name'] || extractWfName(data) || 'Unknown',
        serverUrl: extractWfServerUrl(data),
        userName: extractUserName(data),
        userExternalId: extractUserExternalId(data),
        createdAt: Number(h['timestamp'] ?? 0),
        processedOn: null,
        comfyStartedAt: null,
        priority: Number(h['priority'] ?? 0),
        attempts: Number(h['attempts'] ?? 0),
      })
    }

    return { active, waiting }
  } catch (e) {
    console.error('[redis:live]', e instanceof Error ? e.message : e)
    return { active: [], waiting: [] }
  }
}

/** Minimal LoRA job shape returned by getLiveLoraJobs — built from Redis only */
export interface LiveLoraJob {
  id: string
  name: string // lora output name
  baseModel: string | null
  serverUrl: string | null
  userName: string
  userExternalId: string // MongoDB ObjectId — '' when absent
  createdAt: number // epoch ms
  processedOn: number | null // epoch ms (when training worker picked it up)
  priority: number
  attempts: number
}

/**
 * Read the live LoRA queue from Redis in ~2 round-trips regardless of job count.
 * Mirrors the same pattern as getLiveWfJobs.
 * Returns { active, waiting } arrays of LiveLoraJob.
 */
export async function getLiveLoraJobs(): Promise<{
  active: LiveLoraJob[]
  waiting: LiveLoraJob[]
}> {
  try {
    const r = getClient()

    const [activeIds, waitIds] = await Promise.all([
      r.lrange(`${LORA_KEY}:active`, 0, -1),
      r.lrange(`${LORA_KEY}:wait`, 0, -1),
    ])

    const allIds = [...new Set([...activeIds, ...waitIds])]
    if (allIds.length === 0) return { active: [], waiting: [] }

    const hashPipe = r.pipeline()
    allIds.forEach((id) => hashPipe.hgetall(loraJobKey(id)))
    const hashResults = await hashPipe.exec()

    const hashById = new Map<string, Record<string, string>>()
    allIds.forEach((id, i) => {
      const res = hashResults?.[i]
      if (!res || res[0]) return
      const h = res[1] as Record<string, string>
      if (h && Object.keys(h).length > 0) hashById.set(id, h)
    })

    const activeSet = new Set(activeIds)
    const active: LiveLoraJob[] = []
    const waiting: LiveLoraJob[] = []

    for (const id of activeIds) {
      const h = hashById.get(id)
      if (!h) continue
      const data = parseJobData(h)
      active.push({
        id,
        name: str(data, 'name', 'outputName') || h['name'] || `lora-${id}`,
        baseModel: str(data, 'modelArch', 'baseModel') || null,
        serverUrl: extractLoraServerUrl(data) || null,
        userName: extractUserName(data),
        userExternalId: extractUserExternalId(data),
        createdAt: Number(h['timestamp'] ?? 0),
        processedOn: h['processedOn'] ? Number(h['processedOn']) : null,
        priority: Number(h['priority'] ?? 0),
        attempts: Number(h['attempts'] ?? 0),
      })
    }

    for (const id of waitIds) {
      if (activeSet.has(id)) continue
      const h = hashById.get(id)
      if (!h) continue
      const data = parseJobData(h)
      waiting.push({
        id,
        name: str(data, 'name', 'outputName') || h['name'] || `lora-${id}`,
        baseModel: str(data, 'modelArch', 'baseModel') || null,
        serverUrl: extractLoraServerUrl(data) || null,
        userName: extractUserName(data),
        userExternalId: extractUserExternalId(data),
        createdAt: Number(h['timestamp'] ?? 0),
        processedOn: null,
        priority: Number(h['priority'] ?? 0),
        attempts: Number(h['attempts'] ?? 0),
      })
    }

    return { active, waiting }
  } catch (e) {
    console.error('[redis:lora-live]', e instanceof Error ? e.message : e)
    return { active: [], waiting: [] }
  }
}

// ── Internal ──────────────────────────────────

function deserializeJob(id: string, h: Record<string, string>): BullJob {
  return {
    id,
    name: h['name'] ?? '',
    timestamp: Number(h['timestamp'] ?? 0),
    processedOn: h['processedOn'] ? Number(h['processedOn']) : null,
    finishedOn: h['finishedOn'] ? Number(h['finishedOn']) : null,
    failedReason: h['failedReason'] ?? null,
    stacktrace: h['stacktrace'] ? tryParseJson<string[]>(h['stacktrace'], []) : [],
    attempts: Number(h['attempts'] ?? 0),
    priority: Number(h['priority'] ?? 0),
    returnvalue: h['returnvalue'] ? tryParseJson(h['returnvalue'], null) : null,
    opts: h['opts'] ? tryParseJson<Record<string, unknown>>(h['opts'], {}) : {},
    data: h['data'] ? tryParseJson<Record<string, unknown>>(h['data'], {}) : {},
  }
}

function tryParseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
