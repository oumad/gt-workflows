/**
 * Repository for analytics aggregation queries. Owns every SQL statement
 * the analytics endpoints need. Filter values arrive validated; nothing in
 * this file accepts raw HTTP input. SQL is hand-written drizzle `sql\`\``
 * because most queries compose a UNION across workflow_jobs + training_jobs
 * with shared filter predicates — the query builder can't express that.
 */
import { sql, desc, type SQL } from 'drizzle-orm'
import { db, workflowJobs, trainingJobs } from '../db/index.js'
import type { PerfMetric, TimeseriesGroup, DistGroup, EntityKind } from '../validators/analytics.js'

/* ─── SQL primitives ──────────────────────────────────────────────
 * `col` is a literal identifier ("created_at" or "wj.created_at") — keep it
 * hard-coded at the call site since we splice it into the SQL via sql.raw.
 */

/** SQL fragment that gates rows by `created_at` against the requested window.
 *  When `days === 0` the fragment is a no-op (`TRUE`), trivially dropped by
 *  the planner. */
export function dateGate(days: number, col = 'created_at'): SQL {
  if (days <= 0) return sql`TRUE`
  return sql`${sql.raw(col)} >= now() - (${days}::int * interval '1 day')`
}

/** Error-classifier CASE expression bound to a specific failed_reason
 *  column. Order matters — first match wins. Mirrors `classifyError` in
 *  frontend/src/pages/analytics/analyticsHelpers.ts. */
export function errorCodeSqlFor(col: string): SQL {
  return sql.raw(`
    CASE
      WHEN ${col} IS NULL                                                THEN 'UNKNOWN'
      WHEN ${col} ~* 'cancel|aborted|SIGINT|SIGTERM'                     THEN 'ABORTED'
      WHEN ${col} ~* 'out of memory|OOM|CUDA out|HIP out'                THEN 'OOM'
      WHEN ${col} ~* 'host memory|RAM exhausted|MemoryError'             THEN 'OOM_HOST'
      WHEN ${col} ~* 'loss|NaN|diverged|gradient'                        THEN 'LOSS_NAN'
      WHEN ${col} ~* 'checksum|corrupt|hash mismatch'                    THEN 'DATA_BAD'
      WHEN ${col} ~* 'checkpoint.*(failed|write|read)|ckpt'              THEN 'CKPT_IO'
      WHEN ${col} ~* 'shape|dimension|tensor.*(size|mismatch)|reshape'   THEN 'SHAPE'
      WHEN ${col} ~* 'EADDRINUSE'                                        THEN 'EADDRINUSE'
      WHEN ${col} ~* 'ECONNREFUSED'                                      THEN 'ECONNREFUSED'
      WHEN ${col} ~* 'ECONNRESET'                                        THEN 'ECONNRESET'
      WHEN ${col} ~* 'EHOSTUNREACH|ENETUNREACH'                          THEN 'ENETUNREACH'
      WHEN ${col} ~* 'ETIMEDOUT'                                         THEN 'ETIMEDOUT'
      WHEN ${col} ~* 'ENOSPC|disk full|no space left'                    THEN 'ENOSPC'
      WHEN ${col} ~* 'EACCES|EPERM|permission denied'                    THEN 'EACCES'
      WHEN ${col} ~* 'ENOENT|no such file'                               THEN 'ENOENT'
      WHEN ${col} ~* 'timeout|timed out'                                 THEN 'TIMEOUT'
      WHEN ${col} ~* 'rate.?limit|429'                                   THEN 'RATE_LIMIT'
      WHEN ${col} ~* '401|unauthorized'                                  THEN 'UNAUTHORIZED'
      WHEN ${col} ~* '403|forbidden'                                     THEN 'FORBIDDEN'
      WHEN ${col} ~* '404|not found|missing'                             THEN 'NOT_FOUND'
      WHEN ${col} ~* '5\\d{2}|server error|internal error|gateway'       THEN 'SERVER_ERR'
      WHEN ${col} ~* 's3|gcs|azure blob|storage|bucket'                  THEN 'STORAGE_IO'
      WHEN ${col} ~* 'import\\s*error|ModuleNotFound|cannot find module' THEN 'IMPORT_ERR'
      WHEN ${col} ~* 'JSON|parse error|unexpected token'                 THEN 'PARSE_ERR'
      WHEN ${col} ~* 'network|DNS|getaddrinfo'                           THEN 'NETWORK'
      ELSE 'OTHER'
    END
  `)
}

const errorCodeSql = errorCodeSqlFor('failed_reason')

/* ─── Aggregate queries ─────────────────────────────────────────── */

export async function mainStats(days: number) {
  return Promise.all([
    db
      .select({
        status: workflowJobs.status,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(workflowJobs)
      .groupBy(workflowJobs.status),

    db
      .select({
        status: trainingJobs.status,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(trainingJobs)
      .groupBy(trainingJobs.status),

    db.execute(sql`
      SELECT date, sum(total)::int AS total,
             sum(completed)::int AS completed,
             sum(failed)::int    AS failed,
             sum(other)::int     AS other
      FROM (
        SELECT date_trunc('day', created_at)::date::text AS date,
               count(*)                                  AS total,
               count(*) FILTER (WHERE status = 'completed') AS completed,
               count(*) FILTER (WHERE status = 'failed')    AS failed,
               count(*) FILTER (WHERE status NOT IN ('completed','failed')) AS other
        FROM workflow_jobs
        WHERE ${dateGate(days)}
        GROUP BY 1

        UNION ALL

        SELECT date_trunc('day', created_at)::date::text AS date,
               count(*)                                  AS total,
               count(*) FILTER (WHERE status = 'completed') AS completed,
               count(*) FILTER (WHERE status = 'failed')    AS failed,
               count(*) FILTER (WHERE status NOT IN ('completed','failed')) AS other
        FROM training_jobs
        WHERE ${dateGate(days)}
        GROUP BY 1
      ) t
      GROUP BY date
      ORDER BY date
    `),

    db
      .select({
        workflowName: workflowJobs.workflowName,
        total: sql<number>`cast(count(*) as integer)`,
        completed: sql<number>`cast(count(*) filter (where status = 'completed') as integer)`,
        failed: sql<number>`cast(count(*) filter (where status = 'failed') as integer)`,
        avgDurationMs: sql<number>`cast(avg(duration_ms) filter (where duration_ms is not null) as integer)`,
      })
      .from(workflowJobs)
      .where(dateGate(days))
      .groupBy(workflowJobs.workflowName)
      .orderBy(desc(sql`count(*)`)),

    db
      .select({
        baseModel: trainingJobs.baseModel,
        total: sql<number>`cast(count(*) as integer)`,
        completed: sql<number>`cast(count(*) filter (where status = 'completed') as integer)`,
        failed: sql<number>`cast(count(*) filter (where status = 'failed') as integer)`,
        avgDurationMs: sql<number>`cast(avg(duration_ms) filter (where duration_ms is not null) as integer)`,
      })
      .from(trainingJobs)
      .where(dateGate(days))
      .groupBy(trainingJobs.baseModel)
      .orderBy(desc(sql`count(*)`)),

    db.execute(sql`
      SELECT
        COALESCE(s.name, j.server_url, 'unknown')                       AS server_name,
        j.server_id,
        j.server_url                                                    AS server_url,
        s.type                                                          AS server_type,
        s.gpu                                                           AS gpu,
        count(*)::int                                                   AS total,
        count(*) filter (where j.status = 'completed')::int             AS completed,
        count(*) filter (where j.status = 'failed')::int                AS failed,
        cast(avg(j.duration_ms) filter (where j.duration_ms is not null) as integer) AS avg_duration_ms,
        cast(percentile_cont(0.50) WITHIN GROUP (ORDER BY j.duration_ms) FILTER (WHERE j.duration_ms IS NOT NULL) AS integer) AS p50_ms,
        cast(percentile_cont(0.95) WITHIN GROUP (ORDER BY j.duration_ms) FILTER (WHERE j.duration_ms IS NOT NULL) AS integer) AS p95_ms,
        cast(percentile_cont(0.99) WITHIN GROUP (ORDER BY j.duration_ms) FILTER (WHERE j.duration_ms IS NOT NULL) AS integer) AS p99_ms,
        cast(avg(j.wait_ms)     filter (where j.wait_ms     is not null) as integer) AS avg_wait_ms,
        cast(sum(j.duration_ms) filter (where j.duration_ms IS NOT NULL) AS double precision) AS total_duration_ms
      FROM (
        SELECT server_id, server_url, status, duration_ms, wait_ms
        FROM workflow_jobs
        WHERE ${dateGate(days)}

        UNION ALL

        SELECT
          server_id,
          server_url,
          status,
          duration_ms,
          CASE WHEN started_at IS NOT NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (started_at - created_at))::bigint * 1000)
            ELSE NULL
          END AS wait_ms
        FROM training_jobs
        WHERE ${dateGate(days)}
      ) j
      LEFT JOIN servers s ON s.id = j.server_id
      GROUP BY s.name, j.server_id, j.server_url, s.type, s.gpu
      ORDER BY total DESC
    `),

    db.execute(sql`
      SELECT extract(hour from created_at)::int AS hour,
             count(*)::int AS count
      FROM workflow_jobs
      WHERE ${dateGate(days)}
      GROUP BY 1
      ORDER BY 1
    `),

    // Per-source duration roll-ups. Avg is the true population mean across all
    // jobs with duration_ms (not weighted from per-server groupings). Total is
    // a double precision so it can sum a month of milliseconds without losing
    // precision. The frontend coerces with Number() in case the driver hands
    // it back as a string for large sums.
    db
      .select({
        avgMs: sql<
          number | null
        >`cast(avg(duration_ms) filter (where duration_ms is not null) as integer)`,
        totalMs: sql<
          number | null
        >`cast(sum(duration_ms) filter (where duration_ms is not null) as double precision)`,
      })
      .from(workflowJobs)
      .where(dateGate(days)),

    db
      .select({
        avgMs: sql<
          number | null
        >`cast(avg(duration_ms) filter (where duration_ms is not null) as integer)`,
        totalMs: sql<
          number | null
        >`cast(sum(duration_ms) filter (where duration_ms is not null) as double precision)`,
      })
      .from(trainingJobs)
      .where(dateGate(days)),
  ])
}

export async function durationBuckets(days: number) {
  return db.execute(sql`
    WITH durations AS (
      SELECT duration_ms FROM workflow_jobs
      WHERE status = 'completed' AND duration_ms IS NOT NULL AND ${dateGate(days)}
      UNION ALL
      SELECT duration_ms FROM training_jobs
      WHERE status = 'completed' AND duration_ms IS NOT NULL AND ${dateGate(days)}
    )
    SELECT
      width_bucket(
        duration_ms,
        ARRAY[5000, 10000, 20000, 30000, 45000, 60000, 90000, 120000, 180000, 300000, 600000]::int[]
      )::int AS bucket,
      count(*)::int AS count
    FROM durations
    GROUP BY bucket
    ORDER BY bucket
  `)
}

export async function perfDaily(days: number, top: number, metric: PerfMetric) {
  const valueExpr =
    metric === 'runs'
      ? sql`count(*)::int`
      : metric === 'dur'
        ? sql`cast(avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS integer)`
        : metric === 'p95'
          ? sql`cast(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
                              FILTER (WHERE duration_ms IS NOT NULL) AS integer)`
          : sql`(count(*) FILTER (WHERE status='failed')::float
                              / GREATEST(count(*), 1) * 100)::int`

  return db.execute(sql`
    WITH unified AS (
      SELECT server_id, server_url, status, duration_ms, created_at
      FROM workflow_jobs
      WHERE ${dateGate(days)}
      UNION ALL
      SELECT server_id, server_url, status, duration_ms, created_at
      FROM training_jobs
      WHERE ${dateGate(days)}
    ),
    enriched AS (
      SELECT COALESCE(s.name, u.server_url, 'unknown') AS entity,
             u.status, u.duration_ms, u.created_at
      FROM unified u
      LEFT JOIN servers s ON s.id = u.server_id
    ),
    top_srv AS (
      SELECT entity
      FROM enriched
      GROUP BY entity
      ORDER BY count(*) DESC
      LIMIT ${top}::int
    )
    SELECT
      date_trunc('day', created_at)::date::text AS date,
      entity,
      ${valueExpr} AS value
    FROM enriched
    WHERE entity IN (SELECT entity FROM top_srv)
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
}

export async function byUser(days: number) {
  return db.execute(sql`
    SELECT
      u.id::text                                  AS user_id,
      COALESCE(u.name, u.email, 'unknown')        AS user_name,
      u.email                                     AS email,
      count(*)::int                               AS total,
      count(*) FILTER (WHERE j.status = 'failed')::int    AS failed,
      count(*) FILTER (WHERE j.status = 'completed')::int AS completed,
      cast(avg(j.duration_ms) FILTER (WHERE j.duration_ms IS NOT NULL) AS integer) AS avg_duration_ms,
      max(j.created_at)                           AS last_run_at
    FROM (
      SELECT client_id, status, duration_ms, created_at
      FROM workflow_jobs
      WHERE ${dateGate(days)} AND client_id IS NOT NULL
      UNION ALL
      SELECT client_id, status, duration_ms, created_at
      FROM training_jobs
      WHERE ${dateGate(days)} AND client_id IS NOT NULL
    ) j
    LEFT JOIN gt_users u ON u.id = j.client_id
    GROUP BY u.id, u.name, u.email
    ORDER BY total DESC
  `)
}

export async function byError(days: number) {
  return db.execute(sql`
    SELECT
      ${errorCodeSql} AS code,
      count(*)::int   AS count,
      array_agg(DISTINCT substr(failed_reason, 1, 120)) FILTER (WHERE failed_reason IS NOT NULL) AS samples
    FROM (
      SELECT failed_reason FROM workflow_jobs
      WHERE status = 'failed' AND ${dateGate(days)}
      UNION ALL
      SELECT failed_reason FROM training_jobs
      WHERE status = 'failed' AND ${dateGate(days)}
    ) f
    GROUP BY 1
    ORDER BY count DESC
  `)
}

export async function timeseries(
  groupBy: TimeseriesGroup,
  metric: 'runs' | 'gpu',
  days: number,
  top: number,
) {
  const valueExpr =
    metric === 'gpu'
      ? sql`cast(coalesce(sum(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0) / 3600000.0 AS numeric(12, 2))`
      : sql`count(*)::int`

  if (groupBy === 'workflow') {
    return db.execute(sql`
      WITH top_wf AS (
        SELECT workflow_name
        FROM workflow_jobs
        WHERE ${dateGate(days)} AND workflow_name IS NOT NULL
        GROUP BY workflow_name
        ORDER BY count(*) DESC
        LIMIT ${top}::int
      )
      SELECT
        date_trunc('day', created_at)::date::text AS date,
        workflow_name                              AS entity,
        ${valueExpr}                               AS count
      FROM workflow_jobs
      WHERE ${dateGate(days)}
        AND workflow_name IN (SELECT workflow_name FROM top_wf)
      GROUP BY 1, 2
      ORDER BY 1, 2
    `)
  }

  if (groupBy === 'lora') {
    return db.execute(sql`
      WITH top_lr AS (
        SELECT output_name
        FROM training_jobs
        WHERE ${dateGate(days)} AND output_name IS NOT NULL
        GROUP BY output_name
        ORDER BY count(*) DESC
        LIMIT ${top}::int
      )
      SELECT
        date_trunc('day', created_at)::date::text AS date,
        output_name                                AS entity,
        ${valueExpr}                               AS count
      FROM training_jobs
      WHERE ${dateGate(days)}
        AND output_name IN (SELECT output_name FROM top_lr)
      GROUP BY 1, 2
      ORDER BY 1, 2
    `)
  }

  if (groupBy === 'user') {
    return db.execute(sql`
      WITH unified AS (
        SELECT client_id, duration_ms, status, created_at FROM workflow_jobs
        WHERE ${dateGate(days)} AND client_id IS NOT NULL
        UNION ALL
        SELECT client_id, duration_ms, status, created_at FROM training_jobs
        WHERE ${dateGate(days)} AND client_id IS NOT NULL
      ),
      enriched AS (
        SELECT COALESCE(u.name, u.email, 'unknown') AS entity, j.duration_ms, j.status, j.created_at
        FROM unified j LEFT JOIN gt_users u ON u.id = j.client_id
      ),
      top_user AS (
        SELECT entity FROM enriched
        GROUP BY entity ORDER BY count(*) DESC LIMIT ${top}::int
      )
      SELECT
        date_trunc('day', created_at)::date::text AS date,
        entity,
        ${valueExpr} AS count
      FROM enriched
      WHERE entity IN (SELECT entity FROM top_user)
      GROUP BY 1, 2
      ORDER BY 1, 2
    `)
  }

  // server
  return db.execute(sql`
    WITH unified AS (
      SELECT server_id, server_url, duration_ms, status, created_at FROM workflow_jobs
      WHERE ${dateGate(days)}
      UNION ALL
      SELECT server_id, server_url, duration_ms, status, created_at FROM training_jobs
      WHERE ${dateGate(days)}
    ),
    enriched AS (
      SELECT COALESCE(s.name, u.server_url, 'unknown') AS entity,
             u.duration_ms, u.status, u.created_at
      FROM unified u LEFT JOIN servers s ON s.id = u.server_id
    ),
    top_srv AS (
      SELECT entity FROM enriched
      GROUP BY entity ORDER BY count(*) DESC LIMIT ${top}::int
    )
    SELECT
      date_trunc('day', created_at)::date::text AS date,
      entity,
      ${valueExpr} AS count
    FROM enriched
    WHERE entity IN (SELECT entity FROM top_srv)
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
}

export async function distribution(groupBy: DistGroup, days: number) {
  if (groupBy === 'server') {
    return db.execute(sql`
      WITH unified AS (
        SELECT server_id, server_url FROM workflow_jobs WHERE ${dateGate(days)}
        UNION ALL
        SELECT server_id, server_url FROM training_jobs WHERE ${dateGate(days)}
      )
      SELECT
        COALESCE(s.name, u.server_url, 'unknown') AS name,
        s.type                                     AS secondary,
        s.gpu                                      AS gpu,
        count(*)::int                              AS value
      FROM unified u LEFT JOIN servers s ON s.id = u.server_id
      GROUP BY 1, 2, 3
      ORDER BY value DESC
    `)
  }
  if (groupBy === 'workflow') {
    return db.execute(sql`
      SELECT
        workflow_name AS name,
        NULL::text    AS secondary,
        NULL::text    AS gpu,
        count(*)::int AS value
      FROM workflow_jobs
      WHERE ${dateGate(days)} AND workflow_name IS NOT NULL
      GROUP BY workflow_name
      ORDER BY value DESC
    `)
  }
  return db.execute(sql`
    SELECT
      output_name   AS name,
      base_model    AS secondary,
      NULL::text    AS gpu,
      count(*)::int AS value
    FROM training_jobs
    WHERE ${dateGate(days)} AND output_name IS NOT NULL
    GROUP BY output_name, base_model
    ORDER BY value DESC
  `)
}

/* Slow-job thresholds.
 *
 *   SLOW_MULTIPLIER  — when a workflow has a historical avg duration, a job
 *                      is "slow" if its actual duration is at least this many
 *                      times the avg. Mirrors the inline `<SlowChip>` in
 *                      JobsTables so the Doctor tab and the chip agree on
 *                      what "slow" means.
 *   SLOW_WAIT_MS     — wait_ms threshold (queue + warmup). Even on workflows
 *                      with no historical avg, a job that waited longer than
 *                      this is slow by any definition.
 *   SLOW_*_TO_MS     — absolute duration fallback used when no per-workflow
 *                      avg exists yet (new workflow, or workflow with no
 *                      completed runs in the 90d avg window).
 *
 * The WF query left-joins a per-workflow_name CTE of last-90d avg durations,
 * exactly the same window backing /api/wf-jobs/avg-duration. A workflow's
 * own historical avg is computed across all runs of that workflow, not just
 * this slice — otherwise a workflow with a 12s avg over 30 days would never
 * have any 1.5× slow rows on a "last 24h" filter.
 *
 * LoRA keeps absolute thresholds because per-architecture avg duration has
 * unbounded variance (different base models, different step counts).
 */
const SLOW_MULTIPLIER = 1.5
/** Threshold on time spent in BullMQ waiting list before ComfyUI picked the
 *  job up. Lowered from 30s → 15s after the user reported even relaxed
 *  thresholds were catching nothing. A 15s wait is unusual in a healthy
 *  cluster — if it's chronic, the cluster's saturated. */
const SLOW_WAIT_MS = 15_000
/** No-avg fallback total-duration threshold (when the workflow has no 90d
 *  completed runs to compare against). Lowered from 3 min → 90s. */
const SLOW_WF_TO_MS = 90_000
/** Time spent in ComfyUI's INTERNAL queue (processed_at → comfy_started_at).
 *  Healthy clusters move from BullMQ-active to ComfyUI-executing in seconds;
 *  a multi-minute gap means ComfyUI is hung or chewing on a previous job.
 *  Generated column `comfy_queue_ms` is null for older jobs that pre-date the
 *  live-tracker — those fall back to the duration / wait predicates. */
const SLOW_COMFY_QUEUE_MS = 30_000
/** Failed/aborted runs that nevertheless burned >60s are operationally
 *  interesting — they tend to be the slow OOMs, late ComfyUI hangs, and
 *  retried-then-gave-up cases. Even if they're under the workflow's avg,
 *  they're worth surfacing in the slow tab. */
const SLOW_FAILED_MS = 60_000
const SLOW_LORA_TO_MS = 7_200_000

// SQL fragment producing the per-workflow avg-duration CTE used by both
// slowJobsPage() and slowJobsCount(). Defined once so the two definitions
// can never drift.
const WF_AVG_CTE = sql`
  WITH wf_avgs AS (
    SELECT
      workflow_name,
      round(avg(duration_ms))::bigint AS avg_ms
    FROM workflow_jobs
    WHERE status = 'completed'
      AND duration_ms IS NOT NULL
      AND finished_at > now() - interval '90 days'
    GROUP BY workflow_name
  )
`

// Predicate identifying a slow WF row. Same shape used in both queries.
//   • Duration ≥ 1.5× workflow avg (when avg known) — too long for this workflow
//   • Duration ≥ 90s (when no avg) — absolute fallback for fresh workflows
//   • Wait > 15s — BullMQ queue was congested before the job started
//   • ComfyUI queue > 30s — the post-pickup wait inside ComfyUI is unusual
//   • Failed/aborted run that burned > 60s — slow-failures are worth showing
const WF_SLOW_PREDICATE = sql`
  (
    wj.duration_ms IS NOT NULL
    AND wj.duration_ms >= COALESCE(wf_avgs.avg_ms * ${SLOW_MULTIPLIER}, ${SLOW_WF_TO_MS})
  )
  OR (wj.wait_ms IS NOT NULL AND wj.wait_ms > ${SLOW_WAIT_MS})
  OR (wj.comfy_queue_ms IS NOT NULL AND wj.comfy_queue_ms > ${SLOW_COMFY_QUEUE_MS})
  OR (
    wj.status IN ('failed', 'aborted')
    AND wj.duration_ms IS NOT NULL
    AND wj.duration_ms > ${SLOW_FAILED_MS}
  )
`

export async function slowJobsPage(days: number, page: number, limit: number) {
  const offset = (page - 1) * limit
  const wfDate = dateGate(days, 'wj.created_at')
  const loraDate = dateGate(days, 'tj.created_at')
  const rows = await db.execute(sql`
    ${WF_AVG_CTE}
    SELECT *, count(*) OVER ()::int AS __total
    FROM (
      SELECT
        'wf'::text                              AS type,
        wj.id                                   AS id,
        wj.workflow_name                        AS name,
        wj.status                               AS status,
        wj.duration_ms                          AS duration_ms,
        wj.wait_ms                              AS wait_ms,
        wj.created_at                           AS created_at,
        wj.processed_at                         AS started_at,
        -- Older jobs predate the live-tracker that stamps comfy_started_at;
        -- fall back to processed_at so the column isn't empty for them. UI
        -- can still tell the two apart via the wait + queue ms columns.
        COALESCE(wj.comfy_started_at, wj.processed_at) AS exec_at,
        wj.finished_at                          AS finished_at,
        wj.server_url                           AS server_url,
        wj.server_id                            AS server_id,
        wj.client_id::text                      AS client_id,
        wj.failed_reason                        AS failed_reason,
        COALESCE(s.name, wj.server_url)         AS server_name,
        COALESCE(wj.data->>'userName', u.name, u.email) AS user_name
      FROM workflow_jobs wj
      LEFT JOIN servers  s        ON s.id = wj.server_id
      LEFT JOIN gt_users u        ON u.id = wj.client_id
      LEFT JOIN wf_avgs           ON wf_avgs.workflow_name = wj.workflow_name
      WHERE ${wfDate} AND (${WF_SLOW_PREDICATE})

      UNION ALL

      SELECT
        'lora'::text                            AS type,
        tj.id::text                             AS id,
        tj.output_name                          AS name,
        tj.status                               AS status,
        tj.duration_ms                          AS duration_ms,
        CASE WHEN tj.started_at IS NOT NULL
          THEN GREATEST(0, EXTRACT(EPOCH FROM (tj.started_at - tj.created_at))::bigint * 1000)
          ELSE NULL
        END                                     AS wait_ms,
        tj.created_at                           AS created_at,
        tj.started_at                           AS started_at,
        NULL::timestamptz                       AS exec_at,
        tj.finished_at                          AS finished_at,
        tj.server_url                           AS server_url,
        tj.server_id                            AS server_id,
        tj.client_id::text                      AS client_id,
        tj.failed_reason                        AS failed_reason,
        COALESCE(s.name, tj.server_url)         AS server_name,
        COALESCE(u.name, u.email)               AS user_name
      FROM training_jobs tj
      LEFT JOIN servers  s ON s.id = tj.server_id
      LEFT JOIN gt_users u ON u.id = tj.client_id
      WHERE ${loraDate}
        AND (
          (
            tj.started_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (tj.started_at - tj.created_at)) * 1000 > ${SLOW_WAIT_MS}
          )
          OR (tj.duration_ms IS NOT NULL AND tj.duration_ms > ${SLOW_LORA_TO_MS})
        )
    ) AS merged
    ORDER BY GREATEST(COALESCE(duration_ms, 0), COALESCE(wait_ms, 0)) DESC
    LIMIT ${limit}::int OFFSET ${offset}::int
  `)
  return rows
}

export async function slowJobsCount(days: number): Promise<number> {
  const wfDate = dateGate(days, 'wj.created_at')
  const loraDate = dateGate(days, 'tj.created_at')
  const rows = (await db.execute(sql`
    ${WF_AVG_CTE}
    SELECT count(*)::int AS total FROM (
      SELECT 1
      FROM workflow_jobs wj
      LEFT JOIN wf_avgs ON wf_avgs.workflow_name = wj.workflow_name
      WHERE ${wfDate} AND (${WF_SLOW_PREDICATE})
      UNION ALL
      SELECT 1
      FROM training_jobs tj
      WHERE ${loraDate}
        AND (
          (
            tj.started_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (tj.started_at - tj.created_at)) * 1000 > ${SLOW_WAIT_MS}
          )
          OR (tj.duration_ms IS NOT NULL AND tj.duration_ms > ${SLOW_LORA_TO_MS})
        )
    ) c
  `)) as { total: number }[]
  return Number(rows[0]?.total ?? 0)
}

/**
 * Diagnostic counter for the slow-jobs predicate. Returns per-rule match
 * counts so we can tell whether "no slow jobs" is a query bug or genuinely
 * no matching data. Surfaced via /api/analytics/slow-jobs/diagnose.
 *
 * Crucially: each per-rule count is independent (a job may match more than
 * one), and `totalAfterDedup` is the same count slowJobsCount returns. If
 * `totalAfterDedup === 0` while a per-rule count is > 0, there's a bug
 * elsewhere; if every count is 0 the data genuinely has no slow rows.
 */
export async function slowJobsDiagnose(days: number) {
  const wfDate = dateGate(days, 'wj.created_at')
  const loraDate = dateGate(days, 'tj.created_at')
  const rows = (await db.execute(sql`
    ${WF_AVG_CTE}
    SELECT
      (SELECT count(*) FROM workflow_jobs wj WHERE ${wfDate})::int               AS wf_total_in_range,
      (SELECT count(*) FROM workflow_jobs wj WHERE ${wfDate}
        AND wj.duration_ms IS NOT NULL)::int                                     AS wf_with_duration,
      (SELECT count(*) FROM workflow_jobs wj
        LEFT JOIN wf_avgs ON wf_avgs.workflow_name = wj.workflow_name
        WHERE ${wfDate}
          AND wj.duration_ms IS NOT NULL
          AND wj.duration_ms >= COALESCE(wf_avgs.avg_ms * ${SLOW_MULTIPLIER}, ${SLOW_WF_TO_MS}))::int
                                                                                 AS wf_slow_by_duration,
      (SELECT count(*) FROM workflow_jobs wj
        WHERE ${wfDate} AND wj.wait_ms IS NOT NULL AND wj.wait_ms > ${SLOW_WAIT_MS})::int
                                                                                 AS wf_slow_by_wait,
      (SELECT count(*) FROM workflow_jobs wj
        WHERE ${wfDate}
          AND wj.comfy_queue_ms IS NOT NULL
          AND wj.comfy_queue_ms > ${SLOW_COMFY_QUEUE_MS})::int                   AS wf_slow_by_comfy_queue,
      (SELECT count(*) FROM workflow_jobs wj
        WHERE ${wfDate}
          AND wj.status IN ('failed','aborted')
          AND wj.duration_ms IS NOT NULL
          AND wj.duration_ms > ${SLOW_FAILED_MS})::int                           AS wf_slow_by_failed,
      (SELECT count(*) FROM workflow_jobs wj
        LEFT JOIN wf_avgs ON wf_avgs.workflow_name = wj.workflow_name
        WHERE ${wfDate} AND (${WF_SLOW_PREDICATE}))::int                         AS wf_slow_total,
      (SELECT count(DISTINCT workflow_name) FROM wf_avgs)::int                   AS workflows_with_avg,
      (SELECT count(*) FROM training_jobs tj WHERE ${loraDate})::int             AS lora_total_in_range,
      (SELECT count(*) FROM training_jobs tj
        WHERE ${loraDate}
          AND (
            (tj.started_at IS NOT NULL AND EXTRACT(EPOCH FROM (tj.started_at - tj.created_at)) * 1000 > ${SLOW_WAIT_MS})
            OR (tj.duration_ms IS NOT NULL AND tj.duration_ms > ${SLOW_LORA_TO_MS})
          ))::int                                                                AS lora_slow_total
  `)) as Array<Record<string, number>>

  // Also pull a handful of the longest jobs in the range — useful when every
  // count is 0 to confirm the dataset's actual duration distribution.
  const samples = (await db.execute(sql`
    SELECT
      wj.id, wj.workflow_name, wj.status, wj.duration_ms, wj.wait_ms,
      wj.created_at, wj.processed_at, wj.finished_at, wj.failed_reason
    FROM workflow_jobs wj
    WHERE ${wfDate}
    ORDER BY GREATEST(COALESCE(wj.duration_ms, 0), COALESCE(wj.wait_ms, 0)) DESC NULLS LAST
    LIMIT 5
  `)) as Array<Record<string, unknown>>

  return {
    range: { days },
    thresholds: {
      slowMultiplier: SLOW_MULTIPLIER,
      slowWaitMs: SLOW_WAIT_MS,
      slowWfTimeoutMs: SLOW_WF_TO_MS,
      slowComfyQueueMs: SLOW_COMFY_QUEUE_MS,
      slowFailedMs: SLOW_FAILED_MS,
      slowLoraTimeoutMs: SLOW_LORA_TO_MS,
    },
    counts: rows[0] ?? null,
    longestWfInRange: samples,
  }
}

export async function entityDrilldown(kind: EntityKind, id: string, days: number) {
  let wfFilter: SQL
  let loFilter: SQL | null
  if (kind === 'workflow') {
    wfFilter = sql`wj.workflow_name = ${id}`
    loFilter = null
  } else if (kind === 'server') {
    wfFilter = sql`(wj.server_id = ${id} OR wj.server_url = ${id})`
    loFilter = sql`(tj.server_id = ${id} OR tj.server_url = ${id})`
  } else if (kind === 'user') {
    wfFilter = sql`wj.client_id::text = ${id}`
    loFilter = sql`tj.client_id::text = ${id}`
  } else {
    wfFilter = sql`TRUE`
    loFilter = sql`TRUE`
  }

  const wfBlock = sql`
    SELECT
      'wf'::text                        AS type,
      wj.id                             AS id,
      wj.workflow_name                  AS name,
      COALESCE(s.name, wj.server_url)   AS server_name,
      wj.client_id::text                AS client_id,
      COALESCE(wj.data->>'userName', u.name, u.email) AS user_name,
      wj.status                         AS status,
      wj.failed_reason                  AS failed_reason,
      wj.duration_ms                    AS duration_ms,
      wj.created_at                     AS created_at,
      wj.finished_at                    AS finished_at,
      ${errorCodeSqlFor('wj.failed_reason')} AS err_code
    FROM workflow_jobs wj
    LEFT JOIN servers  s ON s.id = wj.server_id
    LEFT JOIN gt_users u ON u.id = wj.client_id
    WHERE ${dateGate(days, 'wj.created_at')}
      AND ${wfFilter}
  `
  const loBlock = loFilter
    ? sql`
    UNION ALL
    SELECT
      'lora'::text                      AS type,
      tj.id::text                       AS id,
      tj.output_name                    AS name,
      COALESCE(s.name, tj.server_url)   AS server_name,
      tj.client_id::text                AS client_id,
      COALESCE(u.name, u.email)         AS user_name,
      tj.status                         AS status,
      tj.failed_reason                  AS failed_reason,
      tj.duration_ms                    AS duration_ms,
      tj.created_at                     AS created_at,
      tj.finished_at                    AS finished_at,
      ${errorCodeSqlFor('tj.failed_reason')} AS err_code
    FROM training_jobs tj
    LEFT JOIN servers  s ON s.id = tj.server_id
    LEFT JOIN gt_users u ON u.id = tj.client_id
    WHERE ${dateGate(days, 'tj.created_at')}
      AND ${loFilter}
  `
    : sql``

  const errFilter = kind === 'error' ? sql`WHERE err_code = ${id}` : sql``

  const baseCte = sql`
    WITH base AS (
      SELECT * FROM (${wfBlock} ${loBlock}) j
    ),
    scoped AS (
      SELECT * FROM base ${errFilter}
    )
  `

  return Promise.all([
    db.execute(sql`
      ${baseCte}
      SELECT
        count(*)::int                                              AS runs,
        count(*) FILTER (WHERE status = 'failed')::int             AS fails,
        count(*) FILTER (WHERE status = 'completed')::int          AS completed,
        cast(avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS integer) AS avg_dur,
        cast(avg(duration_ms) FILTER (WHERE status = 'failed' AND duration_ms IS NOT NULL) AS integer) AS avg_fail_dur,
        max(created_at) FILTER (WHERE status = 'failed') AS last_fail_at
      FROM scoped
    `),

    db.execute(sql`
      ${baseCte}
      SELECT
        date_trunc('day', created_at)::date::text AS date,
        count(*)                          ::int   AS runs,
        count(*) FILTER (WHERE status='failed')::int AS fails
      FROM scoped
      GROUP BY 1
      ORDER BY 1
    `),

    db.execute(sql`
      ${baseCte}
      SELECT err_code AS code, count(*)::int AS count
      FROM scoped
      WHERE status = 'failed'
        ${kind === 'error' ? sql`AND err_code <> ${id}` : sql``}
      GROUP BY err_code
      ORDER BY count DESC
      LIMIT 8
    `),

    db.execute(sql`
      ${baseCte}
      SELECT COALESCE(server_name, 'unknown') AS server_name,
             count(*) FILTER (WHERE status = 'failed')::int AS fails,
             count(*)::int AS runs
      FROM scoped
      GROUP BY server_name
      ORDER BY fails DESC, runs DESC
      LIMIT 8
    `),

    db.execute(sql`
      ${baseCte}
      SELECT COALESCE(user_name, 'unknown') AS user_name,
             count(*) FILTER (WHERE status = 'failed')::int AS fails,
             count(*)::int AS runs
      FROM scoped
      WHERE user_name IS NOT NULL
      GROUP BY user_name
      ORDER BY fails DESC, runs DESC
      LIMIT 8
    `),

    db.execute(sql`
      ${baseCte}
      SELECT name,
             count(*) FILTER (WHERE status = 'failed')::int AS fails,
             count(*)::int AS runs
      FROM scoped
      WHERE name IS NOT NULL
      GROUP BY name
      ORDER BY fails DESC, runs DESC
      LIMIT 8
    `),

    db.execute(sql`
      ${baseCte}
      SELECT type, id, name, err_code, failed_reason, duration_ms,
             server_name, user_name, created_at, finished_at
      FROM scoped
      WHERE status = 'failed'
      ORDER BY COALESCE(finished_at, created_at) DESC
      LIMIT 20
    `),
  ])
}

export async function repartitionByDays(days: number) {
  return db.execute(sql`
    SELECT
      COALESCE(s.name, wj.server_url, 'unknown') AS server_name,
      wj.server_id,
      wj.workflow_name,
      count(*)::int                              AS total
    FROM workflow_jobs wj
    LEFT JOIN servers s ON s.id = wj.server_id
    WHERE ${dateGate(days, 'wj.created_at')}
      AND wj.workflow_name IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY total DESC
  `)
}
