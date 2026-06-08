/* Shared types + helpers for Analytics + Doctor pages. */

export type Range = '24h' | '7d' | '30d' | 'all'

/** Convert a Range to a `days` query param value. 0 is the sentinel for "all time". */
export const rangeToDays = (r: Range): number =>
  r === '24h' ? 1 : r === '7d' ? 7 : r === '30d' ? 30 : 0

export const rangeLabel = (r: Range): string =>
  r === '24h' ? '24h' : r === '7d' ? '7d' : r === '30d' ? '30d' : 'all time'

/* ─── Server response shapes ─────────────────────────────────────── */

export interface AnalyticsData {
  range: { days: number }
  workflows: {
    total: number
    completed: number
    failed: number
    active: number
    waiting: number
    avgDurationMs: number | null
    totalDurationMs: number | null
  }
  training: {
    total: number
    completed: number
    failed: number
    running: number
    pending: number
    avgDurationMs: number | null
    totalDurationMs: number | null
  }
  daily: Array<{ date: string; total: number; completed: number; failed: number; other: number }>
  byWorkflow: Array<{
    workflowName: string | null
    total: number
    completed: number
    failed: number
    successRate: number
    avgDurationMs: number | null
  }>
  byLora: Array<{
    baseModel: string | null
    total: number
    completed: number
    failed: number
    successRate: number
    avgDurationMs: number | null
  }>
  byServer: Array<{
    server_name: string
    server_id: string | null
    /** Raw URL the job used — present so the Performance tab can extract a
     *  hostname and aggregate "services per host" without a second query. */
    server_url: string | null
    server_type: string | null
    gpu: string | null
    total: number
    completed: number
    failed: number
    avg_duration_ms: number | null
    p50_ms: number | null
    p95_ms: number | null
    p99_ms: number | null
    avg_wait_ms: number | null
    total_duration_ms: number | null
  }>
  byHour: Array<{ hour: number; count: number }>
}

export interface DurationBucket {
  label: string
  count: number
}

export interface DistributionRow {
  name: string
  secondary: string | null
  gpu: string | null
  value: number
}

/* perf-daily returns { date, entity, value } where `value`'s meaning depends on
 * the metric you asked for (runs | dur | p95 | fail). Front-end consumers know
 * which metric they requested. */
export interface PerfDailyRow {
  date: string
  entity: string
  value: number
}

export interface UserAgg {
  user_id: string | null
  user_name: string
  email: string | null
  total: number
  failed: number
  completed: number
  avg_duration_ms: number | null
  last_run_at: string | null
}

export interface ErrorAgg {
  code: string
  count: number
  samples: string[] | null
}

export interface TimeseriesRow {
  date: string // YYYY-MM-DD
  entity: string
  count: number
}

export interface SlowJob {
  type: 'wf' | 'lora'
  id: string
  name: string | null
  status: string
  duration_ms: number | null
  wait_ms: number | null
  created_at: string
  started_at: string | null
  exec_at: string | null
  finished_at: string | null
  server_url: string | null
  server_id: string | null
  client_id: string | null
  failed_reason: string | null
  server_name: string | null
  user_name: string | null
}

/* ─── Color palette ──────────────────────────────────────────────── */

export const PALETTE = [
  'var(--accent)',
  'var(--info)',
  'var(--good)',
  'var(--pop-purple)',
  'var(--pop-pink)',
  'var(--pop-cyan)',
  'var(--warn)',
  'var(--bad)',
]

export function colorForName(name: string | null | undefined, fallback = 'var(--ink-3)'): string {
  if (!name) return fallback
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/* ─── Day-axis helpers ───────────────────────────────────────────── */

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Axis labels are absolute dates ("May 7") — relative offsets ("13d ago") force
// the reader to do mental arithmetic and get ambiguous fast on longer ranges.
function axisLabel(d: Date): string {
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

/** Parse a YYYY-MM-DD string at *local* midnight. `new Date('2026-05-07')`
 *  parses as UTC, which can render the label one day off in non-UTC zones. */
function parseLocalDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function buildDayAxis(days: number): { dates: string[]; labels: string[] } {
  if (days <= 0) return { dates: [], labels: [] } // 'all' — caller should use buildAxisFromDates
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dates: string[] = []
  const labels: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(isoDay(d))
    labels.push(axisLabel(d))
  }
  return { dates, labels }
}

/** Axis built from a sparse set of dates (e.g. the union of dates across returned timeseries rows).
 *  Used when range='all' so the axis adapts to whatever data the server returned. */
export function buildAxisFromDates(rawDates: Iterable<string>): {
  dates: string[]
  labels: string[]
} {
  const uniq = Array.from(new Set(Array.from(rawDates, (d) => d.slice(0, 10)))).sort()
  const labels = uniq.map((d) => axisLabel(parseLocalDay(d)))
  return { dates: uniq, labels }
}

/** Pick the right axis automatically: rolling for fixed ranges, data-driven for 'all'. */
export function dayAxisFor(
  days: number,
  fallbackDates: Iterable<string>,
): { dates: string[]; labels: string[] } {
  return days > 0 ? buildDayAxis(days) : buildAxisFromDates(fallbackDates)
}

/** Group sparse {date, entity, count} rows into one series per entity, aligned to `dates`. */
export function densifyTimeseries(
  rows: TimeseriesRow[],
  dates: string[],
): { entity: string; data: number[]; total: number }[] {
  const idxOf = new Map(dates.map((d, i) => [d, i]))
  const map = new Map<string, number[]>()
  for (const r of rows) {
    const k = r.entity ?? 'unknown'
    if (!map.has(k))
      map.set(
        k,
        dates.map(() => 0),
      )
    const i = idxOf.get(r.date.slice(0, 10))
    if (i != null) map.get(k)![i] = r.count
  }
  return Array.from(map.entries())
    .map(([entity, data]) => ({ entity, data, total: data.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
}

/* ─── Formatting ─────────────────────────────────────────────────── */

// Duration + relative-time formatting now live in the shared lib/format
// module; re-exported with the names this page-helper has historically used.
export { fmtDurationMs as fmtMs, fmtRelativeTime as fmtAgo } from '../../lib/format'

export function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

/* ─── CSV export ─────────────────────────────────────────────────── */

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ─── Error code classification (matches backend errorCodeSql) ──── */
// Order matters — first match wins. More specific patterns come first.

export function classifyError(reason: string | null | undefined): string {
  if (!reason) return 'UNKNOWN'
  const r = reason
  // Aborted / cancelled (intentional, not really a "failure")
  if (/cancel|aborted|SIGINT|SIGTERM/i.test(r)) return 'ABORTED'
  // GPU / memory
  if (/out of memory|OOM|CUDA out|HIP out|cudaError.*memory/i.test(r)) return 'OOM'
  if (/host memory|RAM exhausted|MemoryError/i.test(r)) return 'OOM_HOST'
  if (/loss|NaN|diverged|gradient/i.test(r)) return 'LOSS_NAN'
  if (/checksum|corrupt|hash mismatch/i.test(r)) return 'DATA_BAD'
  if (/checkpoint.*(failed|write|read)|ckpt/i.test(r)) return 'CKPT_IO'
  if (/shape|dimension|tensor.*(size|mismatch)|reshape/i.test(r)) return 'SHAPE'
  // Node / POSIX errno-style codes
  if (/EADDRINUSE/i.test(r)) return 'EADDRINUSE'
  if (/ECONNREFUSED/i.test(r)) return 'ECONNREFUSED'
  if (/ECONNRESET/i.test(r)) return 'ECONNRESET'
  if (/EHOSTUNREACH|ENETUNREACH/i.test(r)) return 'ENETUNREACH'
  if (/ETIMEDOUT/i.test(r)) return 'ETIMEDOUT'
  if (/ENOSPC|disk full|no space left/i.test(r)) return 'ENOSPC'
  if (/EACCES|EPERM|permission denied/i.test(r)) return 'EACCES'
  if (/ENOENT|no such file/i.test(r)) return 'ENOENT'
  // HTTP-flavoured
  if (/timeout|timed out/i.test(r)) return 'TIMEOUT'
  if (/rate.?limit|429/i.test(r)) return 'RATE_LIMIT'
  if (/401|unauthorized/i.test(r)) return 'UNAUTHORIZED'
  if (/403|forbidden/i.test(r)) return 'FORBIDDEN'
  if (/404|not found|missing/i.test(r)) return 'NOT_FOUND'
  if (/5\d{2}|server error|internal error|bad gateway|gateway timeout/i.test(r)) return 'SERVER_ERR'
  // Storage
  if (/s3|gcs|azure blob|storage|bucket/i.test(r)) return 'STORAGE_IO'
  // Code / runtime
  if (/import\s*error|ModuleNotFound|cannot find module/i.test(r)) return 'IMPORT_ERR'
  if (/JSON|parse error|unexpected token/i.test(r)) return 'PARSE_ERR'
  if (/network|DNS|getaddrinfo/i.test(r)) return 'NETWORK'
  return 'OTHER'
}

/** Tone used by the chip class — 'aborted' renders neutrally (not red/orange). */
export type ErrorTone = 'bad' | 'warn' | 'info' | 'aborted'

export function errorCodeTone(code: string): ErrorTone {
  if (code === 'ABORTED') return 'aborted'
  if (/OOM|LOSS|DATA|CKPT|ENOSPC/.test(code)) return 'bad'
  if (
    /TIMEOUT|FORBIDDEN|UNAUTHORIZED|SERVER|STORAGE|EADDRINUSE|ECONN|EACCES|ETIMEDOUT|RATE/.test(
      code,
    )
  )
    return 'warn'
  return 'info'
}

export const ERROR_CODE_LABEL: Record<string, string> = {
  ABORTED: 'Cancelled by user',
  OOM: 'CUDA out of memory',
  OOM_HOST: 'Host memory exhausted',
  LOSS_NAN: 'Loss diverged / NaN',
  DATA_BAD: 'Dataset checksum / corrupt',
  CKPT_IO: 'Checkpoint I/O',
  SHAPE: 'Tensor shape mismatch',
  EADDRINUSE: 'Port already in use',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection reset',
  ENETUNREACH: 'Host unreachable',
  ETIMEDOUT: 'Socket timed out',
  ENOSPC: 'Disk full',
  EACCES: 'Permission denied',
  ENOENT: 'File not found',
  TIMEOUT: 'Timed out',
  RATE_LIMIT: 'Rate limited (429)',
  UNAUTHORIZED: 'Unauthorized (401)',
  FORBIDDEN: 'Forbidden (403)',
  NOT_FOUND: 'Not found (404)',
  SERVER_ERR: 'Upstream 5xx',
  STORAGE_IO: 'Storage / bucket',
  IMPORT_ERR: 'Import error',
  PARSE_ERR: 'Parse error',
  NETWORK: 'Network / DNS',
  UNKNOWN: 'No reason recorded',
  OTHER: 'Other',
}

export const ERROR_CODE_COLOR: Record<string, string> = {
  ABORTED: 'var(--ink-3)',
  OOM: 'var(--bad)',
  OOM_HOST: 'var(--bad)',
  LOSS_NAN: 'var(--pop-purple)',
  DATA_BAD: 'var(--bad)',
  CKPT_IO: 'var(--pop-pink)',
  SHAPE: 'var(--pop-cyan)',
  EADDRINUSE: 'var(--warn)',
  ECONNREFUSED: 'var(--warn)',
  ECONNRESET: 'var(--warn)',
  ENETUNREACH: 'var(--warn)',
  ETIMEDOUT: 'var(--warn)',
  ENOSPC: 'var(--bad)',
  EACCES: 'var(--warn)',
  ENOENT: 'var(--info)',
  TIMEOUT: 'var(--warn)',
  RATE_LIMIT: 'var(--warn)',
  UNAUTHORIZED: 'var(--warn)',
  FORBIDDEN: 'var(--warn)',
  NOT_FOUND: 'var(--info)',
  SERVER_ERR: 'var(--warn)',
  STORAGE_IO: 'var(--info)',
  IMPORT_ERR: 'var(--pop-purple)',
  PARSE_ERR: 'var(--info)',
  NETWORK: 'var(--info)',
  UNKNOWN: 'var(--ink-3)',
  OTHER: 'var(--ink-3)',
}
