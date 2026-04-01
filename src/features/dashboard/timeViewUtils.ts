/**
 * Time View helpers: compute bounds from UI state and aggregate jobs by day.
 * Pure functions; no side effects.
 */

import type { ActivityJob } from '@/services/api/stats'

export type TimeViewRangeId = 'week' | 'month' | 'year' | 'all'

export interface TimeViewBounds {
  from: string
  to: string
}

/** Returns local date string (YYYY-MM-DD) for a timestamp (ms). */
function toDateKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Computes from/to ISO bounds from Time View form state.
 * "all" is capped to last 2 years.
 */
export function getTimeViewBounds(
  timeRange: TimeViewRangeId,
  selectedWeek: string,
  selectedMonth: number,
  selectedYearForMonth: number,
  selectedYearForYear: number
): TimeViewBounds {
  const now = new Date()
  let from: Date
  let to: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  switch (timeRange) {
    case 'week': {
      // selectedWeek is "YYYY-Www" (HTML week input value)
      const [yearStr, weekStr] = selectedWeek.split('-W')
      const year = Number(yearStr)
      const week = Number(weekStr)
      // ISO week 1 is the week containing Jan 4; find its Monday
      const jan4 = new Date(year, 0, 4)
      const dow = jan4.getDay() || 7 // Mon=1 … Sun=7
      from = new Date(jan4)
      from.setDate(jan4.getDate() - (dow - 1) + (week - 1) * 7)
      from.setHours(0, 0, 0, 0)
      to = new Date(from)
      to.setDate(from.getDate() + 6)
      to.setHours(23, 59, 59, 999)
      break
    }
    case 'month': {
      from = new Date(selectedYearForMonth, selectedMonth - 1, 1, 0, 0, 0, 0)
      to = new Date(selectedYearForMonth, selectedMonth, 0, 23, 59, 59, 999)
      break
    }
    case 'year': {
      from = new Date(selectedYearForYear, 0, 1, 0, 0, 0, 0)
      to = new Date(selectedYearForYear, 11, 31, 23, 59, 59, 999)
      break
    }
    case 'all':
    default: {
      from = new Date(now)
      from.setFullYear(from.getFullYear() - 2)
      from.setHours(0, 0, 0, 0)
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      break
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

export interface AggregatedByDay {
  dates: string[]
  workflowByDay: Record<string, Record<string, number>>
  serverByDay: Record<string, Record<string, number>>
  workflowNames: string[]
  serverNames: string[]
}

/** Aggregates jobs by day (date key) and by workflow name / server. */
export function aggregateJobsByDay(jobs: ActivityJob[]): AggregatedByDay {
  const workflowByDay: Record<string, Record<string, number>> = {}
  const serverByDay: Record<string, Record<string, number>> = {}
  const dateSet = new Set<string>()

  for (const job of jobs) {
    const ts = job.finishedOn ?? job.processedOn ?? job.timestamp
    if (ts == null || !Number.isFinite(ts)) continue
    const dateKey = toDateKey(ts)
    dateSet.add(dateKey)

    const wfName = job.name?.trim() || '—'
    if (!workflowByDay[dateKey]) workflowByDay[dateKey] = {}
    workflowByDay[dateKey][wfName] = (workflowByDay[dateKey][wfName] ?? 0) + 1

    const server = job.server?.trim() || '—'
    if (!serverByDay[dateKey]) serverByDay[dateKey] = {}
    serverByDay[dateKey][server] = (serverByDay[dateKey][server] ?? 0) + 1
  }

  const dates = Array.from(dateSet).sort()
  const workflowNames = Array.from(
    new Set(
      Object.values(workflowByDay).flatMap((day) => Object.keys(day))
    )
  ).sort()
  const serverNames = Array.from(
    new Set(
      Object.values(serverByDay).flatMap((day) => Object.keys(day))
    )
  ).sort()

  return {
    dates,
    workflowByDay,
    serverByDay,
    workflowNames,
    serverNames,
  }
}

/** Deterministic color from string (hue 0–360). */
export function colorFromName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue}, 65%, 55%)`
}

// ── Heatmap aggregation (hours × days) ───────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface HeatmapData {
  /** 7 rows (Mon-Sun) × 24 cols (0h-23h) */
  grid: number[][]
  maxCount: number
  dayLabels: readonly string[]
}

/** Aggregate jobs into a 7×24 heatmap grid (ISO weekday × hour of day). */
export function aggregateHeatmap(jobs: ActivityJob[]): HeatmapData {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxCount = 0
  for (const job of jobs) {
    const ts = job.finishedOn ?? job.processedOn ?? job.timestamp
    if (ts == null || !Number.isFinite(ts)) continue
    const d = new Date(ts)
    const hour = d.getHours()
    // getDay: 0=Sun..6=Sat → ISO: 0=Mon..6=Sun
    const isoDay = (d.getDay() + 6) % 7
    grid[isoDay][hour]++
    if (grid[isoDay][hour] > maxCount) maxCount = grid[isoDay][hour]
  }
  return { grid, maxCount, dayLabels: DAY_LABELS }
}

// ── Failure rate aggregation ─────────────────────────────────────────

export interface FailureRateByDay {
  dates: string[]
  /** Failure rate 0–100 per date */
  rates: number[]
  failedCounts: number[]
  totalCounts: number[]
}

/** Compute daily failure rate from completed + failed job arrays. */
export function aggregateFailureRate(
  completedJobs: ActivityJob[],
  failedJobs: ActivityJob[],
): FailureRateByDay {
  const completedByDay: Record<string, number> = {}
  const failedByDay: Record<string, number> = {}
  const dateSet = new Set<string>()

  for (const job of completedJobs) {
    const ts = job.finishedOn ?? job.processedOn ?? job.timestamp
    if (ts == null || !Number.isFinite(ts)) continue
    const key = toDateKey(ts)
    dateSet.add(key)
    completedByDay[key] = (completedByDay[key] ?? 0) + 1
  }
  for (const job of failedJobs) {
    const ts = job.finishedOn ?? job.processedOn ?? job.timestamp
    if (ts == null || !Number.isFinite(ts)) continue
    const key = toDateKey(ts)
    dateSet.add(key)
    failedByDay[key] = (failedByDay[key] ?? 0) + 1
  }

  const dates = Array.from(dateSet).sort()
  const rates: number[] = []
  const failedCounts: number[] = []
  const totalCounts: number[] = []

  for (const date of dates) {
    const c = completedByDay[date] ?? 0
    const f = failedByDay[date] ?? 0
    const total = c + f
    rates.push(total > 0 ? (f / total) * 100 : 0)
    failedCounts.push(f)
    totalCounts.push(total)
  }

  return { dates, rates, failedCounts, totalCounts }
}

// ── User activity aggregation ────────────────────────────────────────

export interface UserByDay {
  dates: string[]
  userByDay: Record<string, Record<string, number>>
  userNames: string[]
}

/** Aggregate jobs by user and day. */
export function aggregateByUserAndDay(jobs: ActivityJob[]): UserByDay {
  const userByDay: Record<string, Record<string, number>> = {}
  const dateSet = new Set<string>()

  for (const job of jobs) {
    const ts = job.finishedOn ?? job.processedOn ?? job.timestamp
    if (ts == null || !Number.isFinite(ts)) continue
    const dateKey = toDateKey(ts)
    dateSet.add(dateKey)
    const user = job.user?.trim() || '—'
    if (!userByDay[dateKey]) userByDay[dateKey] = {}
    userByDay[dateKey][user] = (userByDay[dateKey][user] ?? 0) + 1
  }

  const dates = Array.from(dateSet).sort()
  const userNames = Array.from(
    new Set(Object.values(userByDay).flatMap((day) => Object.keys(day)))
  ).sort()

  return { dates, userByDay, userNames }
}
