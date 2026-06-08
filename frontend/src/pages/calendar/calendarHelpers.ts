/* Shared types + small date utilities for the Calendar feature.
 * Day-of-week math is Monday-first to match the reference design. */

export type CalCategory = 'run' | 'training' | 'alert' | 'maintenance' | 'workshop'
export type CalSource = 'user' | 'wf' | 'lora' | 'alert'

export interface CalEvent {
  id: string
  title: string
  category: CalCategory
  date: string // YYYY-MM-DD
  start: string // HH:MM
  end: string // HH:MM
  owner: string | null
  location: string | null
  servers: string[]
  notes: string | null
  source: CalSource
  jobId?: string
}

export interface CalFeed {
  from: string
  to: string
  items: CalEvent[]
}

/* User-creatable categories — these go through POST /api/calendar.
 * `run` / `training` are derived from job tables (aggregated one-per-day) and
 * `alert` from the alerts table; all three are read-only here. */
export const USER_CATEGORIES: CalCategory[] = ['maintenance', 'workshop']
export const ALL_CATEGORIES: CalCategory[] = ['run', 'training', 'alert', ...USER_CATEGORIES]

export const CAL_CATEGORIES: Record<CalCategory, { label: string; color: string }> = {
  run: { label: 'Workflow runs', color: 'var(--pop-purple)' },
  training: { label: 'LoRA training', color: 'var(--pop-pink)' },
  alert: { label: 'Service alerts', color: 'var(--bad)' },
  maintenance: { label: 'Maintenance', color: 'var(--warn)' },
  workshop: { label: 'Workshop', color: 'var(--info)' },
}

/* ─── Date helpers ──────────────────────────────────────────────── */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false
  return fmtDate(a) === fmtDate(b)
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function startOfWeek(d: Date): Date {
  // Monday-first
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
export function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
export const DAY_LABELS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Convert "HH:MM" to a numeric hour (e.g. "14:30" → 14.5). */
export function hourTo(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h ?? 0) + (m ?? 0) / 60
}

/** Parse a YYYY-MM-DD string at local midnight (avoids UTC shift). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
