/**
 * Business logic for servers — list/get with derived health + job counts,
 * CRUD, insights/incidents/repartition, the workflow+history scrape, and
 * the Discord report. ComfyUI proxy actions live in services/serverComfy.ts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config/index.js'
import { serverMatchKey } from '../lib/serverUrl.js'
import { sendServerReport } from '../lib/discord.js'
import { probeOneServer } from './serverHealth.js'
import { notFound, conflict, internalError } from '../lib/httpError.js'
import * as repo from '../repositories/servers.js'
import type {
  ServerHealth,
  ServerWithCounts,
  ServerWithWorkflows,
  ServerInsight,
  IncidentsResponse,
  IncidentAggServer,
  IncidentRow,
  RepartitionResponse,
  RepartitionWorkflow,
  ServerJobsResponse,
  ServerStats24h,
  ScrapeResult,
} from '../models/servers.js'
import type { Server } from '../db/schema.js'
import type {
  CreateServerInput,
  PatchServerInput,
  ReportServerInput,
} from '../validators/servers.js'

// Treat a ping as a fresh signal if it landed within the staleness window.
// Older than this and we say 'unknown' so the UI doesn't claim 'online'
// for a server we haven't actually heard from in a while.
const PING_STALE_MS = 3 * 60 * 1000

export function deriveHealth(row: Server): ServerHealth | null {
  if (!row.lastPingAt) return null
  const age = Date.now() - row.lastPingAt.getTime()
  if (age > PING_STALE_MS) {
    return {
      status: 'unknown',
      latencyMs: null,
      lastPingAt: row.lastPingAt.toISOString(),
      comfyOk: null,
    }
  }
  // A record's health is its own probe: a server's ping, or a service's HTTP
  // reachability — both land in lastPingOk. Online when the last probe passed.
  return {
    status: row.lastPingOk ? 'online' : 'offline',
    latencyMs: row.lastPingOk ? row.lastPingMs : null,
    lastPingAt: row.lastPingAt.toISOString(),
    comfyOk: null,
  }
}

function getWorkflowsDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url))
  return resolve(
    config.WORKFLOWS_DIR.startsWith('/') || /^[A-Z]:/.test(config.WORKFLOWS_DIR)
      ? config.WORKFLOWS_DIR
      : join(here, '../../../', config.WORKFLOWS_DIR),
  )
}

/* ─── List / get ─────────────────────────────────────────────── */

export async function listServers(): Promise<ServerWithCounts[]> {
  const rows = await repo.findAll()
  if (rows.length === 0) return []

  const wfIds = rows.filter((s) => s.type !== 'lora').map((s) => s.id)
  const loraIds = rows.filter((s) => s.type === 'lora').map((s) => s.id)
  const counts = await repo.liveCountsByServer(wfIds, loraIds)

  return rows.map((s) => {
    const c = counts.get(s.id) ?? { active: 0, waiting: 0 }
    return { ...s, health: deriveHealth(s), activeJobs: c.active, waitingJobs: c.waiting }
  })
}

export async function getServer(id: string): Promise<ServerWithWorkflows> {
  const row = await repo.findById(id)
  if (!row) throw notFound('Server not found')
  const serverWorkflows = await repo.workflowsAssignedToServer(id)
  return { ...row, health: deriveHealth(row), workflows: serverWorkflows }
}

export async function getServerJobs(id: string): Promise<ServerJobsResponse> {
  const row = await repo.findById(id)
  if (!row) throw notFound('Server not found')

  if (row.type === 'lora') {
    const jobs = await repo.loraJobsForServer(id)
    return {
      type: 'lora',
      active: jobs.filter((j) => j.status === 'running'),
      waiting: jobs.filter((j) => j.status === 'pending'),
    }
  }
  const jobs = await repo.workflowJobsForServer(id)
  return {
    type: 'workflow',
    active: jobs.filter((j) => j.status === 'active'),
    waiting: jobs.filter((j) => j.status === 'waiting'),
  }
}

/* ─── Insights / incidents / repartition ─────────────────────── */

export async function getInsights(days: number): Promise<ServerInsight[]> {
  const rows = await repo.findAllIdNameType()
  const stats = await repo.insightStatsByServer(days)

  const byId = new Map<
    string,
    { totalJobs: number; completed: number; failed: number; avgDuration: number | null }
  >()
  for (const s of stats) {
    if (s.serverId) {
      byId.set(s.serverId, {
        totalJobs: s.totalJobs ?? 0,
        completed: s.completed ?? 0,
        failed: s.failed ?? 0,
        avgDuration: s.avgDuration ?? null,
      })
    }
  }

  return rows.map((r) => {
    const v = byId.get(r.id) ?? { totalJobs: 0, completed: 0, failed: 0, avgDuration: null }
    return {
      serverId: r.id,
      serverName: r.name,
      totalJobs: v.totalJobs,
      avgSec: v.avgDuration ?? 0,
      failPct: v.totalJobs > 0 ? (v.failed / v.totalJobs) * 100 : 0,
      successPct: v.totalJobs > 0 ? (v.completed / v.totalJobs) * 100 : 0,
    }
  })
}

export async function getIncidents(days: number | null): Promise<IncidentsResponse> {
  const aggRows = (await repo.incidentAggregate(days)) as unknown as Array<{
    server_id: string | null
    server_name: string | null
    incidents: number
    recoveries: number
    total_downtime_ms: string | number
    mttr_ms: string | number | null
    last_alert_at: string | Date | null
  }>
  const incidentServers: IncidentAggServer[] = aggRows.map((r) => ({
    serverId: r.server_id,
    serverName: r.server_name ?? '(unknown)',
    incidents: r.incidents,
    recoveries: r.recoveries,
    totalDowntimeMs: Number(r.total_downtime_ms ?? 0),
    mttrMs: r.mttr_ms != null ? Number(r.mttr_ms) : null,
    lastAlertAt: r.last_alert_at ? new Date(r.last_alert_at).toISOString() : null,
  }))

  const recentRows = (await repo.incidentRecent(days)) as unknown as Array<{
    id: string
    kind: string
    severity: string
    title: string
    body: string | null
    server_id: string | null
    server_name: string | null
    downtime_ms: string | number | null
    created_at: string | Date
  }>
  const recent: IncidentRow[] = recentRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    serverId: r.server_id,
    serverName: r.server_name,
    downtimeMs: r.downtime_ms != null ? Number(r.downtime_ms) : null,
    createdAt: new Date(r.created_at).toISOString(),
  }))

  return { rangeDays: days, servers: incidentServers, recent }
}

export async function getRepartition(days: number): Promise<RepartitionResponse> {
  const [perServer, perWorkflow] = await Promise.all([
    repo.repartitionPerServer(days),
    repo.repartitionPerWorkflow(days),
  ])

  const wfByServer = new Map<string, RepartitionWorkflow[]>()
  for (const r of perWorkflow) {
    if (!r.serverId) continue
    const list = wfByServer.get(r.serverId) ?? []
    list.push({
      workflowId: r.workflowId,
      workflowName: r.workflowName,
      jobs: r.jobs,
      users: r.users,
      avgSec: r.avgSec,
    })
    wfByServer.set(r.serverId, list)
  }
  for (const list of wfByServer.values()) list.sort((a, b) => b.jobs - a.jobs)

  return {
    rangeDays: 30,
    servers: perServer
      .filter((r) => r.serverId != null)
      .map((r) => ({
        serverId: r.serverId!,
        totalJobs: r.totalJobs,
        distinctUsers: r.users,
        avgSec: r.avgSec,
        avgWaitSec: r.avgWaitSec,
        workflows: wfByServer.get(r.serverId!) ?? [],
      })),
  }
}

export async function getStats24h(id: string): Promise<ServerStats24h> {
  const row = await repo.findIdAndType(id)
  if (!row) throw notFound('Server not found')
  return row.type === 'lora' ? repo.stats24hLora(id) : repo.stats24hWorkflow(id)
}

/* ─── Scrape (rebuild servers + services from history) ───────── */

/** Strict URL parse for scraping. Returns null when the URL isn't usable:
 *  - non-http(s) scheme (`new URL('x1287706://')` parses fine in Node with
 *    hostname='' and a custom protocol — we hit this in the wild)
 *  - empty / whitespace-only hostname
 *  - hostname that looks like a port-only fragment (`:8188`)
 *  Returns the canonical URL string (no trailing slash, lowercased host)
 *  so two callers that pass minor variants collide on dedup. */
function parseScrapedUrl(
  raw: string,
): { hostUrl: string; serviceUrl: string; hostname: string; port: string | null } | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  // Enforce http(s) — silently rejects garbage like `x1287706://`, file://,
  // ws://, and anything else that isn't a coffee-maker target.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const hostname = u.hostname.trim().toLowerCase()
  if (!hostname) return null
  // Defensive: a hostname that looks like a bare port (':8188' arriving as
  // `http://:8188`) parses with hostname '' so we never get here, but if a
  // future URL parser is more permissive, reject hostnames that are entirely
  // digits-or-colons.
  if (/^[\d:]+$/.test(hostname)) return null
  const port = u.port || null
  const hostUrl = `${u.protocol}//${hostname}`
  const serviceUrl = port ? `${hostUrl}:${port}` : hostUrl
  return { hostUrl, serviceUrl, hostname, port }
}

/** Display name for a service record. Always hostname or hostname:port —
 *  never empty (parseScrapedUrl guarantees a non-empty hostname). */
function serviceNameFor(parsed: { hostname: string; port: string | null }): string {
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
}

export async function scrapeServers(): Promise<ScrapeResult> {
  type Found = {
    url: string // canonical http://host:port (no trailing slash)
    type: 'workflow' | 'lora'
    name: string
  }

  // Keyed by serverMatchKey so `http://x:8188/`, `http://X:8188`, and `x:8188`
  // all collide before they ever reach the existing-rows check. Previously
  // they were keyed by raw URL, which created spurious duplicates.
  const services = new Map<string, Found>()
  // Counters for skipped inputs so the operator knows scraping found data
  // it couldn't use (typical cause: legacy `x1287706://` host strings).
  let invalidUrls = 0
  let emptyNames = 0

  const addService = (rawUrl: string, type: 'workflow' | 'lora') => {
    const parsed = parseScrapedUrl(rawUrl)
    if (!parsed) {
      invalidUrls++
      return
    }
    const name = serviceNameFor(parsed)
    if (!name) {
      // Should be unreachable given parseScrapedUrl's guarantees — counted
      // here as a belt-and-braces signal in case validation regresses.
      emptyNames++
      return
    }
    const key = serverMatchKey(parsed.serviceUrl)
    const existing = services.get(key)
    if (existing) {
      // Job rows win the type race over params.json (wf rows are inserted
      // first below), and within the job rows the first writer wins. The
      // explicit check keeps that contract regardless of insertion order.
      if (existing.type === 'lora' && type === 'workflow') {
        services.set(key, { ...existing, type })
      }
      return
    }
    services.set(key, { url: parsed.serviceUrl, type, name })
  }

  // 1. workflow_jobs
  const wfRows = await repo.distinctWorkflowJobUrls()
  for (const r of wfRows) {
    if (r.url) addService(r.url, 'workflow')
  }

  // 2. training_jobs
  const loraRows = await repo.distinctTrainingJobUrls()
  for (const r of loraRows) {
    if (r.url) addService(r.url, 'lora')
  }

  // 3. workflow/<id>/params.json
  const dir = getWorkflowsDir()
  if (existsSync(dir)) {
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'script')
      .forEach((entry) => {
        const p = join(dir, entry.name, 'params.json')
        if (!existsSync(p)) return
        try {
          const params = JSON.parse(readFileSync(p, 'utf-8'))
          const raw: unknown = params.comfyui_config?.serverUrl
          const urls: string[] = Array.isArray(raw)
            ? raw.filter((x): x is string => typeof x === 'string')
            : typeof raw === 'string'
              ? [raw]
              : []
          for (const url of urls) addService(url, 'workflow')

          // Legacy `params.servers` was a list of bare hostnames; we
          // materialise them as host:8188 URLs. Filter aggressively — the
          // wild data has whitespace, empty strings, and stuff like ':8188'
          // sneaking in via `if (!n) continue` which only catches falsy.
          const legacyNames: unknown = params.servers ?? params.serverIds
          if (Array.isArray(legacyNames)) {
            for (const n of legacyNames) {
              if (typeof n !== 'string') continue
              const host = n.trim()
              // Reject anything that's empty, contains spaces, or looks like
              // a bare port specification — same rejection set as the URL
              // parser uses for hostnames.
              if (!host || /\s/.test(host) || /^[\d:]+$/.test(host)) continue
              addService(`http://${host}:8188`, 'workflow')
            }
          }
        } catch {
          // params.json parse failure — silent: a malformed file shouldn't
          // abort the whole scrape across all workflows.
        }
      })
  }

  // ── Derive host (port-less) records — one per unique hostname ──
  // Keyed by serverMatchKey of the host URL so the existing-rows check uses
  // the same key class throughout.
  const hosts = new Map<string, { hostUrl: string; hostname: string }>()
  for (const { url } of services.values()) {
    const parsed = parseScrapedUrl(url)
    if (!parsed) continue // can't happen — services only holds parsed URLs
    const key = serverMatchKey(parsed.hostUrl)
    if (!hosts.has(key)) hosts.set(key, { hostUrl: parsed.hostUrl, hostname: parsed.hostname })
  }

  if (services.size === 0 && hosts.size === 0) {
    return { servers: 0, services: 0, created: 0, found: 0, names: [] }
  }

  const existing = await repo.findAllUrls()
  const existingKeys = new Set(existing.map((s) => serverMatchKey(s.url)))

  const createdHosts: string[] = []
  const createdServices: string[] = []

  // Helper: insert a server and reattach any orphan jobs whose URL matches.
  // The relink mirrors what createServer() does on a manual POST — without
  // it, /repartition keeps showing zeros after a scrape because every
  // orphan job stays at server_id NULL even though the matching server
  // exists now.  Best-effort: a relink failure is logged but doesn't block
  // the insert chain — the row exists, future syncs will pick it up too.
  const insertAndRelink = async (
    args: Parameters<typeof repo.insertServer>[0],
    matchKey: string,
    relinkType: 'workflow' | 'lora',
  ): Promise<boolean> => {
    try {
      await repo.insertServer(args)
    } catch {
      return false // constraint violation — another writer raced us
    }
    try {
      await repo.relinkOrphanJobs(args.id, matchKey, relinkType)
    } catch (err) {
      console.warn(
        `[scrape] orphan job relink for ${args.name} failed:`,
        err instanceof Error ? err.message : err,
      )
    }
    return true
  }

  // Hosts first so when a fresh service inserts immediately after, the
  // findHostFor() lookup the UI runs picks up the new host instead of
  // surfacing an orphan service.
  for (const [key, { hostUrl, hostname }] of hosts) {
    if (existingKeys.has(key)) continue
    const id = crypto.randomUUID()
    const ok = await insertAndRelink(
      {
        id,
        name: hostname,
        url: hostUrl,
        tags: [],
        type: 'workflow',
        isMonitored: false,
      },
      // Host URL has no port; in normal data its match key won't catch
      // workflow_jobs (which carry port-bearing service URLs). The relink
      // still runs because it's cheap and catches the rare legacy training
      // row whose server_url was stored host-only.
      key,
      'workflow',
    )
    if (ok) {
      createdHosts.push(hostname)
      existingKeys.add(key)
    }
  }

  for (const [key, found] of services) {
    if (existingKeys.has(key)) continue
    const id = crypto.randomUUID()
    const ok = await insertAndRelink(
      {
        id,
        name: found.name,
        url: found.url,
        tags: [],
        type: found.type,
        isMonitored: false,
      },
      key,
      found.type,
    )
    if (ok) {
      createdServices.push(found.name)
      existingKeys.add(key)
    }
  }

  // Also relink against servers that *already existed* before this scrape.
  // The orphan situation isn't just "newly-created servers" — historical
  // server rows often have orphan jobs too (e.g. ingest ran before the row,
  // or someone deleted+recreated a server). A single sweep here makes the
  // /repartition view truthful for the whole registered set without
  // requiring the operator to know which rows had the problem.
  try {
    const sweepCount = await repo.relinkAllOrphans()
    if (sweepCount > 0) {
      console.info(`[scrape] swept ${sweepCount} orphan jobs back to their server`)
    }
  } catch (err) {
    console.warn('[scrape] orphan sweep failed:', err instanceof Error ? err.message : err)
  }

  if (invalidUrls > 0 || emptyNames > 0) {
    // Stays in the API log even though the response doesn't carry it — the
    // result type is frozen by the wire contract. Operators see the count
    // in the deploy logs when something looks off.
    console.warn(
      `[scrape] skipped invalid URLs=${invalidUrls} emptyNames=${emptyNames}`,
    )
  }

  return {
    servers: createdHosts.length,
    services: createdServices.length,
    created: createdHosts.length + createdServices.length,
    found: hosts.size + services.size,
    names: [...createdHosts, ...createdServices],
  }
}

/* ─── Create / patch / delete ────────────────────────────────── */

export async function createServer(input: CreateServerInput): Promise<ServerWithCounts> {
  const normalizedUrl = input.url.trim().replace(/\/+$/, '')
  const key = serverMatchKey(normalizedUrl)

  // Dedup: http://x, https://x, x, x/ all collide on the match key. Catch
  // before the unique-on-url constraint would let two spellings coexist.
  const all = await repo.findAllUrls()
  if (all.some((s) => serverMatchKey(s.url) === key)) {
    throw conflict('A server with this URL already exists')
  }

  const inserted = await repo.insertServer({
    ...input,
    url: normalizedUrl,
    tags: input.tags ?? [],
    // Manually-added servers are monitored by default — the operator added it
    // on purpose, so the auto health sync should track it. (Bulk-scraped
    // servers stay unmonitored to avoid alerting on every historical URL;
    // enable them per-record with the monitoring toggle.)
    isMonitored: true,
  })
  if (!inserted) throw internalError('Insert failed')

  // Relink any orphan jobs whose URL matches this server's normalized key.
  // Sync may have written job rows before the server existed, leaving
  // server_id null. Best-effort: log and move on if it fails.
  try {
    const t = inserted.type === 'lora' ? 'lora' : 'workflow'
    await repo.relinkOrphanJobs(inserted.id, key, t)
  } catch (err) {
    console.warn('[servers] orphan job relink failed:', err instanceof Error ? err.message : err)
  }

  // Probe the new server right away so the response carries initial health.
  // Best-effort — we don't fail the create if the probe itself errors.
  await probeOneServer(inserted.id)

  // Re-read so the response includes the now-populated last_ping_* + gpu fields.
  const fresh = await repo.findById(inserted.id)
  const created = fresh ?? inserted
  const counts = await repo.liveCountsFor(created)
  return {
    ...created,
    health: deriveHealth(created),
    activeJobs: counts.active,
    waitingJobs: counts.waiting,
  }
}

export async function patchServer(id: string, input: PatchServerInput): Promise<Server> {
  // Entering maintenance clears the down / alert state, so the server doesn't
  // fire a stale "recovered" alert (with maintenance-inflated downtime) when
  // it is later taken back out of maintenance.
  const maintReset =
    input.isMaintenance === true ? { downSince: null, lastAlertAt: null, alertCount: 0 } : {}
  const row = await repo.updateServer(id, { ...input, ...maintReset, updatedAt: new Date() })
  if (!row) throw notFound('Server not found')
  return row
}

export async function deleteServer(id: string): Promise<void> {
  await repo.deleteServer(id)
}

/* ─── Top users for a server ───────────────────────────────────
 * Identifies the GT users running the most jobs on a given server in the
 * recent past. Used by the "Top users" widget on the server detail page.
 * Counts include all statuses; running/failed/completed broken out per row
 * so ops can quickly spot a user who's flooding failures vs. one running
 * steady-state. The query unions workflow_jobs + training_jobs because a
 * server may host either type. */

export type TopUser = {
  userId: string | null
  userName: string
  total: number
  running: number
  failed: number
  completed: number
  lastAt: string | null
}

import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'

export async function getTopUsers(
  serverId: string,
  opts: { hours: number; limit: number },
): Promise<TopUser[]> {
  const row = await repo.findById(serverId)
  if (!row) throw notFound('Server not found')

  // window is bounded to [1h, 168h] at the route layer.
  const rows = await db.execute(sql`
    WITH combined AS (
      SELECT
        client_id::text AS user_id,
        COALESCE((data->>'userName')::text, '(unknown)') AS user_name,
        status,
        created_at
      FROM workflow_jobs
      WHERE server_id = ${serverId}
        AND created_at > now() - (${opts.hours}::int * interval '1 hour')
      UNION ALL
      SELECT
        client_id::text AS user_id,
        COALESCE(user_name, '(unknown)') AS user_name,
        status,
        created_at
      FROM training_jobs
      WHERE server_id = ${serverId}
        AND created_at > now() - (${opts.hours}::int * interval '1 hour')
    )
    SELECT
      user_id,
      user_name,
      count(*)::int                                           AS total,
      count(*) FILTER (WHERE status IN ('active','running'))::int  AS running,
      count(*) FILTER (WHERE status = 'failed')::int          AS failed,
      count(*) FILTER (WHERE status = 'completed')::int       AS completed,
      max(created_at)                                         AS last_at
    FROM combined
    GROUP BY user_id, user_name
    ORDER BY total DESC
    LIMIT ${opts.limit}
  `)

  return rows.map((r) => ({
    userId: (r['user_id'] as string | null) ?? null,
    userName: (r['user_name'] as string) ?? '(unknown)',
    total: Number(r['total'] ?? 0),
    running: Number(r['running'] ?? 0),
    failed: Number(r['failed'] ?? 0),
    completed: Number(r['completed'] ?? 0),
    lastAt: r['last_at'] ? new Date(r['last_at'] as string | Date).toISOString() : null,
  }))
}

/* ─── Live probe / Discord report ────────────────────────────── */

export async function probeServerNow(id: string): Promise<ServerWithCounts> {
  const row = await repo.findById(id)
  if (!row) throw notFound('Server not found')
  await probeOneServer(row.id, { alert: true })
  const fresh = await repo.findById(id)
  const result = fresh ?? row
  const counts = await repo.liveCountsFor(result)
  return {
    ...result,
    health: deriveHealth(result),
    activeJobs: counts.active,
    waitingJobs: counts.waiting,
  }
}

export async function reportServer(
  id: string,
  input: ReportServerInput,
  reporterUsername: string,
): Promise<void> {
  const row = await repo.findById(id)
  if (!row) throw notFound('Server not found')
  try {
    await sendServerReport({
      serverName: row.name,
      serverUrl: row.url,
      reporter: reporterUsername,
      message: input.message,
    })
  } catch (err) {
    // Log but don't fail the request — the webhook is best-effort.
    console.warn('[discord] webhook failed:', err instanceof Error ? err.message : err)
  }
}
