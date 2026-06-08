import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, calendarEvents } from '../db/index.js'
import { sendCalendarReminder } from '../lib/discord.js'

// Fire a Discord heads-up this many minutes before an event starts.
const REMINDER_LEAD_MIN = 30

/**
 * Find calendar events starting within the next REMINDER_LEAD_MIN minutes that
 * haven't been reminded yet, post a Discord alert for each, and stamp
 * `reminder_sent_at` so the heads-up only goes out once. Runs every sync cycle
 * (~60s), which is fine granularity for a 30-minute lead.
 *
 * `event_date + start_time` is a tz-naive timestamp; we compare it against
 * `now()` cast to the same naive frame — consistent with how the rest of the
 * calendar treats wall-clock times (no per-event timezone is stored).
 */
export async function checkCalendarReminders(): Promise<void> {
  let due: Array<typeof calendarEvents.$inferSelect>
  try {
    due = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          isNull(calendarEvents.reminderSentAt),
          // start is still in the future…
          sql`(${calendarEvents.eventDate} + ${calendarEvents.startTime}) >= now()::timestamp`,
          // …and no more than REMINDER_LEAD_MIN minutes away.
          sql`(${calendarEvents.eventDate} + ${calendarEvents.startTime}) <= (now() + interval '${sql.raw(String(REMINDER_LEAD_MIN))} minutes')::timestamp`,
        ),
      )
  } catch (err) {
    console.error('[calendar] reminder query failed:', err instanceof Error ? err.message : err)
    return
  }
  if (due.length === 0) return

  for (const ev of due) {
    try {
      const startMs = new Date(`${ev.eventDate}T${ev.startTime}`).getTime()
      const minutesUntil = Number.isFinite(startMs)
        ? Math.max(0, Math.round((startMs - Date.now()) / 60_000))
        : REMINDER_LEAD_MIN

      await sendCalendarReminder({
        title: ev.title,
        category: ev.category,
        date: ev.eventDate,
        start: ev.startTime.slice(0, 5),
        end: ev.endTime.slice(0, 5),
        owner: ev.owner,
        location: ev.location,
        minutesUntil,
      })

      // Stamp it regardless of whether the webhook is configured — a missing
      // DISCORD_WEBHOOK_URL makes sendCalendarReminder a no-op, and we still
      // don't want to re-evaluate this event every cycle.
      await db
        .update(calendarEvents)
        .set({ reminderSentAt: new Date() })
        .where(eq(calendarEvents.id, ev.id))

      console.log(`[calendar] reminder sent: "${ev.title}" starts in ~${minutesUntil}m`)
    } catch (err) {
      console.warn(
        `[calendar] reminder failed for ${ev.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}
