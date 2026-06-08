import type { Context, MiddlewareHandler } from 'hono'

/**
 * Minimal fixed-window IP rate limiter.
 *
 * In-memory only — fine for a single-process deploy. Switch to a Redis-backed
 * counter when we run > 1 API instance. Key is taken from
 * X-Forwarded-For / X-Real-IP (first hop) so deployments behind a reverse
 * proxy work correctly; falls back to 'unknown' when neither is present.
 */
type Bucket = { count: number; resetAt: number }

export interface RateLimitOptions {
  windowMs: number
  max: number
  key?: (c: Context) => string
}

function defaultKey(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  return fwd || c.req.header('x-real-ip') || 'unknown'
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>()
  const keyFn = opts.key ?? defaultKey

  return async (c, next) => {
    const k = keyFn(c)
    const now = Date.now()
    let b = buckets.get(k)
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(k, b)
    }
    b.count += 1
    if (b.count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000))
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'Too many requests' }, 429)
    }
    return next()
  }
}
