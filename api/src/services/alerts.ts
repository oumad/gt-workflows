import { db, alerts } from '../db/index.js'
import type { NewAlert } from '../db/schema.js'
import type { ServerAlertEvent } from '../lib/discord.js'

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/**
 * Persist server-health alert events to the `alerts` table so the calendar can
 * show a timeline of past incidents. Best-effort: a DB failure is logged, not
 * thrown — the Discord webhook is the primary delivery path and must not be
 * blocked by a persistence hiccup.
 */
export async function recordServerAlerts(events: ServerAlertEvent[]): Promise<void> {
  if (events.length === 0) return

  const rows: NewAlert[] = events.map((e): NewAlert => {
    const common = { serverId: e.serverId, serverName: e.name, serverUrl: e.url }
    if (e.kind === 'down') {
      return {
        ...common,
        kind: 'server_down',
        severity: 'critical',
        title: `${e.name} went down`,
        body: e.reason,
      }
    }
    if (e.kind === 'recovered') {
      return {
        ...common,
        kind: 'server_recovered',
        severity: 'info',
        title: `${e.name} recovered`,
        body: `Back online after ${fmtDuration(e.downForMs)} of downtime.`,
        downtimeMs: e.downForMs,
      }
    }
    return {
      ...common,
      kind: 'server_still_down',
      severity: 'warning',
      title: `${e.name} still down`,
      body: `Down for ${fmtDuration(e.downForMs)} — reminder #${e.reminder}.`,
      downtimeMs: e.downForMs,
    }
  })

  try {
    await db.insert(alerts).values(rows)
  } catch (err) {
    console.error(
      '[alerts] failed to persist server alerts:',
      err instanceof Error ? err.message : err,
    )
  }
}
