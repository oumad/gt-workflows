/**
 * Repository for the Seto assistant — config CRUD + every DB query the rule
 * evaluators need (job lookups, avg-duration aggregate, live-job counts,
 * linked-workflow counts). DB-only; rule logic lives in services/seto.ts.
 */
import { eq, sql } from 'drizzle-orm'
import { db, setoConfig, workflows } from '../db/index.js'
import type { Server, SetoConfig, Workflow } from '../db/schema.js'
import { errorCodeSqlFor } from './analytics.js'

/* ─── Config singleton ──────────────────────────────────────── */

export async function findConfig(): Promise<SetoConfig | undefined> {
  const [row] = await db.select().from(setoConfig).where(eq(setoConfig.id, 'singleton'))
  return row
}

export async function upsertConfig(
  values: Omit<typeof setoConfig.$inferInsert, 'id'>,
  patch: Partial<typeof setoConfig.$inferInsert>,
): Promise<void> {
  await db
    .insert(setoConfig)
    .values({ id: 'singleton', ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: setoConfig.id,
      set: { ...patch, updatedAt: new Date() },
    })
}

/* ─── Job lookup (try WF first, then LoRA) ──────────────────── */

export async function findWfJob(id: string) {
  return db.query.workflowJobs.findFirst({ where: (j, { eq }) => eq(j.id, id) })
}

export async function findLoraJob(id: string) {
  return db.query.trainingJobs.findFirst({ where: (j, { eq }) => eq(j.id, id) })
}

/* ─── Servers ───────────────────────────────────────────────── */

export async function findServer(id: string): Promise<Server | undefined> {
  return db.query.servers.findFirst({ where: (s, { eq }) => eq(s.id, id) })
}

export async function findAllServers(): Promise<Server[]> {
  return db.query.servers.findMany()
}

/* ─── Aggregates used by rule evaluators ───────────────────── */

/** Average duration per workflow_name (seconds), last 90d completed runs.
 *  Delegates to the shared services/workflowAvgDurations cache so /status,
 *  /wf-jobs/avg-duration and seto rules all see the same numbers — moved
 *  here as part of the avg-duration dedup pass. */
export { getAvgDurationsLast90dMap as avgDurationsLast90d } from '../services/workflowAvgDurations.js'

/** Live-job counts for a user / a specific service / and all services sharing
 *  a hostname. One SQL call, one UNION; keeps the modal snappy. */
export async function liveCounts(
  clientId: string | null,
  serverId: string | null,
  hostname: string | null,
): Promise<{ userJobs: number; serviceJobs: number; serverJobs: number }> {
  const rows = await db.execute(sql`
    WITH live AS (
      SELECT client_id, server_id, server_url
      FROM workflow_jobs
      WHERE status = ANY(${sql.raw(`ARRAY['active','waiting']::text[]`)})
      UNION ALL
      SELECT client_id, server_id, server_url
      FROM training_jobs
      WHERE status = ANY(${sql.raw(`ARRAY['running','pending']::text[]`)})
    )
    SELECT
      count(*) FILTER (WHERE client_id::text = ${clientId ?? ''})::int AS user_jobs,
      count(*) FILTER (WHERE server_id      = ${serverId ?? ''})::int AS service_jobs,
      count(*) FILTER (
        WHERE ${hostname ? sql`regexp_replace(server_url, '^https?://([^:/]+).*$', '\\1') = ${hostname}` : sql`FALSE`}
      )::int AS server_jobs
    FROM live
  `)
  const r = rows[0] as
    | { user_jobs?: number; service_jobs?: number; server_jobs?: number }
    | undefined
  return {
    userJobs: Number(r?.user_jobs ?? 0),
    serviceJobs: Number(r?.service_jobs ?? 0),
    serverJobs: Number(r?.server_jobs ?? 0),
  }
}

/** Recent reliability for a single service (by serverId) or a whole physical
 *  host (by hostname). Counts only finished work — `finished_at` not null in
 *  the window. Used by Seto to answer "is this service / server behaving
 *  normally lately?" with concrete numbers, not just thresholded warnings. */
export async function recentStats(
  filter: { serverId: string } | { hostname: string },
  hours: number,
): Promise<{ total: number; completed: number; failed: number; avgDurationMs: number | null }> {
  const gate =
    'serverId' in filter
      ? sql`server_id = ${filter.serverId}`
      : sql`regexp_replace(server_url, '^https?://([^:/]+).*$', '\\1') = ${filter.hostname}`

  const rows = await db.execute(sql`
    WITH recent AS (
      SELECT status, duration_ms
      FROM workflow_jobs
      WHERE ${gate} AND finished_at > now() - (${hours}::int * interval '1 hour')
      UNION ALL
      SELECT status, duration_ms
      FROM training_jobs
      WHERE ${gate} AND finished_at > now() - (${hours}::int * interval '1 hour')
    )
    SELECT
      count(*)::int                                                                      AS total,
      count(*) FILTER (WHERE status = 'completed')::int                                  AS completed,
      count(*) FILTER (WHERE status = 'failed')::int                                     AS failed,
      cast(avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS integer)           AS avg_ms
    FROM recent
  `)
  const r = rows[0] as
    | { total?: number; completed?: number; failed?: number; avg_ms?: number | null }
    | undefined
  return {
    total: Number(r?.total ?? 0),
    completed: Number(r?.completed ?? 0),
    failed: Number(r?.failed ?? 0),
    avgDurationMs: r?.avg_ms != null ? Number(r.avg_ms) : null,
  }
}

/** Distinct workflow names that have actually run on a given service in the
 *  last 90 days — a proxy for "linked workflows" since the comfyui_config
 *  mapping lives on disk and isn't directly queryable. */
export async function linkedWorkflowsCount(serverId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(DISTINCT workflow_name)::int AS n
    FROM workflow_jobs
    WHERE server_id = ${serverId}
      AND created_at > now() - interval '90 days'
  `)
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0)
}

/**
 * Stats for a single error code across the recent failure stream — used by
 * the `error` Seto kind. Returns total + 24h + 7d counts, top affected
 * workflows and services, and a couple of recent sample reasons so Seto can
 * give the user a quick "this is what I see and where" snapshot.
 *
 * Implemented as a few small parallel queries rather than one giant one —
 * easier to read and each fragment is the same shape as what
 * /api/analytics/by-error already returns.
 */
export type ErrorStats = {
  code: string
  total24h: number
  total7d: number
  total90d: number
  recentSamples: string[]
  topWorkflows: { name: string; count: number }[]
  topServices: { name: string; count: number }[]
}

export async function errorStats(code: string): Promise<ErrorStats> {
  const codeWfSql = errorCodeSqlFor('wj.failed_reason')
  const codeLoraSql = errorCodeSqlFor('tj.failed_reason')

  // Counts across 24h / 7d / 90d in one trip — fewer round-trips than three
  // separate queries.
  const counts = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS d1,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int   AS d7,
      count(*)::int                                                          AS d90
    FROM (
      SELECT wj.created_at FROM workflow_jobs wj
      WHERE wj.status = 'failed'
        AND wj.created_at > now() - interval '90 days'
        AND ${codeWfSql} = ${code}
      UNION ALL
      SELECT tj.created_at FROM training_jobs tj
      WHERE tj.status = 'failed'
        AND tj.created_at > now() - interval '90 days'
        AND ${codeLoraSql} = ${code}
    ) f
  `)) as Array<{ d1: number; d7: number; d90: number }>
  const c = counts[0] ?? { d1: 0, d7: 0, d90: 0 }

  const samples = (await db.execute(sql`
    SELECT DISTINCT substr(failed_reason, 1, 180) AS sample
    FROM (
      SELECT wj.failed_reason FROM workflow_jobs wj
      WHERE wj.status = 'failed'
        AND wj.failed_reason IS NOT NULL
        AND wj.created_at > now() - interval '7 days'
        AND ${codeWfSql} = ${code}
      UNION ALL
      SELECT tj.failed_reason FROM training_jobs tj
      WHERE tj.status = 'failed'
        AND tj.failed_reason IS NOT NULL
        AND tj.created_at > now() - interval '7 days'
        AND ${codeLoraSql} = ${code}
    ) s
    LIMIT 3
  `)) as Array<{ sample: string | null }>

  const workflows = (await db.execute(sql`
    SELECT wj.workflow_name AS name, count(*)::int AS count
    FROM workflow_jobs wj
    WHERE wj.status = 'failed'
      AND wj.workflow_name IS NOT NULL
      AND wj.created_at > now() - interval '7 days'
      AND ${codeWfSql} = ${code}
    GROUP BY wj.workflow_name
    ORDER BY count DESC
    LIMIT 3
  `)) as Array<{ name: string; count: number }>

  const services = (await db.execute(sql`
    SELECT COALESCE(s.name, wj.server_url) AS name, count(*)::int AS count
    FROM workflow_jobs wj
    LEFT JOIN servers s ON s.id = wj.server_id
    WHERE wj.status = 'failed'
      AND wj.created_at > now() - interval '7 days'
      AND ${codeWfSql} = ${code}
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 3
  `)) as Array<{ name: string; count: number }>

  return {
    code,
    total24h: c.d1,
    total7d: c.d7,
    total90d: c.d90,
    recentSamples: samples.map((s) => s.sample).filter((x): x is string => !!x),
    topWorkflows: workflows.map((w) => ({ name: w.name, count: w.count })),
    topServices: services.map((s) => ({ name: s.name, count: s.count })),
  }
}

/**
 * Workflow lookup + recent-run aggregate used by the 'workflow' Seto kind.
 * Returns the workflow row and the same shape `recentStats` produces for
 * services/servers — total, completed, failed, avgDurationMs — over the
 * last 7 days, plus the workflow's 90d completion average for context.
 */
export type WorkflowStats = {
  workflow: Workflow | undefined
  recent7d: { total: number; completed: number; failed: number; avgDurationMs: number | null }
  recent24h: { total: number; failed: number }
  avgDuration90dMs: number | null
  topErrorCode: { code: string; count: number } | null
}

export async function findWorkflow(id: string): Promise<Workflow | undefined> {
  const [row] = await db.select().from(workflows).where(eq(workflows.id, id))
  return row
}

export async function workflowStats(id: string): Promise<WorkflowStats> {
  const wf = await findWorkflow(id)

  // OR-match workflow_id with any of {id, name, path} since older orphan
  // jobs may have null workflow_id but a stringly-matched name.
  const ids: string[] = [id]
  if (wf?.name && !ids.includes(wf.name)) ids.push(wf.name)
  if (wf?.path && !ids.includes(wf.path)) ids.push(wf.path)
  const idMatch = sql`(
    wj.workflow_id = ${id}
    OR LOWER(wj.workflow_name) IN (${sql.join(
      ids.map((x) => sql`LOWER(${x})`),
      sql`, `,
    )})
  )`

  // 7d aggregate + 24h subset + 90d completion avg in two queries.
  const rec = (await db.execute(sql`
    SELECT
      count(*)::int                                            AS total_7d,
      count(*) FILTER (WHERE wj.status = 'completed')::int     AS completed_7d,
      count(*) FILTER (WHERE wj.status = 'failed')::int        AS failed_7d,
      round(avg(wj.duration_ms) FILTER (WHERE wj.status = 'completed'))::int
                                                               AS avg_dur_7d,
      count(*) FILTER (WHERE wj.created_at > now() - interval '24 hours')::int                 AS total_24h,
      count(*) FILTER (WHERE wj.status = 'failed' AND wj.created_at > now() - interval '24 hours')::int
                                                               AS failed_24h
    FROM workflow_jobs wj
    WHERE ${idMatch}
      AND wj.created_at > now() - interval '7 days'
  `)) as Array<{
    total_7d: number
    completed_7d: number
    failed_7d: number
    avg_dur_7d: number | null
    total_24h: number
    failed_24h: number
  }>
  const r = rec[0] ?? {
    total_7d: 0,
    completed_7d: 0,
    failed_7d: 0,
    avg_dur_7d: null,
    total_24h: 0,
    failed_24h: 0,
  }

  const avg90 = (await db.execute(sql`
    SELECT round(avg(wj.duration_ms))::int AS avg_ms
    FROM workflow_jobs wj
    WHERE ${idMatch}
      AND wj.status = 'completed'
      AND wj.duration_ms IS NOT NULL
      AND wj.finished_at > now() - interval '90 days'
  `)) as Array<{ avg_ms: number | null }>

  const topErr = (await db.execute(sql`
    SELECT ${errorCodeSqlFor('wj.failed_reason')} AS code, count(*)::int AS count
    FROM workflow_jobs wj
    WHERE ${idMatch}
      AND wj.status = 'failed'
      AND wj.created_at > now() - interval '7 days'
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 1
  `)) as Array<{ code: string; count: number }>

  return {
    workflow: wf,
    recent7d: {
      total: r.total_7d,
      completed: r.completed_7d,
      failed: r.failed_7d,
      avgDurationMs: r.avg_dur_7d,
    },
    recent24h: {
      total: r.total_24h,
      failed: r.failed_24h,
    },
    avgDuration90dMs: avg90[0]?.avg_ms ?? null,
    topErrorCode: topErr[0] ?? null,
  }
}
