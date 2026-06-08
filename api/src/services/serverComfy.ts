/**
 * ComfyUI / AI Toolkit proxy operations for the servers routes.
 *
 * We don't expose the server URL to the browser directly (CORS hostile and
 * the server might be private), so the API forwards a handful of well-known
 * paths and shapes the response. Every call has a tight timeout — a dead
 * host must not hang the request thread.
 */
import { badRequest, notFound, HttpError } from '../lib/httpError.js'
import * as repo from '../repositories/servers.js'
import type { ComfyStatsResponse, ComfyLogsResponse } from '../models/servers.js'

const COMFY_PROXY_TIMEOUT_MS = 5_000
const LOG_LIMIT = 100

async function comfyFetch(baseUrl: string, path: string): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), COMFY_PROXY_TIMEOUT_MS)
  try {
    return await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, { signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function comfyPost(baseUrl: string, path: string, body: unknown): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), COMFY_PROXY_TIMEOUT_MS)
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

function trimLogPayload(data: unknown): unknown {
  if (typeof data === 'string') {
    // Plain-string log format: "YYYY-MM-DDTHH:MM:SS.ffffff - message\n..."
    const parts = data.split(/(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+ - )/)
    return parts.length > LOG_LIMIT ? parts.slice(-LOG_LIMIT).join('') : data
  }
  if (Array.isArray(data)) return data.slice(-LOG_LIMIT)
  if (data && typeof data === 'object') {
    const r = data as Record<string, unknown>
    if (Array.isArray(r['entries'])) return { ...r, entries: r['entries'].slice(-LOG_LIMIT) }
    if (Array.isArray(r['logs'])) return { ...r, logs: r['logs'].slice(-LOG_LIMIT) }
    if (Array.isArray(r['lines'])) return { ...r, lines: r['lines'].slice(-LOG_LIMIT) }
  }
  return data
}

async function requireWorkflowServer(id: string) {
  const row = await repo.findById(id)
  if (!row) throw notFound('Server not found')
  if (row.type !== 'workflow') throw badRequest('Not a workflow server')
  return row
}

async function requireLoraServer(id: string) {
  const row = await repo.findById(id)
  if (!row) throw notFound('Server not found')
  if (row.type !== 'lora') throw badRequest('Not a LoRA server')
  return row
}

/* ─── GET /servers/:id/comfy/stats ─────────────────────────── */
// Side-effect: caches the GPU name to server.gpu so the list card can show
// it without a live probe.
export async function getComfyStats(id: string): Promise<ComfyStatsResponse> {
  const row = await requireWorkflowServer(id)
  let res: Response
  try {
    res = await comfyFetch(row.url, '/system_stats')
  } catch (err) {
    throw new HttpError(
      502,
      'comfy_unreachable',
      err instanceof Error ? err.message : 'Probe failed',
    )
  }
  if (!res.ok) throw new HttpError(502, 'comfy_bad_response', `ComfyUI returned ${res.status}`)
  const body = (await res.json()) as ComfyStatsResponse
  const rawName = body.devices?.[0]?.name
  if (typeof rawName === 'string') {
    const gpu = rawName.replace(/^cuda:\d+\s+/, '').trim()
    if (gpu && gpu !== row.gpu) {
      repo
        .updateGpu(id, gpu)
        .catch((err) =>
          console.warn(
            '[servers] gpu cache update failed:',
            err instanceof Error ? err.message : err,
          ),
        )
    }
  }
  return body
}

/* ─── GET /servers/:id/comfy/logs ──────────────────────────── */
// Tries /internal/logs (recent versions), falls back to /history.
export async function getComfyLogs(id: string): Promise<ComfyLogsResponse> {
  const row = await requireWorkflowServer(id)
  try {
    const logsRes = await comfyFetch(row.url, `/internal/logs?max_lines=${LOG_LIMIT}`)
    if (logsRes.ok) {
      return { source: 'logs', limit: LOG_LIMIT, data: trimLogPayload(await logsRes.json()) }
    }
  } catch {
    /* fall through */
  }

  try {
    const histRes = await comfyFetch(row.url, `/history?max_items=${LOG_LIMIT}`)
    if (!histRes.ok)
      throw new HttpError(502, 'comfy_bad_response', `ComfyUI returned ${histRes.status}`)
    return { source: 'history', limit: LOG_LIMIT, data: await histRes.json() }
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(
      502,
      'comfy_unreachable',
      err instanceof Error ? err.message : 'Probe failed',
    )
  }
}

/* ─── GET /servers/:id/gpu (AI Toolkit equivalent) ─────────── */
export async function getGpuInfo(id: string): Promise<unknown> {
  const row = await requireLoraServer(id)
  let res: Response
  try {
    res = await comfyFetch(row.url, '/api/gpu')
  } catch (err) {
    throw new HttpError(
      502,
      'comfy_unreachable',
      err instanceof Error ? err.message : 'Probe failed',
    )
  }
  if (!res.ok) throw new HttpError(502, 'comfy_bad_response', `AI Toolkit returned ${res.status}`)
  const body = (await res.json()) as { name?: string }[] | { name?: string }
  const first = Array.isArray(body) ? body[0] : body
  const rawName = first?.name
  if (typeof rawName === 'string') {
    const gpu = rawName.trim()
    if (gpu && gpu !== row.gpu) {
      repo
        .updateGpu(id, gpu)
        .catch((err) =>
          console.warn(
            '[servers] gpu cache update failed:',
            err instanceof Error ? err.message : err,
          ),
        )
    }
  }
  return body
}

/* ─── ComfyUI control actions (POST) ───────────────────────── */

async function comfyAction(
  id: string,
  path: string,
  body: unknown,
  allow404 = false,
): Promise<void> {
  const row = await requireWorkflowServer(id)
  let res: Response
  try {
    res = await comfyPost(row.url, path, body)
  } catch (err) {
    throw new HttpError(
      502,
      'comfy_unreachable',
      err instanceof Error ? err.message : 'Action failed',
    )
  }
  if (!res.ok && !(allow404 && res.status === 404)) {
    throw new HttpError(502, 'comfy_bad_response', `ComfyUI returned ${res.status}`)
  }
}

export const restartComfy = (id: string) => comfyAction(id, '/restart', {}, /* allow404 */ true)
export const emptyVram = (id: string) =>
  comfyAction(id, '/free', { unload_models: true, free_memory: true })
export const clearCache = (id: string) =>
  comfyAction(id, '/free', { unload_models: false, free_memory: true })
