import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { desc, eq, sql } from 'drizzle-orm'
import { db, workflowJobs, trainingJobs, servers } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { AppVariables } from '../types.js'

// ─────────────────────────────────────────────
// /clients — read-only view of GT Users (external gt-workflows end-users)
// ─────────────────────────────────────────────

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /clients/stats ────────────────────────
// "Active" and "last seen" are derived from actual job activity — not from
// gt_users.last_seen_at (which the sync touches even when no new jobs run).
app.get('/stats', requireAuth, requireAdmin, async (c) => {
  const [[userRow], [activeRow], [jobRow]] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS total FROM gt_users`),
    db.execute(sql`
      SELECT count(*)::int AS active7d
      FROM (
        SELECT client_id FROM workflow_jobs
        WHERE client_id IS NOT NULL AND created_at >= now() - interval '7 days'
        UNION
        SELECT client_id FROM training_jobs
        WHERE client_id IS NOT NULL AND created_at >= now() - interval '7 days'
      ) recent
    `),
    db.execute(sql`
      SELECT (
        (SELECT count(*)::int FROM workflow_jobs) +
        (SELECT count(*)::int FROM training_jobs)
      ) AS "totalJobs"
    `),
  ])

  const total = Number(userRow?.['total'] ?? 0)
  const active7d = Number(activeRow?.['active7d'] ?? 0)
  const totalJobs = Number(jobRow?.['totalJobs'] ?? 0)

  return c.json({
    total,
    active7d,
    totalJobs,
    avgJobsPerUser: total > 0 ? Math.round(totalJobs / total) : 0,
  })
})

// ── GET /clients ──────────────────────────────
// Sortable + offset-paginated. lastSeen and totalJobs are computed from
// job activity, not from gt_users metadata.
const listQuery = z.object({
  q: z.string().optional(),
  sort: z.enum(['name', 'email', 'lastSeen', 'jobs']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  offset: z.coerce.number().min(0).optional(),
})

app.get('/', requireAuth, requireAdmin, zValidator('query', listQuery), async (c) => {
  const q = c.req.valid('query')
  const limit = q.limit ?? 200
  const offset = q.offset ?? 0
  const sort = q.sort ?? 'jobs'
  const dir = q.dir ?? 'desc'

  // Order-by expression. We sort against the derived CTE columns.
  const sortExpr =
    sort === 'name'
      ? sql.raw("lower(coalesce(name, email, ''))")
      : sort === 'email'
        ? sql.raw("lower(coalesce(email, ''))")
        : sort === 'lastSeen'
          ? sql.raw('last_run_at')
          : sql.raw('total_jobs')
  const dirSql = dir === 'asc' ? sql.raw('asc nulls last') : sql.raw('desc nulls last')

  // Free-text filter — applied to the gt_users CTE so it doesn't fight the order.
  const qFilter = q.q
    ? sql`WHERE (lower(coalesce(name,'')) LIKE ${'%' + q.q.toLowerCase() + '%'}
              OR lower(coalesce(email,'')) LIKE ${'%' + q.q.toLowerCase() + '%'})`
    : sql``

  const [rows, countRows] = await Promise.all([
    db.execute(sql`
      WITH wf AS (
        SELECT client_id, count(*)::int AS cnt, max(created_at) AS last_run
        FROM workflow_jobs WHERE client_id IS NOT NULL GROUP BY client_id
      ),
      tr AS (
        SELECT client_id, count(*)::int AS cnt, max(created_at) AS last_run
        FROM training_jobs WHERE client_id IS NOT NULL GROUP BY client_id
      ),
      filtered AS (
        SELECT u.id, u.external_id, u.name, u.email, u.first_seen_at,
               COALESCE(wf.cnt, 0) + COALESCE(tr.cnt, 0)               AS total_jobs,
               GREATEST(wf.last_run, tr.last_run)                       AS last_run_at
        FROM gt_users u
        LEFT JOIN wf ON wf.client_id = u.id
        LEFT JOIN tr ON tr.client_id = u.id
        ${qFilter}
      )
      SELECT * FROM filtered
      ORDER BY ${sortExpr} ${dirSql}, id ASC
      LIMIT ${limit}::int OFFSET ${offset}::int
    `),
    db.execute(sql`
      SELECT count(*)::int AS total FROM gt_users u
      ${qFilter}
    `),
  ])

  const total = Number(countRows[0]?.['total'] ?? 0)
  const items = (
    rows as unknown as Array<{
      id: string
      external_id: string
      name: string | null
      email: string | null
      first_seen_at: string
      total_jobs: number
      last_run_at: string | null
    }>
  ).map((r) => ({
    id: r.id,
    externalId: r.external_id,
    name: r.name,
    email: r.email,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_run_at, // derived: max(created_at) across job tables
    totalJobs: r.total_jobs,
  }))

  return c.json({ items, total, offset, limit, hasMore: offset + items.length < total })
})

// ── GET /clients/:id ──────────────────────────
app.get('/:id', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const row = await db.query.gtUsers.findFirst({ where: (u, { eq }) => eq(u.id, id) })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ── GET /clients/:id/jobs ─────────────────────
app.get('/:id/jobs', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const rows = await db
    .select({
      id: workflowJobs.id,
      workflowName: workflowJobs.workflowName,
      serverId: workflowJobs.serverId,
      serverName: servers.name,
      serverUrl: workflowJobs.serverUrl,
      durationMs: workflowJobs.durationMs,
      waitMs: workflowJobs.waitMs,
      status: workflowJobs.status,
      createdAt: workflowJobs.createdAt,
    })
    .from(workflowJobs)
    .leftJoin(servers, eq(workflowJobs.serverId, servers.id))
    .where(eq(workflowJobs.clientId, id))
    .orderBy(desc(workflowJobs.createdAt))
    .limit(limit)
  return c.json(rows)
})

// ── GET /clients/:id/training ─────────────────
app.get('/:id/training', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
  const rows = await db
    .select({
      id: trainingJobs.id,
      outputName: trainingJobs.outputName,
      serverId: trainingJobs.serverId,
      serverName: servers.name,
      serverUrl: trainingJobs.serverUrl,
      durationMs: trainingJobs.durationMs,
      status: trainingJobs.status,
      createdAt: trainingJobs.createdAt,
    })
    .from(trainingJobs)
    .leftJoin(servers, eq(trainingJobs.serverId, servers.id))
    .where(eq(trainingJobs.clientId, id))
    .orderBy(desc(trainingJobs.createdAt))
    .limit(limit)
  return c.json(rows)
})

// ── GET /clients/:id/stats ────────────────────
app.get('/:id/stats', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')

  const [userRow, wfRow, loraRow, rankRow] = await Promise.all([
    db.query.gtUsers.findFirst({ where: (u, { eq }) => eq(u.id, id) }),
    db.execute(sql`
      SELECT count(*)::int AS total, count(DISTINCT workflow_name)::int AS distinct_workflows
      FROM workflow_jobs WHERE client_id = ${id}::uuid
    `),
    db.execute(sql`
      SELECT count(*)::int AS total, count(DISTINCT base_model)::int AS distinct_models
      FROM training_jobs WHERE client_id = ${id}::uuid
    `),
    db.execute(sql`
      WITH wf_totals AS (
        SELECT client_id, count(*)::int AS total
        FROM workflow_jobs WHERE client_id IS NOT NULL GROUP BY client_id
      ),
      lora_totals AS (
        SELECT client_id, count(*)::int AS total
        FROM training_jobs WHERE client_id IS NOT NULL GROUP BY client_id
      ),
      combined AS (
        SELECT client_id, sum(total)::int AS total
        FROM (SELECT client_id, total FROM wf_totals UNION ALL SELECT client_id, total FROM lora_totals) t
        GROUP BY client_id
      )
      SELECT
        (SELECT rank::int FROM (SELECT client_id, rank() OVER (ORDER BY total DESC) FROM combined) r WHERE client_id = ${id}::uuid) AS total_rank,
        (SELECT count(*)::int FROM combined) AS total_users,
        (SELECT rank::int FROM (SELECT client_id, rank() OVER (ORDER BY total DESC) FROM wf_totals) r WHERE client_id = ${id}::uuid) AS wf_rank,
        (SELECT count(*)::int FROM wf_totals) AS wf_users,
        (SELECT rank::int FROM (SELECT client_id, rank() OVER (ORDER BY total DESC) FROM lora_totals) r WHERE client_id = ${id}::uuid) AS lora_rank,
        (SELECT count(*)::int FROM lora_totals) AS lora_users
    `),
  ])

  if (!userRow) return c.json({ error: 'Not found' }, 404)

  const wfTotal = Number(wfRow[0]?.['total'] ?? 0)
  const loraTotal = Number(loraRow[0]?.['total'] ?? 0)
  const totalJobs = wfTotal + loraTotal
  const daysSince = Math.max(
    1,
    Math.floor((Date.now() - new Date(userRow.firstSeenAt).getTime()) / 86_400_000),
  )
  const r = rankRow[0] ?? {}

  return c.json({
    wfJobs: wfTotal,
    loraJobs: loraTotal,
    totalJobs,
    distinctWorkflows: Number(wfRow[0]?.['distinct_workflows'] ?? 0),
    distinctModels: Number(loraRow[0]?.['distinct_models'] ?? 0),
    avgPerDay: +(totalJobs / daysSince).toFixed(2),
    totalRank: r['total_rank'] != null ? Number(r['total_rank']) : null,
    totalUsers: Number(r['total_users'] ?? 0),
    wfRank: r['wf_rank'] != null ? Number(r['wf_rank']) : null,
    wfUsers: Number(r['wf_users'] ?? 0),
    loraRank: r['lora_rank'] != null ? Number(r['lora_rank']) : null,
    loraUsers: Number(r['lora_users'] ?? 0),
  })
})

// ── GET /clients/:id/activity?period=week|month|year|all ─────────
app.get('/:id/activity', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const period = c.req.query('period') ?? 'month'

  const trunc =
    period === 'week' || period === 'month' ? 'day' : period === 'year' ? 'week' : 'month'
  const interval =
    period === 'week'
      ? '7 days'
      : period === 'month'
        ? '30 days'
        : period === 'year'
          ? '365 days'
          : null

  const wfWhere = interval ? sql`AND created_at >= now() - ${interval}::interval` : sql``
  const loraWhere = interval ? sql`AND created_at >= now() - ${interval}::interval` : sql``

  const rows = await db.execute(sql`
    SELECT date, sum(wf)::int AS wf, sum(lora)::int AS lora, sum(wf + lora)::int AS total
    FROM (
      SELECT date_trunc(${trunc}, created_at)::date::text AS date,
             count(*)::int AS wf, 0 AS lora
      FROM workflow_jobs
      WHERE client_id = ${id}::uuid ${wfWhere}
      GROUP BY 1
      UNION ALL
      SELECT date_trunc(${trunc}, created_at)::date::text AS date,
             0 AS wf, count(*)::int AS lora
      FROM training_jobs
      WHERE client_id = ${id}::uuid ${loraWhere}
      GROUP BY 1
    ) t
    GROUP BY date ORDER BY date
  `)

  return c.json(rows)
})

// ── GET /clients/:id/workflows ────────────────
app.get('/:id/workflows', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')

  const rows = await db.execute(sql`
    WITH user_wf AS (
      SELECT workflow_name, count(*)::int AS user_jobs
      FROM workflow_jobs WHERE client_id = ${id}::uuid AND workflow_name IS NOT NULL
      GROUP BY workflow_name
    ),
    cluster_wf AS (
      SELECT workflow_name, count(*)::int AS total_jobs,
             count(DISTINCT client_id)::int AS total_users
      FROM workflow_jobs WHERE workflow_name IS NOT NULL
      GROUP BY workflow_name
    ),
    per_user_wf AS (
      SELECT workflow_name, client_id, count(*)::int AS jobs
      FROM workflow_jobs WHERE workflow_name IS NOT NULL AND client_id IS NOT NULL
      GROUP BY workflow_name, client_id
    ),
    ranked AS (
      SELECT workflow_name, client_id,
             rank() OVER (PARTITION BY workflow_name ORDER BY jobs DESC)::int AS rank
      FROM per_user_wf
    )
    SELECT
      u.workflow_name    AS "workflowName",
      u.user_jobs        AS "userJobs",
      c.total_jobs       AS "totalJobs",
      c.total_users      AS "totalUsers",
      r.rank
    FROM user_wf u
    JOIN cluster_wf c  ON c.workflow_name = u.workflow_name
    LEFT JOIN ranked r ON r.workflow_name = u.workflow_name AND r.client_id = ${id}::uuid
    ORDER BY u.user_jobs DESC
  `)

  return c.json(rows)
})

// ── GET /clients/:id/loras ────────────────────
app.get('/:id/loras', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')

  const rows = await db.execute(sql`
    WITH user_lora AS (
      SELECT base_model, count(*)::int AS user_jobs
      FROM training_jobs WHERE client_id = ${id}::uuid
      GROUP BY base_model
    ),
    cluster_lora AS (
      SELECT base_model, count(*)::int AS total_jobs,
             count(DISTINCT client_id)::int AS total_users
      FROM training_jobs GROUP BY base_model
    ),
    per_user_lora AS (
      SELECT base_model, client_id, count(*)::int AS jobs
      FROM training_jobs WHERE client_id IS NOT NULL
      GROUP BY base_model, client_id
    ),
    ranked AS (
      SELECT base_model, client_id,
             rank() OVER (PARTITION BY base_model ORDER BY jobs DESC)::int AS rank
      FROM per_user_lora
    )
    SELECT
      u.base_model    AS "baseModel",
      u.user_jobs     AS "userJobs",
      c.total_jobs    AS "totalJobs",
      c.total_users   AS "totalUsers",
      r.rank
    FROM user_lora u
    JOIN cluster_lora c  ON c.base_model = u.base_model
    LEFT JOIN ranked r   ON r.base_model = u.base_model AND r.client_id = ${id}::uuid
    ORDER BY u.user_jobs DESC
  `)

  return c.json(rows)
})

// ── GET /clients/:id/servers ──────────────────
app.get('/:id/servers', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')

  const rows = await db.execute(sql`
    WITH user_server AS (
      SELECT server_id, server_url,
             sum(duration_ms)::bigint AS user_duration_ms,
             count(*)::int            AS user_jobs
      FROM (
        SELECT server_id, server_url, duration_ms FROM workflow_jobs WHERE client_id = ${id}::uuid
        UNION ALL
        SELECT server_id, server_url, duration_ms FROM training_jobs  WHERE client_id = ${id}::uuid
      ) t
      GROUP BY server_id, server_url
    ),
    cluster_server AS (
      SELECT server_id,
             sum(duration_ms)::bigint            AS total_duration_ms,
             count(*)::int                        AS total_jobs,
             count(DISTINCT client_id)::int       AS total_users
      FROM (
        SELECT server_id, duration_ms, client_id FROM workflow_jobs WHERE server_id IS NOT NULL
        UNION ALL
        SELECT server_id, duration_ms, client_id FROM training_jobs  WHERE server_id IS NOT NULL
      ) t
      GROUP BY server_id
    ),
    per_user_server AS (
      SELECT server_id, client_id, sum(duration_ms) AS dur
      FROM (
        SELECT server_id, client_id, duration_ms FROM workflow_jobs WHERE server_id IS NOT NULL AND client_id IS NOT NULL
        UNION ALL
        SELECT server_id, client_id, duration_ms FROM training_jobs  WHERE server_id IS NOT NULL AND client_id IS NOT NULL
      ) t
      GROUP BY server_id, client_id
    ),
    ranked AS (
      SELECT server_id, client_id,
             rank() OVER (PARTITION BY server_id ORDER BY dur DESC NULLS LAST)::int AS rank
      FROM per_user_server
    )
    SELECT
      u.server_id                                          AS "serverId",
      COALESCE(s.name, u.server_url, 'unknown')           AS "serverName",
      s.type                                               AS "serverType",
      u.user_duration_ms                                   AS "userDurationMs",
      c.total_duration_ms                                  AS "totalDurationMs",
      u.user_jobs                                          AS "userJobs",
      c.total_jobs                                         AS "totalJobs",
      c.total_users                                        AS "totalUsers",
      r.rank
    FROM user_server u
    LEFT JOIN servers s        ON s.id = u.server_id
    LEFT JOIN cluster_server c ON c.server_id = u.server_id
    LEFT JOIN ranked r         ON r.server_id = u.server_id AND r.client_id = ${id}::uuid
    ORDER BY u.user_duration_ms DESC NULLS LAST
  `)

  return c.json(rows)
})

export default app
