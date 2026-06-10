/**
 * Request logging tuned for Windows consoles, whose synchronous rendering
 * makes per-request logging genuinely expensive (visible as lag over RDP).
 * The UI polls several endpoints every few seconds, so by default only the
 * interesting requests are logged:
 *
 *   LOG_LEVEL=debug  → every request
 *   otherwise        → only failures (status >= 400) and slow ones (>= 1s)
 */
import type { MiddlewareHandler } from 'hono'
import { config } from '../config/index.js'

const SLOW_MS = 1_000

export function requestLog(): MiddlewareHandler {
  const verbose = config.LOG_LEVEL === 'debug'
  return async (c, next) => {
    const start = Date.now()
    await next()
    const ms = Date.now() - start
    if (verbose || c.res.status >= 400 || ms >= SLOW_MS) {
      console.log(`[req] ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`)
    }
  }
}
