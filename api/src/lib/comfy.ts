/**
 * Shared HTTP helpers for talking to ComfyUI / AI-Toolkit servers — one
 * place for the URL join, timeout (COMFY_TIMEOUT_MS) and proxy routing
 * (internalFetch) instead of per-service copies.
 */
import { config } from '../config/index.js'
import { internalFetch } from './proxy.js'

const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`

export function comfyGet(baseUrl: string, path: string): Promise<Response> {
  return internalFetch(joinUrl(baseUrl, path), { timeoutMs: config.COMFY_TIMEOUT_MS })
}

export function comfyPost(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return internalFetch(joinUrl(baseUrl, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: config.COMFY_TIMEOUT_MS,
  })
}
