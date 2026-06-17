/**
 * Repository for the unified jobs view (workflow_jobs ∪ training_jobs).
 *
 * Owns every DB call for this resource. The SQL is hand-written because the
 * two tables have different shapes and the unified list endpoint composes a
 * UNION with shared filter predicates — drizzle's query builder can't model
 * this without losing the planner-friendly form. Filter values arrive
 * already-validated from the service layer; nothing in this file accepts
 * raw HTTP input.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db, servers, gtUsers } from '../db/index.js'

export interface JobFilters {
  type: 'wf' | 'lora' | 'all'
  status?: string
  userId?: string
  serverId?: string
  workflowId?: string
  workflowName?: string
  q?: string
  days: number // 0 means "all time"
  excludeAborted: boolean
}

function wfWhere(f: JobFilters): SQL {
  const parts: SQL[] = []
  if (f.days > 0) parts.push(sql`wj.created_at >= now() - (${f.days}::int * interval '1 day')`)
  if (f.excludeAborted) {
    parts.push(
      sql`(wj.failed_reason IS NULL OR wj.failed_reason !~* 'cancel|aborted|SIGINT|SIGTERM')`,
    )
  }
  if (f.status) parts.push(sql`wj.status = ${f.status}`)
  if (f.userId) parts.push(sql`wj.client_id = ${f.userId}::uuid`)
  if (f.serverId) parts.push(sql`wj.server_id = ${f.serverId}`)
  if (f.workflowId || f.workflowName) {
    const clauses: SQL[] = []
    if (f.workflowId) {
      clauses.push(sql`wj.workflow_id = ${f.workflowId}`)
      clauses.push(sql`LOWER(wj.workflow_name) = LOWER(${f.workflowId})`)
    }
    if (f.workflowName) {
      clauses.push(sql`LOWER(wj.workflow_name) = LOWER(${f.workflowName})`)
    }
    parts.push(sql`(${sql.join(clauses, sql` OR `)})`)
  }
  if (f.q) {
    const pat = `%${f.q}%`
    parts.push(sql`(
      wj.id ILIKE ${pat}
      OR wj.workflow_name ILIKE ${pat}
      OR wj.server_url ILIKE ${pat}
      OR wj.data->>'userName' ILIKE ${pat}
    )`)
  }
  return parts.length ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``
}

function loraWhere(f: JobFilters): SQL {
  const parts: SQL[] = []
  if (f.days > 0) parts.push(sql`tj.created_at >= now() - (${f.days}::int * interval '1 day')`)
  if (f.excludeAborted) {
    parts.push(
      sql`(tj.failed_reason IS NULL OR tj.failed_reason !~* 'cancel|aborted|SIGINT|SIGTERM')`,
    )
  }
  if (f.status) parts.push(sql`tj.status = ${f.status}`)
  if (f.userId) parts.push(sql`tj.client_id = ${f.userId}::uuid`)
  if (f.serverId) parts.push(sql`tj.server_id = ${f.serverId}`)
  if (f.q) {
    const pat = `%${f.q}%`
    parts.push(sql`(
      tj.process_id ILIKE ${pat}
      OR tj.output_name ILIKE ${pat}
      OR tj.base_model ILIKE ${pat}
      OR tj.server_url ILIKE ${pat}
      OR EXISTS (
        SELECT 1 FROM gt_users u
        WHERE u.id = tj.client_id AND (u.name ILIKE ${pat} OR u.email ILIKE ${pat})
      )
    )`)
  }
  return parts.length ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``
}

function unionSelect(f: JobFilters): SQL | null {
  const includeWf = f.type !== 'lora'
  const includeLora = f.type !== 'wf'

  const wfSelect = sql`
    SELECT 'wf'::text                AS type,
           wj.id                     AS id,
           wj.workflow_name          AS name,
           NULL::text                AS arch,
           wj.server_id              AS server_id,
           wj.server_url             AS server_url,
           wj.client_id::text        AS client_id,
           (wj.data->>'userName')    AS user_name,
           wj.status                 AS status,
           wj.duration_ms            AS duration_ms,
           wj.failed_reason          AS failed_reason,
           wj.created_at             AS created_at,
           wj.processed_at           AS started_at,
           wj.finished_at            AS finished_at,
           wj.workflow_id            AS workflow_id,
           wj.comfy_started_at       AS comfy_started_at,
           wj.wait_ms                AS wait_ms,
           wj.comfy_queue_ms         AS comfy_queue_ms,
           wj.comfy_run_ms           AS comfy_run_ms,
           COALESCE(wj.finished_at, '1970-01-01'::timestamptz) AS sort_at
    FROM workflow_jobs wj
    ${wfWhere(f)}
  `

  const loSelect = sql`
    SELECT 'lora'::text              AS type,
           tj.id::text                AS id,
           tj.output_name             AS name,
           tj.base_model              AS arch,
           tj.server_id               AS server_id,
           tj.server_url              AS server_url,
           tj.client_id::text         AS client_id,
           COALESCE(u.name, u.email)  AS user_name,
           tj.status                  AS status,
           tj.duration_ms             AS duration_ms,
           tj.failed_reason           AS failed_reason,
           tj.created_at              AS created_at,
           tj.started_at              AS started_at,
           tj.finished_at             AS finished_at,
           NULL::text                 AS workflow_id,
           NULL::timestamptz          AS comfy_started_at,
           NULL::bigint               AS wait_ms,
           NULL::bigint               AS comfy_queue_ms,
           NULL::bigint               AS comfy_run_ms,
           COALESCE(tj.finished_at, '1970-01-01'::timestamptz) AS sort_at
    FROM training_jobs tj
    LEFT JOIN gt_users u ON u.id = tj.client_id
    ${loraWhere(f)}
  `

  const parts: SQL[] = []
  if (includeWf) parts.push(wfSelect)
  if (includeLora) parts.push(loSelect)
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0]! : sql`${parts[0]} UNION ALL ${parts[1]}`
}

export interface JobsPageRow extends Record<string, unknown> {
  __total?: number
}

export async function listJobsPage(
  f: JobFilters,
  page: number,
  limit: number,
): Promise<{ rows: JobsPageRow[]; totalFromWindow: number }> {
  const union = unionSelect(f)
  if (!union) return { rows: [], totalFromWindow: 0 }
  const offset = (page - 1) * limit
  // Single query: window function computes the total count across the full
  // filtered union once, then LIMIT/OFFSET selects the page. Cuts the
  // request from 2 connections (data + count) down to 1.
  const rows = (await db.execute(sql`
    SELECT *, count(*) OVER ()::int AS __total
    FROM (${union}) AS u
    ORDER BY u.sort_at DESC, u.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as JobsPageRow[]
  const totalFromWindow =
    rows.length > 0 ? Number((rows[0] as Record<string, unknown>)['__total'] ?? 0) : 0
  return { rows, totalFromWindow }
}

/** Falls back to a separate count when the page is past the end of results
 *  and the window function returned no rows to read __total from. */
export async function countJobs(f: JobFilters): Promise<number> {
  const union = unionSelect(f)
  if (!union) return 0
  const rows = (await db.execute(sql`SELECT count(*)::int AS total FROM (${union}) AS u`)) as {
    total: number
  }[]
  return Number(rows[0]?.total ?? 0)
}

export interface StatsByStatus {
  wfByStatus: Record<string, number>
  loraByStatus: Record<string, number>
}

export async function statsByStatus(): Promise<StatsByStatus> {
  const [wfRows, loraRows] = await Promise.all([
    db.execute(sql`SELECT status, count(*)::int AS count FROM workflow_jobs GROUP BY status`),
    db.execute(sql`SELECT status, count(*)::int AS count FROM training_jobs GROUP BY status`),
  ])
  return {
    wfByStatus: Object.fromEntries(wfRows.map((r) => [r['status'] as string, Number(r['count'])])),
    loraByStatus: Object.fromEntries(
      loraRows.map((r) => [r['status'] as string, Number(r['count'])]),
    ),
  }
}

/** Look up a job by id in either workflow_jobs or training_jobs.
 *
 *  ID shapes differ between the two tables — workflow_jobs.id is `text`
 *  (BullMQ-style identifier like `TEST-WF-1DGCDY`), training_jobs.id is
 *  `uuid`. Passing a non-UUID string to the training_jobs query throws a
 *  Postgres 22P02 ("invalid input syntax for type uuid"), which rejected
 *  the whole Promise.all and broke every WF-job report. The UUID-shape
 *  precheck below skips the LoRA query when the id can't possibly match.
 *  Collisions across tables aren't possible — wf ids never validate as
 *  UUIDs and lora ids always do. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function findJobAnywhere(id: string): Promise<
  | { type: 'wf'; row: { id: string; workflowName: string; status: string; serverUrl: string } }
  | {
      type: 'lora'
      row: { id: string; baseModel: string; status: string; serverUrl: string | null }
    }
  | null
> {
  const looksLikeUuid = UUID_RE.test(id)
  const [wf, lora] = await Promise.all([
    db.query.workflowJobs.findFirst({
      where: (j, { eq }) => eq(j.id, id),
      columns: { id: true, workflowName: true, status: true, serverUrl: true },
    }),
    // LoRA: a uuid hits the primary key; anything else may be the BullMQ
    // processId — which is what live-feed rows carry — so resolve by that.
    // (Skipping the uuid clause for non-UUID ids also avoids the postgres-js
    // text → uuid cast error.)
    looksLikeUuid
      ? db.query.trainingJobs.findFirst({
          where: (j, { eq }) => eq(j.id, id),
          columns: { id: true, baseModel: true, status: true, serverUrl: true },
        })
      : db.query.trainingJobs.findFirst({
          where: (j, { eq }) => eq(j.processId, id),
          columns: { id: true, baseModel: true, status: true, serverUrl: true },
        }),
  ])
  if (wf) return { type: 'wf', row: wf }
  if (lora) return { type: 'lora', row: lora }
  return null
}

/** Server-id and gt_user-id lookup maps used by the live feed to resolve
 *  Redis-only payload fields (serverUrl, userExternalId) into FK ids the
 *  UI can deep-link with. */
export async function loadServerAndUserMaps(): Promise<{
  serverRows: { id: string; url: string }[]
  userRows: { id: string; externalId: string }[]
}> {
  const [serverRows, userRows] = await Promise.all([
    db.select({ id: servers.id, url: servers.url }).from(servers),
    db.select({ id: gtUsers.id, externalId: gtUsers.externalId }).from(gtUsers),
  ])
  return { serverRows, userRows }
}
