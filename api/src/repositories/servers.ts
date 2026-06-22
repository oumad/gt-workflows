/**
 * Repository for the servers table + every per-server SQL aggregation the
 * /api/servers routes need (live job counts, incident analytics, repartition,
 * per-server 24h stats). DB-only; no HTTP or business logic.
 */
import { eq, and, inArray, notInArray, desc, sql } from 'drizzle-orm'
import { db, servers, workflowJobs, trainingJobs } from '../db/index.js'
import type { Server } from '../db/schema.js'

export type ServerType = 'workflow' | 'lora'

/* ─── Basic CRUD ─────────────────────────────────────────────── */

export async function findAll(): Promise<Server[]> {
  return db.query.servers.findMany({ orderBy: (s, { asc }) => asc(s.name) })
}

export async function findById(id: string): Promise<Server | undefined> {
  return db.query.servers.findFirst({ where: (s, { eq }) => eq(s.id, id) })
}

export async function findIdAndType(id: string): Promise<{ id: string; type: string } | undefined> {
  return db.query.servers.findFirst({
    where: (s, { eq }) => eq(s.id, id),
    columns: { id: true, type: true },
  })
}

export async function findAllIdNameType(): Promise<{ id: string; name: string; type: string }[]> {
  return db.query.servers.findMany({ columns: { id: true, name: true, type: true } })
}

export async function findAllUrls(): Promise<{ url: string }[]> {
  return db.query.servers.findMany({ columns: { url: true } })
}

export async function insertServer(
  values: typeof servers.$inferInsert,
): Promise<Server | undefined> {
  const [row] = await db.insert(servers).values(values).returning()
  return row
}

export async function updateServer(
  id: string,
  values: Partial<typeof servers.$inferInsert>,
): Promise<Server | undefined> {
  const [row] = await db.update(servers).set(values).where(eq(servers.id, id)).returning()
  return row
}

export async function deleteServer(id: string): Promise<void> {
  await db.delete(servers).where(eq(servers.id, id))
}

export async function updateGpu(id: string, gpu: string): Promise<void> {
  await db.update(servers).set({ gpu }).where(eq(servers.id, id))
}

/* ─── Live job counts (used by /, /:id, /:id/probe) ──────────── */

export type JobCounts = { active: number; waiting: number }

export async function liveCountsFor(server: Pick<Server, 'id' | 'type'>): Promise<JobCounts> {
  if (server.type === 'lora') {
    const r = await db
      .select({
        active: sql<number>`count(*) filter (where status = 'running')::int`,
        waiting: sql<number>`count(*) filter (where status = 'pending')::int`,
      })
      .from(trainingJobs)
      .where(
        and(
          eq(trainingJobs.serverId, server.id),
          notInArray(trainingJobs.status, ['completed', 'failed']),
        ),
      )
    return r[0] ?? { active: 0, waiting: 0 }
  }
  const r = await db
    .select({
      active: sql<number>`count(*) filter (where status = 'active')::int`,
      waiting: sql<number>`count(*) filter (where status = 'waiting')::int`,
    })
    .from(workflowJobs)
    .where(
      and(
        eq(workflowJobs.serverId, server.id),
        notInArray(workflowJobs.status, ['completed', 'failed']),
      ),
    )
  return r[0] ?? { active: 0, waiting: 0 }
}

export async function liveCountsByServer(
  wfIds: string[],
  loraIds: string[],
): Promise<Map<string, JobCounts>> {
  const byServer = new Map<string, JobCounts>()
  if (wfIds.length > 0) {
    const wf = await db
      .select({
        serverId: workflowJobs.serverId,
        active: sql<number>`count(*) filter (where status = 'active')::int`,
        waiting: sql<number>`count(*) filter (where status = 'waiting')::int`,
      })
      .from(workflowJobs)
      .where(
        and(
          inArray(workflowJobs.serverId, wfIds),
          notInArray(workflowJobs.status, ['completed', 'failed']),
        ),
      )
      .groupBy(workflowJobs.serverId)
    for (const c of wf) {
      if (c.serverId) byServer.set(c.serverId, { active: c.active, waiting: c.waiting })
    }
  }
  if (loraIds.length > 0) {
    const lo = await db
      .select({
        serverId: trainingJobs.serverId,
        active: sql<number>`count(*) filter (where status = 'running')::int`,
        waiting: sql<number>`count(*) filter (where status = 'pending')::int`,
      })
      .from(trainingJobs)
      .where(
        and(
          inArray(trainingJobs.serverId, loraIds),
          notInArray(trainingJobs.status, ['completed', 'failed']),
        ),
      )
      .groupBy(trainingJobs.serverId)
    for (const c of lo) {
      if (c.serverId) byServer.set(c.serverId, { active: c.active, waiting: c.waiting })
    }
  }
  return byServer
}

/* ─── Per-server detail queries ──────────────────────────────── */

export async function loraJobsForServer(serverId: string) {
  return db.query.trainingJobs.findMany({
    where: (j, { and, eq, notInArray }) =>
      and(eq(j.serverId, serverId), notInArray(j.status, ['completed', 'failed'])),
    with: { client: { columns: { id: true, name: true, email: true } } },
    orderBy: [desc(trainingJobs.createdAt)],
    limit: 100,
  })
}

export async function workflowJobsForServer(serverId: string) {
  return db.query.workflowJobs.findMany({
    where: (j, { and, eq, notInArray }) =>
      and(eq(j.serverId, serverId), notInArray(j.status, ['completed', 'failed'])),
    orderBy: [desc(workflowJobs.createdAt)],
    limit: 100,
  })
}

export async function workflowsAssignedToServer(serverId: string) {
  const wfs = await db.query.workflows.findMany()
  return wfs.filter((w) => w.serverIds.includes(serverId))
}

/* ─── /insights (30d per-server aggregate) ───────────────────── */

export interface InsightStat {
  serverId: string | null
  totalJobs: number
  completed: number
  failed: number
  avgDuration: number | null
}

export async function insightStatsByServer(days: number): Promise<InsightStat[]> {
  const gate = (col = 'created_at') =>
    days > 0
      ? sql`${sql.raw(col)} > now() - (${days}::int * interval '1 day') AND server_id IS NOT NULL`
      : sql`server_id IS NOT NULL`

  const wf = await db
    .select({
      serverId: workflowJobs.serverId,
      totalJobs: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgDuration: sql<number>`round(avg(duration_ms) / 1000)::int`,
    })
    .from(workflowJobs)
    .where(gate('created_at'))
    .groupBy(workflowJobs.serverId)

  const lo = await db
    .select({
      serverId: trainingJobs.serverId,
      totalJobs: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgDuration: sql<number>`round(avg(extract(epoch from (finished_at - started_at))))::int`,
    })
    .from(trainingJobs)
    .where(gate('created_at'))
    .groupBy(trainingJobs.serverId)

  return [...wf, ...lo]
}

/* ─── /incidents (alerts table) ──────────────────────────────── */

export async function incidentAggregate(days: number | null) {
  const since =
    days != null ? sql`WHERE created_at > now() - make_interval(days => ${days})` : sql``
  return db.execute(sql`
    SELECT
      server_id                                                                     AS server_id,
      server_name                                                                   AS server_name,
      count(*) FILTER (WHERE kind = 'server_down')::int                             AS incidents,
      count(*) FILTER (WHERE kind = 'server_recovered')::int                        AS recoveries,
      coalesce(sum(downtime_ms) FILTER (WHERE kind = 'server_recovered'), 0)::bigint AS total_downtime_ms,
      round(avg(downtime_ms) FILTER (WHERE kind = 'server_recovered'))::bigint       AS mttr_ms,
      max(created_at)                                                               AS last_alert_at
    FROM alerts
    ${since}
    GROUP BY server_id, server_name
    ORDER BY incidents DESC, total_downtime_ms DESC
  `)
}

export async function incidentRecent(days: number | null) {
  const since =
    days != null ? sql`WHERE created_at > now() - make_interval(days => ${days})` : sql``
  return db.execute(sql`
    SELECT id, kind, severity, title, body, server_id, server_name, downtime_ms, created_at
    FROM alerts
    ${since}
    ORDER BY created_at DESC
    LIMIT 25
  `)
}

/* ─── /repartition (per-server workflow load) ────────────────── */

export async function repartitionPerServer(days: number) {
  const gate =
    days > 0
      ? sql`created_at > now() - (${days}::int * interval '1 day') AND server_id IS NOT NULL`
      : sql`server_id IS NOT NULL`
  return db
    .select({
      serverId: workflowJobs.serverId,
      totalJobs: sql<number>`count(*)::int`,
      users: sql<number>`count(distinct client_id)::int`,
      avgSec: sql<number>`coalesce(round(avg(duration_ms) / 1000), 0)::int`,
      avgWaitSec: sql<number>`coalesce(round(avg(coalesce(wait_ms, 0) + coalesce(comfy_queue_ms, 0)) / 1000), 0)::int`,
    })
    .from(workflowJobs)
    .where(gate)
    .groupBy(workflowJobs.serverId)
}

export async function repartitionPerWorkflow(days: number) {
  const gate =
    days > 0
      ? sql`created_at > now() - (${days}::int * interval '1 day') AND server_id IS NOT NULL`
      : sql`server_id IS NOT NULL`
  return db
    .select({
      serverId: workflowJobs.serverId,
      workflowId: workflowJobs.workflowId,
      workflowName: workflowJobs.workflowName,
      jobs: sql<number>`count(*)::int`,
      users: sql<number>`count(distinct client_id)::int`,
      avgSec: sql<number>`coalesce(round(avg(duration_ms) / 1000), 0)::int`,
    })
    .from(workflowJobs)
    .where(gate)
    .groupBy(workflowJobs.serverId, workflowJobs.workflowId, workflowJobs.workflowName)
}

/* ─── /:id/stats (24h) ───────────────────────────────────────── */

export async function stats24hLora(serverId: string) {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgWaitMs: sql<number>`round(avg(extract(epoch from (started_at - created_at)) * 1000))::int`,
    })
    .from(trainingJobs)
    .where(and(eq(trainingJobs.serverId, serverId), sql`created_at > now() - interval '24 hours'`))
  return r ?? { total: 0, completed: 0, failed: 0, avgWaitMs: null }
}

export async function stats24hWorkflow(serverId: string) {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgWaitMs: sql<number>`round(avg(wait_ms))::int`,
    })
    .from(workflowJobs)
    .where(and(eq(workflowJobs.serverId, serverId), sql`created_at > now() - interval '24 hours'`))
  return r ?? { total: 0, completed: 0, failed: 0, avgWaitMs: null }
}

/* ─── /scrape source queries + orphan relink ─────────────────── */

export async function distinctWorkflowJobUrls(): Promise<{ url: string | null }[]> {
  return db.selectDistinct({ url: workflowJobs.serverUrl }).from(workflowJobs)
}

export async function distinctTrainingJobUrls(): Promise<{ url: string | null }[]> {
  return db.selectDistinct({ url: trainingJobs.serverUrl }).from(trainingJobs)
}

/** Reattach orphan jobs (server_id NULL but server_url matches the canonical
 *  match key) to a newly-created server. Mirrors serverMatchKey() on the
 *  Postgres side: strip http(s)://, trim trailing slashes, lowercase. */
export async function relinkOrphanJobs(
  serverId: string,
  matchKey: string,
  serverType: ServerType,
): Promise<void> {
  const normalize = sql`lower(regexp_replace(regexp_replace(server_url, '^https?://', ''), '/+$', ''))`
  const target = serverType === 'lora' ? trainingJobs : workflowJobs
  await db
    .update(target)
    .set({ serverId })
    .where(
      and(sql`server_id IS NULL`, sql`server_url IS NOT NULL`, sql`${normalize} = ${matchKey}`),
    )
}

/** Sweep ALL orphan jobs (server_id NULL) against ALL currently-registered
 *  servers and link any whose normalized URL matches an existing row. One
 *  round-trip per job table, both bounded by the size of the orphan set.
 *  Used by scrapeServers() so a Grind re-attaches not just to newly-created
 *  servers but also to rows that existed before but never had their orphans
 *  linked (e.g. servers added before the relink-on-create logic landed).
 *  Returns the total number of jobs reattached. */
export async function relinkAllOrphans(): Promise<number> {
  const normalize = sql`lower(regexp_replace(regexp_replace(server_url, '^https?://', ''), '/+$', ''))`
  // Subquery: pick the server whose normalized url matches each orphan job's
  // normalized server_url. Type is matched too — workflow jobs only get
  // workflow servers, training jobs only get lora servers — so a workflow
  // service and a lora service that happen to share a URL prefix can't
  // cross-link. Multiple servers with the same key shouldn't exist
  // (unique-on-url is enforced), but if they do, MIN(id) wins
  // deterministically.
  const wf = await db.execute(sql`
    UPDATE workflow_jobs wj
    SET server_id = sub.sid
    FROM (
      SELECT
        ${normalize} AS k,
        MIN(id) AS sid
      FROM servers
      WHERE type IN ('workflow') OR type IS NULL
      GROUP BY ${normalize}
    ) sub
    WHERE wj.server_id IS NULL
      AND wj.server_url IS NOT NULL
      AND lower(regexp_replace(regexp_replace(wj.server_url, '^https?://', ''), '/+$', '')) = sub.k
  `)
  const lora = await db.execute(sql`
    UPDATE training_jobs tj
    SET server_id = sub.sid
    FROM (
      SELECT
        ${normalize} AS k,
        MIN(id) AS sid
      FROM servers
      WHERE type = 'lora'
      GROUP BY ${normalize}
    ) sub
    WHERE tj.server_id IS NULL
      AND tj.server_url IS NOT NULL
      AND lower(regexp_replace(regexp_replace(tj.server_url, '^https?://', ''), '/+$', '')) = sub.k
  `)
  // postgres-js exposes the affected count via `count` on the result.
  const wfCount = Number((wf as unknown as { count?: number }).count ?? 0)
  const loraCount = Number((lora as unknown as { count?: number }).count ?? 0)
  return wfCount + loraCount
}
