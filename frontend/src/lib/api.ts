import { loadSession } from './storage'

// In dev, Vite proxies /api → http://localhost:3001 so no CORS issues.
// Set VITE_API_URL to override (e.g. in production builds).
const BASE = import.meta.env.VITE_API_URL ?? ''

function errorMessage(data: unknown, status: number): string {
  const err = (data as { error?: unknown })?.error
  if (typeof err === 'string') return err
  if (Array.isArray(err)) {
    const first = err[0] as { message?: unknown; path?: unknown[] } | undefined
    if (typeof first?.message === 'string') {
      const path =
        Array.isArray(first.path) && first.path.length > 0 ? `${first.path.join('.')}: ` : ''
      return `${path}${first.message}`
    }
  }
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return `HTTP ${status}`
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown; body?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const { json, body, headers: extraHeaders, signal, ...rest } = init
  const session = loadSession()

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...extraHeaders,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : body !== undefined ? { body } : {}),
  })

  if (res.status === 204) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return undefined as T
  }

  const data: unknown = await res.json()
  if (!res.ok) {
    throw new Error(errorMessage(data, res.status))
  }
  return data as T
}

/** Error thrown when a request is aborted via AbortController.signal.
 *  Callers can test `e.name === 'AbortError'` to skip showing it as a user error. */
export type AbortableInit = { signal?: AbortSignal }

export const api = {
  get: <T>(path: string, opts: AbortableInit = {}) => request<T>(path, opts),
  post: <T>(path: string, json: unknown, opts: AbortableInit = {}) =>
    request<T>(path, { method: 'POST', json, signal: opts.signal }),
  patch: <T>(path: string, json: unknown, opts: AbortableInit = {}) =>
    request<T>(path, { method: 'PATCH', json, signal: opts.signal }),
  put: <T>(path: string, json: unknown, opts: AbortableInit = {}) =>
    request<T>(path, { method: 'PUT', json, signal: opts.signal }),
  del: <T>(path: string, opts: AbortableInit = {}) =>
    request<T>(path, { method: 'DELETE', signal: opts.signal }),
}

/** Returns true if an error was caused by an aborted request — fetch's
 *  AbortController throws `DOMException('…', 'AbortError')`. */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))
}
