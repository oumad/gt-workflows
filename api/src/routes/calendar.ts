import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db, calendarEvents, alerts } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

/* Categories the calendar understands. `run` / `training` are derived from
 * workflow_jobs / training_jobs (read-only, aggregated one per day). `alert`
 * is derived from the `alerts` table (past server-health incidents). Only
 * `maintenance` and `workshop` are user-creatable and live in calendar_events. */
const USER_CATS = ['maintenance', 'workshop'] as const
type UserCategory = (typeof USER_CATS)[number]

const ALL_CATS = ['run', 'training', 'alert', ...USER_CATS] as const
type AnyCategory = (typeof ALL_CATS)[number]

interface CalendarEvent {
  id: string
  title: string
  category: AnyCategory
  date: string // YYYY-MM-DD
  start: string // HH:MM
  end: string // HH:MM
  owner: string | null
  location: string | null
  servers: string[]
  notes: string | null
  source: 'user' | 'wf' | 'lora' | 'alert'
  jobId?: string // for synthetic events, the underlying job id
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function isoTime(d: Date): string {
  return d.toISOString().slice(11, 16)
}
function tryDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/* ── GET /calendar ?from=YYYY-MM-DD&to=YYYY-MM-DD&categories=... ───
 *  Returns the merged calendar feed across `calendar_events`,
 *  `workflow_jobs`, and `training_jobs` for the requested window.
 *  Defaults: from = today − 30d, to = today + 30d.                  */
const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  categories: z.string().optional(),
})

app.get('/', requireAuth, zValidator('query', listQuery), async (c) => {
  const q = c.req.valid('query')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const defFrom = new Date(today)
  defFrom.setDate(defFrom.getDate() - 30)
  const defTo = new Date(today)
  defTo.setDate(defTo.getDate() + 30)
  const fromStr = q.from ?? isoDate(defFrom)
  const toStr = q.to ?? isoDate(defTo)
  const cats = q.categories
    ? new Set(q.categories.split(',').filter(Boolean) as AnyCategory[])
    : new Set<AnyCategory>(ALL_CATS)

  // Build dynamic categories filter for the user-events table.
  const userCats = USER_CATS.filter((c) => cats.has(c))

  const wantUser = userCats.length > 0
  const wantWf = cats.has('run')
  const wantLora = cats.has('training')
  const wantAlert = cats.has('alert')

  const events: CalendarEvent[] = []

  /* 1. User-created events */
  if (wantUser) {
    // NB: `category = ANY(${userCats})` expands the JS array into individual
    // SQL parameters (`ANY($3, $4, …)`), which Postgres rejects with
    // "op ANY/ALL (array) requires array on right side". Use drizzle's
    // `inArray`, which emits `category IN (…)` — semantically equivalent.
    const filters: SQL[] = [
      sql`event_date >= ${fromStr}::date`,
      sql`event_date <= ${toStr}::date`,
      inArray(calendarEvents.category, userCats),
    ]
    const rows = await db
      .select()
      .from(calendarEvents)
      .where(and(...filters))
    for (const r of rows) {
      events.push({
        id: r.id,
        title: r.title,
        category: r.category as AnyCategory,
        date: r.eventDate, // already YYYY-MM-DD from `date` column
        start: r.startTime.slice(0, 5),
        end: r.endTime.slice(0, 5),
        owner: r.owner,
        location: r.location,
        servers: r.servers ?? [],
        notes: r.notes,
        source: 'user',
      })
    }
  }

  /* 2. Workflow runs — aggregated to ONE synthetic event per day. Per-run rows
   *    bury the calendar (a busy day has hundreds), so we roll them up: one
   *    event titled "N workflow runs" with the breakdown in `notes`. Only jobs
   *    that actually executed (processed_at not null) are counted. */
  if (wantWf) {
    const rows = await db.execute(sql`
      SELECT
        to_char(wj.processed_at, 'YYYY-MM-DD')               AS day,
        count(*)::int                                        AS total,
        count(*) FILTER (WHERE wj.status = 'completed')::int AS completed,
        count(*) FILTER (WHERE wj.status = 'failed')::int    AS failed,
        count(DISTINCT wj.workflow_name)::int                AS workflows,
        min(wj.processed_at)                                 AS first_at,
        max(COALESCE(wj.finished_at, wj.processed_at))        AS last_at
      FROM workflow_jobs wj
      WHERE wj.processed_at IS NOT NULL
        AND wj.processed_at >= ${fromStr}::timestamptz
        AND wj.processed_at <  (${toStr}::date + 1)::timestamptz
      GROUP BY to_char(wj.processed_at, 'YYYY-MM-DD')
      ORDER BY day
    `)
    for (const r of rows as unknown as Array<{
      day: string
      total: number
      completed: number
      failed: number
      workflows: number
      first_at: string
      last_at: string
    }>) {
      const first = tryDate(r.first_at)
      const last = tryDate(r.last_at)
      const plural = r.total === 1 ? '' : 's'
      events.push({
        id: `wf-day:${r.day}`,
        title: `${r.total} workflow run${plural}`,
        category: 'run',
        date: r.day,
        start: first ? isoTime(first) : '00:00',
        end: last ? isoTime(last) : '23:59',
        owner: null,
        location: null,
        servers: [],
        notes: [
          `${r.total} workflow run${plural} across ${r.workflows} workflow${r.workflows === 1 ? '' : 's'}.`,
          `✓ ${r.completed} completed · ✗ ${r.failed} failed`,
          first && last ? `Active ${isoTime(first)}–${isoTime(last)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        source: 'wf',
      })
    }
  }

  /* 3. LoRA training — aggregated to one synthetic event per day, same as WF. */
  if (wantLora) {
    const rows = await db.execute(sql`
      SELECT
        to_char(tj.started_at, 'YYYY-MM-DD')                 AS day,
        count(*)::int                                        AS total,
        count(*) FILTER (WHERE tj.status = 'completed')::int AS completed,
        count(*) FILTER (WHERE tj.status = 'failed')::int    AS failed,
        count(*) FILTER (WHERE tj.status = 'running')::int   AS running,
        min(tj.started_at)                                   AS first_at,
        max(COALESCE(tj.finished_at, tj.started_at))          AS last_at
      FROM training_jobs tj
      WHERE tj.started_at IS NOT NULL
        AND tj.started_at >= ${fromStr}::timestamptz
        AND tj.started_at <  (${toStr}::date + 1)::timestamptz
      GROUP BY to_char(tj.started_at, 'YYYY-MM-DD')
      ORDER BY day
    `)
    for (const r of rows as unknown as Array<{
      day: string
      total: number
      completed: number
      failed: number
      running: number
      first_at: string
      last_at: string
    }>) {
      const first = tryDate(r.first_at)
      const last = tryDate(r.last_at)
      const plural = r.total === 1 ? '' : 's'
      events.push({
        id: `lora-day:${r.day}`,
        title: `${r.total} LoRA training run${plural}`,
        category: 'training',
        date: r.day,
        start: first ? isoTime(first) : '00:00',
        end: last ? isoTime(last) : '23:59',
        owner: null,
        location: null,
        servers: [],
        notes: [
          `${r.total} LoRA training run${plural}.`,
          `✓ ${r.completed} completed · ✗ ${r.failed} failed${r.running > 0 ? ` · ▶ ${r.running} running` : ''}`,
          first && last ? `Active ${isoTime(first)}–${isoTime(last)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        source: 'lora',
      })
    }
  }

  /* 4. Server alerts — past down/recovered/still-down incidents from the
   *    `alerts` table. Shown as individual point-in-time entries (alerts are
   *    infrequent, so no per-day aggregation); the moment is given a nominal
   *    15-minute block so it's visible in the time-grid views. */
  if (wantAlert) {
    const rows = await db
      .select()
      .from(alerts)
      .where(
        and(
          sql`${alerts.createdAt} >= ${fromStr}::timestamptz`,
          sql`${alerts.createdAt} <  (${toStr}::date + 1)::timestamptz`,
        ),
      )
      .orderBy(alerts.createdAt)
      .limit(500)
    for (const a of rows) {
      const at = a.createdAt // Date — column is NOT NULL
      const endD = new Date(at.getTime() + 15 * 60_000)
      const end = isoDate(endD) === isoDate(at) ? isoTime(endD) : '23:59'
      events.push({
        id: `alert:${a.id}`,
        title: a.title,
        category: 'alert',
        date: isoDate(at),
        start: isoTime(at),
        end,
        owner: null,
        location: a.serverName,
        servers: a.serverName ? [a.serverName] : [],
        notes: a.body,
        source: 'alert',
      })
    }
  }

  // Stable sort: date then start time.
  events.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))

  return c.json({ from: fromStr, to: toStr, items: events })
})

/* ── POST /calendar  (create user event) ─────────────────── */
const createSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(USER_CATS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  owner: z.string().max(100).nullish(),
  location: z.string().max(200).nullish(),
  servers: z.array(z.string()).optional(),
  notes: z.string().max(2000).nullish(),
})

app.post('/', requireAuth, zValidator('json', createSchema), async (c) => {
  const body = c.req.valid('json')
  const userId = c.get('user')?.id ?? null
  const [row] = await db
    .insert(calendarEvents)
    .values({
      title: body.title,
      category: body.category,
      eventDate: body.date,
      startTime: body.start.length === 5 ? `${body.start}:00` : body.start,
      endTime: body.end.length === 5 ? `${body.end}:00` : body.end,
      owner: body.owner ?? null,
      location: body.location ?? null,
      servers: body.servers ?? [],
      notes: body.notes ?? null,
      createdBy: userId,
    })
    .returning()
  return c.json(row)
})

/* ── PATCH /calendar/:id ─────────────────────────────────── */
const patchSchema = createSchema.partial()
app.patch('/:id', requireAuth, zValidator('json', patchSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) updates['title'] = body.title
  if (body.category !== undefined) updates['category'] = body.category
  // Moving the event re-arms its "30 min before" reminder.
  if (body.date !== undefined) {
    updates['eventDate'] = body.date
    updates['reminderSentAt'] = null
  }
  if (body.start !== undefined) {
    updates['startTime'] = body.start.length === 5 ? `${body.start}:00` : body.start
    updates['reminderSentAt'] = null
  }
  if (body.end !== undefined)
    updates['endTime'] = body.end.length === 5 ? `${body.end}:00` : body.end
  if (body.owner !== undefined) updates['owner'] = body.owner
  if (body.location !== undefined) updates['location'] = body.location
  if (body.servers !== undefined) updates['servers'] = body.servers
  if (body.notes !== undefined) updates['notes'] = body.notes

  const [row] = await db
    .update(calendarEvents)
    .set(updates)
    .where(eq(calendarEvents.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

/* ── DELETE /calendar/:id ────────────────────────────────── */
app.delete('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const [row] = await db
    .delete(calendarEvents)
    .where(eq(calendarEvents.id, id))
    .returning({ id: calendarEvents.id })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

/* ── GET /calendar/export.ics ────────────────────────────── */
function icsEscape(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}
function icsDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(/:/g, '').padEnd(6, '0')}`
}

app.get('/export.ics', requireAuth, async (c) => {
  // Re-use the merged feed with default window.
  const params = new URLSearchParams()
  const q = c.req.query()
  if (q['from']) params.set('from', q['from'])
  if (q['to']) params.set('to', q['to'])
  if (q['categories']) params.set('categories', q['categories'])

  // We could call our own GET / handler but it's cleaner to inline the merge.
  const feedRes = await app.request(`/?${params}`, {
    headers: c.req.raw.headers,
  })
  const feed = (await feedRes.json()) as { items: CalendarEvent[] }

  const now = new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//gt-coffee-maker//calendar//EN',
    'CALSCALE:GREGORIAN',
  ]
  for (const ev of feed.items) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}@coffee-maker`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(ev.date, ev.start)}`,
      `DTEND:${icsDateTime(ev.date, ev.end)}`,
      `SUMMARY:${icsEscape(ev.title)}`,
      `CATEGORIES:${icsEscape(ev.category)}`,
    )
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`)
    if (ev.owner)
      lines.push(`ORGANIZER;CN=${icsEscape(ev.owner)}:mailto:noreply@coffee-maker.local`)
    if (ev.notes) lines.push(`DESCRIPTION:${icsEscape(ev.notes)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')

  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="coffee-maker-calendar.ics"',
    },
  })
})

export default app
