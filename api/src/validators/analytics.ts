/**
 * Analytics query parsing. Mostly hand-rolled helpers rather than Zod —
 * these are GET endpoints with a handful of optional string params and
 * defaults that need to be applied carefully (e.g. `days=all` is a sentinel
 * meaning "no date filter", not an integer to clamp).
 */

export const PERF_METRICS = ['runs', 'dur', 'p95', 'fail'] as const
export type PerfMetric = (typeof PERF_METRICS)[number]

export const TIMESERIES_GROUPS = ['workflow', 'server', 'user', 'lora'] as const
export type TimeseriesGroup = (typeof TIMESERIES_GROUPS)[number]

// 'runs' = job count, 'gpu' = GPU-hours, 'users' = distinct active users.
export const TIMESERIES_METRICS = ['runs', 'gpu', 'users'] as const
export type TimeseriesMetric = (typeof TIMESERIES_METRICS)[number]

export const DIST_GROUPS = ['server', 'workflow', 'lora'] as const
export type DistGroup = (typeof DIST_GROUPS)[number]

export const ENTITY_KINDS = ['error', 'workflow', 'server', 'user'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/** Parse the `days` query param.
 *  - "all" or "0"       → 0   (sentinel: no date filter)
 *  - 1..90              → as-is
 *  - everything else    → 14 (default)
 *  The capped maximum (90) only applies to numeric values — "all" is
 *  unbounded and intentionally allowed because users explicitly opt in. */
export function parseDays(raw: string | undefined): number {
  if (raw === 'all' || raw === '0') return 0
  const n = parseInt(raw ?? '14', 10)
  if (!Number.isFinite(n) || n < 1) return 14
  return Math.min(n, 90)
}

export function parseTop(raw: string | undefined, fallback = 8, max = 500): number {
  return Math.min(Math.max(parseInt(raw ?? String(fallback), 10) || fallback, 1), max)
}

export function parsePage(raw: string | undefined): number {
  return Math.max(parseInt(raw ?? '1', 10) || 1, 1)
}

export function parseLimit(raw: string | undefined, fallback = 20, max = 200): number {
  return Math.min(Math.max(parseInt(raw ?? String(fallback), 10) || fallback, 1), max)
}

export function parsePerfMetric(raw: string | undefined): PerfMetric | null {
  return (PERF_METRICS as readonly string[]).includes(raw ?? '') ? (raw as PerfMetric) : null
}

export function parseTimeseriesGroup(raw: string | undefined): TimeseriesGroup {
  return (TIMESERIES_GROUPS as readonly string[]).includes(raw ?? '')
    ? (raw as TimeseriesGroup)
    : 'workflow'
}

export function parseTimeseriesMetric(raw: string | undefined): TimeseriesMetric {
  return (TIMESERIES_METRICS as readonly string[]).includes(raw ?? '')
    ? (raw as TimeseriesMetric)
    : 'runs'
}

export function parseDistGroup(raw: string | undefined): DistGroup {
  return (DIST_GROUPS as readonly string[]).includes(raw ?? '') ? (raw as DistGroup) : 'server'
}

export function parseEntityKind(raw: string | undefined): EntityKind | null {
  return (ENTITY_KINDS as readonly string[]).includes(raw ?? '') ? (raw as EntityKind) : null
}
