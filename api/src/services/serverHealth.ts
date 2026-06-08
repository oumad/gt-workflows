import { eq, sql } from 'drizzle-orm'
import { db, servers } from '../db/index.js'
import { sendServerStatusAlert, type ServerAlertEvent } from '../lib/discord.js'
import { recordServerAlerts } from './alerts.js'

// Unified monitoring for both layers of the cluster:
//
//   Tier 1 — Servers (hosts):  port-less URLs, e.g. http://worker-03
//   Tier 2 — Services:         URLs with a port,  e.g. http://worker-03:8188
//
// The sync walks the hostname tree top-down:
//   • host probed first
//     – ok       → probe each service running on this host
//     – down     → alert for the host; services are marked offline (no
//                  per-service alert — the host alert is the parent signal)
//     – maintenance → skip everything in the group, no probe, no alert
//   • orphan services (no host record on their hostname) probe standalone
//
// Recovery is handled per record via classifyTransition's `downSince` state
// machine, so a host coming back up emits a 'recovered' event and any service
// that's still down emits its own 'down' event on the next sync.
//
// Per-record probes run in parallel within their tier; total wall time stays
// bounded by ≈2 × PROBE_TIMEOUT_MS (host then services).

const PROBE_TIMEOUT_MS = 3_000

// Re-alert cadence: the "down" alert fires instantly (on the first probe that
// sees the server unreachable). Reminders then go out at widening gaps —
// +10m, +30m, +1h — and repeat hourly after that. `alertCount` is the number
// of alerts already sent (1 right after the initial down alert); the returned
// value is the delay until the next reminder is due.
const ALERT_GAPS_MS = [
  10 * 60_000, // alert #1 sent → reminder #2 due in 10m
  30 * 60_000, // #2 → #3 in 30m
  60 * 60_000, // #3 → #4 in 1h
]
const ALERT_REPEAT_MS = 60 * 60_000 // every reminder after #4: hourly

function nextAlertDelayMs(alertCount: number): number {
  return ALERT_GAPS_MS[alertCount - 1] ?? ALERT_REPEAT_MS
}

async function httpGet(url: string): Promise<{ ok: boolean; ms: number | null }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS)
  const start = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', signal: ctl.signal })
    await res.body?.cancel().catch(() => {})
    return { ok: true, ms: Date.now() - start }
  } catch {
    return { ok: false, ms: null }
  } finally {
    clearTimeout(timer)
  }
}

type ProbeResult = {
  ping: { ok: boolean; ms: number | null }
  comfy: { ok: boolean } | null // null for non-workflow servers
}

async function probeServer(url: string, type: string): Promise<ProbeResult> {
  const base = url.replace(/\/+$/, '')
  if (type !== 'workflow') {
    const ping = await httpGet(base)
    return { ping, comfy: null }
  }
  const [ping, comfy] = await Promise.all([httpGet(base), httpGet(`${base}/system_stats`)])
  return { ping, comfy }
}

function isHealthy(r: ProbeResult): boolean {
  return r.ping.ok && (r.comfy === null || r.comfy.ok)
}

function downReason(r: ProbeResult): string {
  if (!r.ping.ok) return 'unreachable (ping failed)'
  if (r.comfy && !r.comfy.ok) return 'ComfyUI not responding'
  return 'unknown'
}

// Probe a single server immediately — used on server create and by the manual
// "force check" endpoint. Best-effort: errors are logged, never thrown.
//
// When `alert` is true the probe joins the same down/recovered/reminder state
// machine the scheduled sync uses (classifyTransition) and fires a Discord
// alert on a status change — so force-checking a server that just came back up
// notifies exactly like the auto-sync would, and going down is caught without
// waiting for the next sync tick. When false (server create) only the ping
// columns are refreshed and nothing is sent.
export async function probeOneServer(
  serverId: string,
  opts: { alert?: boolean } = {},
): Promise<void> {
  let row: HealthRow | undefined
  try {
    row = await db.query.servers.findFirst({
      where: (s, { eq }) => eq(s.id, serverId),
      columns: {
        id: true,
        name: true,
        url: true,
        type: true,
        isMaintenance: true,
        downSince: true,
        lastAlertAt: true,
        alertCount: true,
      },
    })
  } catch (err) {
    console.error(
      '[health] failed to read server for one-off probe:',
      err instanceof Error ? err.message : err,
    )
    return
  }
  if (!row) return

  const now = new Date()
  const result = await probeServer(row.url, row.type)

  // Force-check participates in the alert state machine; create does not.
  const { update, event } = opts.alert
    ? classifyTransition(row, result, now)
    : { update: null, event: null }

  try {
    await db
      .update(servers)
      .set({
        lastPingAt: now,
        lastPingOk: result.ping.ok,
        lastPingMs: result.ping.ms,
        lastComfyAt: result.comfy !== null ? now : undefined,
        lastComfyOk: result.comfy !== null ? result.comfy.ok : undefined,
        ...(update
          ? {
              downSince: update.downSince,
              lastAlertAt: update.lastAlertAt,
              alertCount: update.alertCount,
            }
          : {}),
      })
      .where(eq(servers.id, row.id))
    const comfyStr = result.comfy !== null ? `, comfy: ${result.comfy.ok ? 'up' : 'down'}` : ''
    console.log(
      `[health] one-off probe of ${row.url}: ping ${result.ping.ok ? 'up' : 'down'}${comfyStr}`,
    )
  } catch (err) {
    // If we couldn't persist the new alert state, don't send the alert either —
    // otherwise DB and Discord diverge and the next sync re-fires.
    console.error(
      `[health] DB write failed for one-off probe of ${row.url}:`,
      err instanceof Error ? err.message : err,
    )
    return
  }

  if (event) {
    await recordServerAlerts([event])
    try {
      await sendServerStatusAlert([event])
      console.log(`[health] discord alert sent (force check): ${event.kind} — ${row.name}`)
    } catch (err) {
      console.error(
        '[health] discord alert failed (force check):',
        err instanceof Error ? err.message : err,
      )
    }
  }
}

type HealthRow = {
  id: string
  name: string
  url: string
  type: string
  isMaintenance: boolean
  downSince: Date | null
  lastAlertAt: Date | null
  alertCount: number
}

type AlertUpdate = {
  downSince: Date | null
  lastAlertAt: Date | null
  alertCount: number
}

// Returns the alert state mutation for this server (or null if no change) and
// optionally an event to broadcast to Discord.
function classifyTransition(
  row: HealthRow,
  result: ProbeResult,
  now: Date,
): { update: AlertUpdate | null; event: ServerAlertEvent | null } {
  const healthy = isHealthy(result)
  const alerting = !row.isMaintenance
  const wasDown = row.downSince !== null

  // Outside alerting mode (in maintenance): silently reset alert state so we
  // don't fire stale reminders when the server comes back out of maintenance.
  if (!alerting) {
    if (wasDown || row.lastAlertAt !== null || row.alertCount !== 0) {
      return {
        update: { downSince: null, lastAlertAt: null, alertCount: 0 },
        event: null,
      }
    }
    return { update: null, event: null }
  }

  if (healthy && !wasDown) {
    return { update: null, event: null }
  }

  if (healthy && wasDown) {
    const downForMs = now.getTime() - row.downSince!.getTime()
    return {
      update: { downSince: null, lastAlertAt: null, alertCount: 0 },
      event: { kind: 'recovered', serverId: row.id, name: row.name, url: row.url, downForMs },
    }
  }

  // Server is unhealthy from here down.
  if (!wasDown) {
    return {
      update: { downSince: now, lastAlertAt: now, alertCount: 1 },
      event: {
        kind: 'down',
        serverId: row.id,
        name: row.name,
        url: row.url,
        reason: downReason(result),
      },
    }
  }

  // Already down — check if the next reminder is due.
  const sinceLast = row.lastAlertAt ? now.getTime() - row.lastAlertAt.getTime() : Infinity
  if (sinceLast >= nextAlertDelayMs(row.alertCount)) {
    const nextCount = row.alertCount + 1
    const downForMs = now.getTime() - row.downSince!.getTime()
    return {
      update: { downSince: row.downSince, lastAlertAt: now, alertCount: nextCount },
      event: {
        kind: 'still_down',
        serverId: row.id,
        name: row.name,
        url: row.url,
        downForMs,
        reminder: nextCount,
      },
    }
  }

  return { update: null, event: null }
}

/** A row's URL has no port → it's a host record. Anything with a port (or
 *  that fails to parse — treated separately downstream) is a service. */
function isHostRow(r: HealthRow): boolean {
  try {
    return !new URL(r.url).port
  } catch {
    return false
  }
}

/** Parse a row's hostname; returns null if the URL can't be parsed. */
function hostnameOf(r: HealthRow): string | null {
  try {
    return new URL(r.url).hostname
  } catch {
    return null
  }
}

/** Synthetic "down because the host is down" probe result. Used to mark the
 *  services on a downed host as offline in the UI without sending a per-
 *  service alert (the host's alert is the parent signal). */
const SYNTHETIC_HOST_DOWN: ProbeResult = { ping: { ok: false, ms: null }, comfy: null }

type WriteRow = {
  id: string
  name: string
  url: string
  lastPingAt: Date
  lastPingOk: boolean
  lastPingMs: number | null
  lastComfyAt: Date | null
  lastComfyOk: boolean | null
  downSince: Date | null
  lastAlertAt: Date | null
  alertCount: number
}

function buildWrite(
  row: HealthRow,
  result: ProbeResult,
  update: AlertUpdate | null,
  now: Date,
): WriteRow {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    lastPingAt: now,
    lastPingOk: result.ping.ok,
    lastPingMs: result.ping.ms,
    lastComfyAt: result.comfy !== null ? now : null,
    lastComfyOk: result.comfy !== null ? result.comfy.ok : null,
    downSince: update ? update.downSince : row.downSince,
    lastAlertAt: update ? update.lastAlertAt : row.lastAlertAt,
    alertCount: update ? update.alertCount : row.alertCount,
  }
}

export async function syncServerHealth(): Promise<void> {
  let rows: HealthRow[]
  try {
    rows = await db.query.servers.findMany({
      where: (s, { eq }) => eq(s.isMonitored, true),
      columns: {
        id: true,
        name: true,
        url: true,
        type: true,
        isMaintenance: true,
        downSince: true,
        lastAlertAt: true,
        alertCount: true,
      },
    })
  } catch (err) {
    console.error(
      '[health] failed to read servers from DB:',
      err instanceof Error ? err.message : err,
    )
    return
  }

  // ── Group rows into host/service clusters by hostname ──────────
  // The port-less record on a hostname is the host; the rest are services
  // running on it. Rows whose URL won't parse are handled as standalone.
  type Cluster = { hostname: string; host: HealthRow | null; services: HealthRow[] }
  const clusters = new Map<string, Cluster>()
  const standalone: HealthRow[] = []
  for (const r of rows) {
    const hn = hostnameOf(r)
    if (!hn) {
      standalone.push(r)
      continue
    }
    const c = clusters.get(hn) ?? { hostname: hn, host: null, services: [] }
    if (isHostRow(r)) c.host = r
    else c.services.push(r)
    clusters.set(hn, c)
  }

  const start = Date.now()
  const now = new Date()
  const events: ServerAlertEvent[] = []
  const writes: WriteRow[] = []

  let probesPerformed = 0
  let skippedMaintenance = 0
  let servicesDownByHost = 0
  let pingUpCount = 0
  let comfyUpCount = 0
  let comfyTotal = 0

  function recordProbe(row: HealthRow, result: ProbeResult) {
    probesPerformed++
    if (result.ping.ok) pingUpCount++
    if (result.comfy !== null) {
      comfyTotal++
      if (result.comfy.ok) comfyUpCount++
    }
    const { update, event } = classifyTransition(row, result, now)
    writes.push(buildWrite(row, result, update, now))
    if (event) events.push(event)
  }

  // ── Probe each cluster (host then services) in parallel ────────
  await Promise.all(
    [...clusters.values()].map(async ({ host, services }) => {
      // 1. Host (port-less) — its result decides whether services get probed.
      let hostUp: boolean | null = null

      if (host) {
        if (host.isMaintenance) {
          // Maintenance is total skip for the host and every service on it.
          // No probe, no write, no alert — exactly as the user requested.
          skippedMaintenance += 1 + services.length
          return
        }
        const result = await probeServer(host.url, host.type)
        hostUp = isHealthy(result)
        recordProbe(host, result)
      }

      // 2. Services on this hostname.
      //    • Host down  → mark service offline synthetically (no alert, no
      //                   per-service down state mutation).
      //    • Host up or absent → probe normally.
      //    • Service in maintenance → skip entirely (no probe, no write).
      for (const svc of services) {
        if (svc.isMaintenance) {
          skippedMaintenance++
          continue
        }

        if (host && hostUp === false) {
          // Inherit "offline" from the host. Persist `lastPingOk: false` so the
          // UI shows the service as down too, but pass `null` for the alert
          // update so its downSince / alertCount aren't touched — the host's
          // alert is the canonical signal here.
          writes.push(buildWrite(svc, SYNTHETIC_HOST_DOWN, null, now))
          servicesDownByHost++
          continue
        }

        const result = await probeServer(svc.url, svc.type)
        recordProbe(svc, result)
      }
    }),
  )

  // ── Standalone records (URL parse failed) ──────────────────────
  await Promise.all(
    standalone.map(async (r) => {
      if (r.isMaintenance) {
        skippedMaintenance++
        return
      }
      const result = await probeServer(r.url, r.type)
      recordProbe(r, result)
    }),
  )

  if (writes.length === 0) {
    console.log(
      `[health] no records to probe${skippedMaintenance > 0 ? ` (${skippedMaintenance} in maintenance)` : ''}`,
    )
    return
  }

  // One batched write instead of an UPDATE per server — far gentler on the
  // connection pool. INSERT…ON CONFLICT updates the existing rows; the comfy
  // columns coalesce so a non-workflow probe (null) leaves them untouched.
  let writeOk = true
  try {
    await db
      .insert(servers)
      .values(writes)
      .onConflictDoUpdate({
        target: servers.id,
        set: {
          lastPingAt: sql`excluded.last_ping_at`,
          lastPingOk: sql`excluded.last_ping_ok`,
          lastPingMs: sql`excluded.last_ping_ms`,
          lastComfyAt: sql`coalesce(excluded.last_comfy_at, servers.last_comfy_at)`,
          lastComfyOk: sql`coalesce(excluded.last_comfy_ok, servers.last_comfy_ok)`,
          downSince: sql`excluded.down_since`,
          lastAlertAt: sql`excluded.last_alert_at`,
          alertCount: sql`excluded.alert_count`,
        },
      })
  } catch (err) {
    writeOk = false
    console.error('[health] batched DB write failed:', err instanceof Error ? err.message : err)
  }

  if (events.length > 0) {
    const downN = events.filter((e) => e.kind === 'down').length
    const upN = events.filter((e) => e.kind === 'recovered').length
    const remN = events.filter((e) => e.kind === 'still_down').length
    // Persist first (calendar timeline), then notify (Discord).
    await recordServerAlerts(events)
    try {
      await sendServerStatusAlert(events)
      console.log(`[health] discord alert sent: ${downN} down, ${upN} recovered, ${remN} reminders`)
    } catch (err) {
      console.error('[health] discord alert failed:', err instanceof Error ? err.message : err)
    }
  }

  const elapsed = Date.now() - start
  const comfyStr = comfyTotal > 0 ? `, comfy ${comfyUpCount}/${comfyTotal} up` : ''
  const skipStr = skippedMaintenance > 0 ? `, ${skippedMaintenance} skipped (maintenance)` : ''
  const inhStr = servicesDownByHost > 0 ? `, ${servicesDownByHost} services down-by-host` : ''
  console.log(
    `[health] probed ${probesPerformed} records in ${elapsed}ms — ping ${pingUpCount}/${probesPerformed} up${comfyStr}${inhStr}${skipStr}${writeOk ? '' : ' — DB WRITE FAILED'}`,
  )
}
