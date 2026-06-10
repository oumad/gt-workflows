import { eq, sql } from 'drizzle-orm'
import { execFile } from 'node:child_process'
import { Socket } from 'node:net'
import { db, servers } from '../db/index.js'
import { config } from '../config/index.js'
import { sendServerStatusAlert, type ServerAlertEvent } from '../lib/discord.js'
import { recordServerAlerts } from './alerts.js'
import { internalFetch } from '../lib/proxy.js'

// Per-record health monitoring. Two kinds of record, distinguished by URL shape,
// each checked by its OWN method — they are NOT coupled:
//
//   • Server (host)   — port-less URL, e.g. http://worker-03
//                       → ICMP ping. If ICMP is unavailable in this container
//                         (no NET_RAW / no `ping` binary), fall back to a TCP
//                         connect — a connect OR a refused connection both prove
//                         the box is alive.
//   • Service         — URL with a port, e.g. http://worker-03:8188
//                       → HTTP reachability of the service's own endpoint:
//                         workflow → ComfyUI    GET /system_stats
//                         lora     → AI-Toolkit GET /api/gpu
//
// A service's health depends only on whether ITS endpoint answers — never on a
// separate host record's ping. (An earlier version inherited "down" from the
// host, which silently marked healthy services offline whenever the host's own
// probe failed — that coupling is gone.) Every monitored record is probed
// independently, in parallel, on each sync tick.
//
// Recovery is handled per record via classifyTransition's `downSince` state
// machine, so a record coming back up emits a 'recovered' event.

// Per-check timeouts. MONITOR_TIMEOUT_MS (default 5s) is the overall budget;
// ICMP and TCP get tighter slices so a fully-unreachable host resolves without
// stacking the full budget twice over.
const PROBE_TIMEOUT_MS = config.MONITOR_TIMEOUT_MS
const ICMP_TIMEOUT_MS = Math.min(PROBE_TIMEOUT_MS, 2_000)
const TCP_TIMEOUT_MS = Math.min(PROBE_TIMEOUT_MS, 3_000)
const SERVICE_TIMEOUT_MS = PROBE_TIMEOUT_MS

// Once we learn ICMP can't be used here (binary missing, or no permission to
// open a raw socket), stop spawning `ping` on every probe and go straight to
// the TCP fallback. A firewall that merely drops echo requests still leaves
// ICMP "usable" (the binary runs, it just times out) — that case keeps trying.
let icmpUsable = true

// Re-alert cadence: the "down" alert fires instantly (on the first probe that
// sees the record unreachable). Reminders then go out at widening gaps —
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

type HostReach = { reachable: boolean; rttMs: number | null; via: 'icmp' | 'tcp' | null }

// Unified probe outcome. `kind` records which check ran (a server's ping vs a
// service's HTTP reachability) so messaging/logging can be specific.
type ProbeResult = {
  ok: boolean
  ms: number | null
  via: 'icmp' | 'tcp' | 'http' | null
  kind: 'ping' | 'service'
}

// Service health endpoint per server type — the cheap, always-present path that
// proves the process is actually serving (not just that the port is open).
const SERVICE_PATH: Record<string, string> = {
  workflow: '/system_stats', // ComfyUI
  lora: '/api/gpu', // AI-Toolkit
}

/** ICMP echo via the system `ping` binary. Cross-platform arg shapes.
 *  `available:false` means ICMP can't be used here (missing binary / no raw-
 *  socket permission) so the caller falls back to TCP rather than trusting a
 *  spurious "down". A firewall that just drops echoes still reports available. */
function icmpPing(
  host: string,
  timeoutMs: number,
): Promise<{ ok: boolean; rttMs: number | null; available: boolean }> {
  const isWin = process.platform === 'win32'
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000))
  const args = isWin
    ? ['-n', '1', '-w', String(timeoutMs), host]
    : ['-c', '1', '-W', String(timeoutSec), host]
  return new Promise((resolve) => {
    execFile(
      'ping',
      args,
      { timeout: timeoutMs + 1_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException
          const blob = `${e.code ?? ''} ${err.message ?? ''} ${stderr ?? ''}`.toLowerCase()
          // Missing binary or no permission to open an ICMP socket → unavailable.
          // A plain non-zero exit (numeric code) is a genuine "host down".
          const unavailable =
            e.code === 'ENOENT' || /not permitted|permission denied|socket:/.test(blob)
          return resolve({ ok: false, rttMs: null, available: !unavailable })
        }
        // Windows `ping` exits 0 even on failure — confirm via output.
        if (isWin && /unreachable|timed out|100% loss/i.test(stdout)) {
          return resolve({ ok: false, rttMs: null, available: true })
        }
        const m = stdout.match(/time[=<]\s*([\d.]+)\s*ms/i)
        resolve({ ok: true, rttMs: m ? Math.round(Number(m[1])) : null, available: true })
      },
    )
  })
}

/** TCP connect fallback for the host ping. A successful connect OR a
 *  refused/reset connection both prove the host is alive (its stack answered);
 *  only a timeout / unreachable error means down. Needs no special capability. */
function tcpConnect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ reachable: boolean; rttMs: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = new Socket()
    let settled = false
    const done = (reachable: boolean) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve({ reachable, rttMs: reachable ? Date.now() - start : null })
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', (err: NodeJS.ErrnoException) =>
      done(err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET'),
    )
    sock.connect(port, host)
  })
}

// Ports the TCP fallback tries when ICMP can't confirm a host. A connect OR a
// refused connection on ANY of them proves the box is alive; we only declare it
// down when every port times out / is unreachable. Mixes common service +
// management ports so a host with ICMP filtered still resolves.
const TCP_FALLBACK_PORTS = [80, 443, 22, 3389, 8188]

/** Server (host) reachability — ICMP first; on failure/unavailability fall back
 *  to TCP connects across a few common ports (in parallel) so a host with ICMP
 *  blocked still reports up when its stack answers on any of them. */
async function checkHostReachable(hostname: string): Promise<HostReach> {
  if (icmpUsable) {
    const icmp = await icmpPing(hostname, ICMP_TIMEOUT_MS)
    if (icmp.ok) return { reachable: true, rttMs: icmp.rttMs, via: 'icmp' }
    if (!icmp.available) icmpUsable = false // learn once; skip ICMP from now on
  }
  const results = await Promise.all(
    TCP_FALLBACK_PORTS.map((p) => tcpConnect(hostname, p, TCP_TIMEOUT_MS)),
  )
  const hit = results.find((r) => r.reachable)
  return hit
    ? { reachable: true, rttMs: hit.rttMs, via: 'tcp' }
    : { reachable: false, rttMs: null, via: null }
}

/** Service reachability — is the service answering HTTP on its own port?
 *  Lenient: any 2xx/3xx response means the process is up and serving.
 *
 *  By default uses a direct (no-proxy) dispatcher so internal probe targets
 *  never traverse the corporate HTTP_PROXY — operator NO_PROXY lists rarely
 *  cover bare hostnames or IPs like `worker-03:8188` / `10.0.0.5:8188`, which
 *  would otherwise route through the proxy and fail. Set MONITOR_USE_PROXY=true
 *  to flip back to global-dispatcher behavior if your probes genuinely need
 *  the corporate proxy.
 *
 *  When MONITOR_VERBOSE=true, every probe logs its target, duration, and
 *  failure reason — invaluable when "server shows down but I can reach it". */
async function checkServiceReachable(
  base: string,
  type: string,
): Promise<{ ok: boolean; ms: number | null }> {
  const path = SERVICE_PATH[type] ?? ''
  const url = `${base}${path}`
  const start = Date.now()
  try {
    // internalFetch goes direct by default and honors MONITOR_USE_PROXY —
    // the routing policy lives in lib/proxy.ts so every ComfyUI/AI-Toolkit
    // call (probes, logs, actions, workflow tests) behaves identically.
    const res = await internalFetch(url, { timeoutMs: SERVICE_TIMEOUT_MS })
    await res.body?.cancel().catch(() => {})
    const ms = Date.now() - start
    if (config.MONITOR_VERBOSE) {
      console.log(
        `[health.probe] service ${url} -> ${res.status}${res.ok ? '' : ' (treated as down)'} in ${ms}ms (proxy=${config.MONITOR_USE_PROXY})`,
      )
    }
    // Require a 2xx/3xx — a 4xx/5xx means the port answers but the service
    // isn't actually serving (wrong process, crashed handler, auth wall).
    return { ok: res.ok, ms: res.ok ? ms : null }
  } catch (err) {
    if (config.MONITOR_VERBOSE) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      console.warn(
        `[health.probe] service ${url} FAILED in ${Date.now() - start}ms (proxy=${config.MONITOR_USE_PROXY}): ${reason}`,
      )
    }
    return { ok: false, ms: null }
  }
}

/** Probe one record by its kind: port-less → server ping; ported → service
 *  HTTP reachability. The two are fully independent. */
async function probeRecord(url: string, type: string): Promise<ProbeResult> {
  const base = url.replace(/\/+$/, '')
  let hostname: string
  let port: number | null
  try {
    const u = new URL(base)
    hostname = u.hostname
    port = u.port ? Number(u.port) : null
  } catch {
    return { ok: false, ms: null, via: null, kind: 'ping' }
  }

  if (port === null) {
    const r = await checkHostReachable(hostname)
    return { ok: r.reachable, ms: r.rttMs, via: r.via, kind: 'ping' }
  }
  const r = await checkServiceReachable(base, type)
  return { ok: r.ok, ms: r.ms, via: r.ok ? 'http' : null, kind: 'service' }
}

function isHealthy(r: ProbeResult): boolean {
  return r.ok
}

function downReason(r: ProbeResult, type: string): string {
  if (r.kind === 'service') {
    return type === 'lora' ? 'AI-Toolkit not responding' : 'ComfyUI not responding'
  }
  return 'host unreachable (no ping response)'
}

// Probe a single server immediately — used on server create and by the manual
// "force check" endpoint. Best-effort: errors are logged, never thrown.
//
// When `alert` is true the probe joins the same down/recovered/reminder state
// machine the scheduled sync uses (classifyTransition) and fires a Discord
// alert on a status change — so force-checking a record that just came back up
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
  const result = await probeRecord(row.url, row.type)

  // Force-check participates in the alert state machine; create does not.
  const { update, event } = opts.alert
    ? classifyTransition(row, result, now)
    : { update: null, event: null }

  try {
    await db
      .update(servers)
      .set({
        lastPingAt: now,
        lastPingOk: result.ok,
        lastPingMs: result.ms,
        ...(update
          ? {
              downSince: update.downSince,
              lastAlertAt: update.lastAlertAt,
              alertCount: update.alertCount,
            }
          : {}),
      })
      .where(eq(servers.id, row.id))
    const viaStr = result.via ? ` (via ${result.via})` : ''
    console.log(
      `[health] one-off probe of ${row.url}: ${result.kind} ${result.ok ? 'up' : 'down'}${viaStr}`,
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

// Returns the alert state mutation for this record (or null if no change) and
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
  // don't fire stale reminders when the record comes back out of maintenance.
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

  // Record is unhealthy from here down.
  if (!wasDown) {
    return {
      update: { downSince: now, lastAlertAt: now, alertCount: 1 },
      event: {
        kind: 'down',
        serverId: row.id,
        name: row.name,
        url: row.url,
        reason: downReason(result, row.type),
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

type WriteRow = {
  id: string
  name: string
  url: string
  lastPingAt: Date
  lastPingOk: boolean
  lastPingMs: number | null
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
    lastPingOk: result.ok,
    lastPingMs: result.ms,
    downSince: update ? update.downSince : row.downSince,
    lastAlertAt: update ? update.lastAlertAt : row.lastAlertAt,
    alertCount: update ? update.alertCount : row.alertCount,
  }
}

export async function syncServerHealth(): Promise<void> {
  let rows: HealthRow[]
  try {
    // Every server is monitored — maintenance is the only opt-out, and that's
    // handled per-record below (skipped, not probed, no alert).
    rows = await db.query.servers.findMany({
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

  const start = Date.now()
  const now = new Date()
  const events: ServerAlertEvent[] = []
  const writes: WriteRow[] = []

  let probesPerformed = 0
  let skippedMaintenance = 0
  let upCount = 0

  // Every monitored record is probed independently, in parallel — servers by
  // ping, services by their own HTTP reachability. No host→service coupling.
  await Promise.all(
    rows.map(async (row) => {
      if (row.isMaintenance) {
        skippedMaintenance++
        return
      }
      const result = await probeRecord(row.url, row.type)
      probesPerformed++
      if (result.ok) upCount++
      const { update, event } = classifyTransition(row, result, now)
      writes.push(buildWrite(row, result, update, now))
      if (event) events.push(event)
    }),
  )

  if (writes.length === 0) {
    console.log(
      `[health] no records to probe${skippedMaintenance > 0 ? ` (${skippedMaintenance} in maintenance)` : ''}`,
    )
    return
  }

  // One batched write instead of an UPDATE per record — far gentler on the
  // connection pool. INSERT…ON CONFLICT updates the existing rows.
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
  const skipStr = skippedMaintenance > 0 ? `, ${skippedMaintenance} skipped (maintenance)` : ''
  console.log(
    `[health] probed ${probesPerformed} records in ${elapsed}ms — ${upCount}/${probesPerformed} up${skipStr}${writeOk ? '' : ' — DB WRITE FAILED'}`,
  )
}
