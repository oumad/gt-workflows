/** "42s" / "3m 12s" / "1h 4m" from milliseconds. Shared by Discord alerts
 *  and the alert persistence layer so the two never drift. */
export function fmtDurationMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
