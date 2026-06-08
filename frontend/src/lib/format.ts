/**
 * Shared value formatters.
 *
 * These previously existed as ~5 duration and ~4 relative-time copies scattered
 * across page-helper files (serverHelpers, workflowsHelpers, analyticsHelpers,
 * gtUserDetailHelpers, HomePage…) with subtly different output. This module is
 * the single source of truth — import from here, don't re-implement.
 */

/** Human-readable duration from a count of **seconds**.
 *  `45` → `45s`, `90` → `1m 30s`, `3700` → `1h 1m`; null / NaN → `—`. */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (s < 3600) return `${m}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${m % 60}m`
}

/** Human-readable duration from a count of **milliseconds**.
 *  `450` → `450ms`, `1500` → `1.5s`, `90000` → `1m 30s`, `5400000` → `1.5h`;
 *  null / NaN → `—`. */
export function fmtDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

/** Short relative time: `just now`, `5s ago`, `2m ago`, `5h ago`, `3d ago`.
 *  null / invalid / future → `—`. */
export function fmtRelativeTime(when: string | number | Date | null | undefined): string {
  if (when == null || when === '') return '—'
  const ms = Date.now() - new Date(when).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 30) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}
