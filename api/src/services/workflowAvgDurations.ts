/**
 * Shared "average duration per workflow (last 90d)" loader.
 *
 * Previously this query was reproduced in three places: /api/wf-jobs/avg-duration,
 * /api/status/summary, and repositories/seto.ts. Each carried its own cache and
 * its own minor divergences (Map vs Record, rounded vs floored). One source of
 * truth lives here; the three callers route through it.
 *
 * The cache is module-scoped and lives for AVG_DUR_TTL milliseconds. The
 * function returns the canonical `Record<workflowName, avgSeconds>` shape
 * because that's what most callers want; a `mapView()` helper returns the
 * same data as a Map for callers that prefer one.
 */
import { sql } from 'drizzle-orm'
import { db, workflowJobs } from '../db/index.js'

export type AvgDurationsSec = Record<string, number>

const AVG_DUR_TTL = 5 * 60_000
let cached: { data: AvgDurationsSec; at: number } | null = null

export async function getAvgDurationsLast90d(): Promise<AvgDurationsSec> {
  const now = Date.now()
  if (cached && now - cached.at < AVG_DUR_TTL) return cached.data

  const rows = await db
    .select({
      name: workflowJobs.workflowName,
      avgSec: sql<number>`round(avg(duration_ms) / 1000.0)::integer`,
    })
    .from(workflowJobs)
    .where(
      sql`status = 'completed' AND duration_ms IS NOT NULL
          AND finished_at > now() - interval '90 days'`,
    )
    .groupBy(workflowJobs.workflowName)

  const data: AvgDurationsSec = {}
  for (const r of rows) {
    if (r.name && r.avgSec != null && r.avgSec > 0) data[r.name] = r.avgSec
  }

  cached = { data, at: now }
  return data
}

/** Map view of the same data. Some legacy callers (Seto rules) preferred a
 *  Map<string, number>; this saves them from converting on every call. */
export async function getAvgDurationsLast90dMap(): Promise<Map<string, number>> {
  const data = await getAvgDurationsLast90d()
  return new Map(Object.entries(data))
}
