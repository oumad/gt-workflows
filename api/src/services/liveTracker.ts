/**
 * liveTracker.ts
 *
 * In-memory detection of when ComfyUI actually starts executing a WF job.
 *
 * BullMQ picks up a job almost instantly (processedOn ≈ timestamp + 4 ms),
 * but ComfyUI has its own internal queue. The exact moment ComfyUI begins
 * execution is signalled by a specific log line. We detect that line during
 * live polling and record Date.now() — giving an accurate "queue wait" time
 * (job creation → ComfyUI actually started running it).
 *
 * The map is lost on API restart (acceptable — completed values are written
 * to Postgres by the sync service before the entry is removed from memory).
 */

/** The BullMQ log line that signals ComfyUI has started executing a WF */
const COMFY_RUNNING_MARKER = 'Workflow is running on comfyui'

/** jobId → epoch ms when ComfyUI started executing */
const comfyStartMap = new Map<string, number>()

/**
 * Inspect a job's log lines. If the ComfyUI "running" marker is present
 * and we haven't recorded a start time for this job yet, record Date.now().
 *
 * Safe to call repeatedly — no-op if already tracked.
 */
export function detectAndRecordComfyStart(id: string, logs: string[]): void {
  if (comfyStartMap.has(id)) return
  const found = logs.some((l) => l.includes(COMFY_RUNNING_MARKER))
  if (found) comfyStartMap.set(id, Date.now())
}

/** Return the recorded comfyStartedAt epoch ms, or null if not yet detected. */
export function getComfyStartedAt(id: string): number | null {
  return comfyStartMap.get(id) ?? null
}

/**
 * Return and delete the tracked comfyStartedAt for a job.
 * Called by the sync service when a job completes — the value is persisted
 * to Postgres (`comfy_started_at` column) and then removed from memory.
 */
export function consumeComfyStartedAt(id: string): number | null {
  const val = comfyStartMap.get(id)
  if (val !== undefined) {
    comfyStartMap.delete(id)
    return val
  }
  return null
}

