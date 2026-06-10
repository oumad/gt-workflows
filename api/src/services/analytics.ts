/**
 * Business logic for analytics. Wraps the repository with a shared 60s
 * in-memory cache (per-key) and shapes responses for the wire format the
 * frontend expects. Routes call these — they do not touch SQL directly.
 */
import { TtlCache } from '../lib/ttlCache.js'
import * as repo from '../repositories/analytics.js'
import type { PerfMetric, TimeseriesGroup, DistGroup, EntityKind } from '../validators/analytics.js'
import type {
  AnalyticsMain,
  DurationBucket,
  SlowJobsResponse,
  EntityResponse,
} from '../models/analytics.js'

const cache = new TtlCache(60_000)

export function mainAggregate(days: number): Promise<AnalyticsMain> {
  return cache.memo(`main:${days}`, async () => {
    const [wfStats, loraStats, daily, byWorkflow, byLora, byServer, byHour, wfDur, loraDur] =
      await repo.mainStats(days)

    const wfMap = Object.fromEntries(wfStats.map((r) => [r.status, r.count]))
    const loraMap = Object.fromEntries(loraStats.map((r) => [r.status, r.count]))

    return {
      range: { days },
      workflows: {
        total: Object.values(wfMap).reduce((a, b) => a + b, 0),
        completed: wfMap['completed'] ?? 0,
        failed: wfMap['failed'] ?? 0,
        active: wfMap['active'] ?? 0,
        waiting: wfMap['waiting'] ?? 0,
        avgDurationMs: wfDur[0]?.avgMs ?? null,
        totalDurationMs: wfDur[0]?.totalMs != null ? Number(wfDur[0].totalMs) : null,
      },
      training: {
        total: Object.values(loraMap).reduce((a, b) => a + b, 0),
        completed: loraMap['completed'] ?? 0,
        failed: loraMap['failed'] ?? 0,
        running: loraMap['running'] ?? 0,
        pending: loraMap['pending'] ?? 0,
        avgDurationMs: loraDur[0]?.avgMs ?? null,
        totalDurationMs: loraDur[0]?.totalMs != null ? Number(loraDur[0].totalMs) : null,
      },
      daily,
      byWorkflow: byWorkflow.map((r) => ({
        workflowName: r.workflowName,
        total: r.total,
        completed: r.completed,
        failed: r.failed,
        successRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
        avgDurationMs: r.avgDurationMs ?? null,
      })),
      byLora: byLora.map((r) => ({
        baseModel: r.baseModel,
        total: r.total,
        completed: r.completed,
        failed: r.failed,
        successRate: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
        avgDurationMs: r.avgDurationMs ?? null,
      })),
      byServer,
      byHour,
    }
  })
}

const BUCKET_LABELS = [
  '<5s',
  '10s',
  '20s',
  '30s',
  '45s',
  '60s',
  '90s',
  '2m',
  '3m',
  '5m',
  '10m',
  '>10m',
]

export function durationBuckets(days: number): Promise<DurationBucket[]> {
  return cache.memo(`dur-buckets:${days}`, async () => {
    const rows = await repo.durationBuckets(days)
    // width_bucket returns: 0 (below first), 1..N (between), N+1 (above last).
    // Map back to 12 fixed buckets matching the label array.
    const counts = BUCKET_LABELS.map(() => 0)
    for (const r of rows as unknown as Array<{ bucket: number; count: number }>) {
      if (r.bucket >= 0 && r.bucket < counts.length) counts[r.bucket] = r.count
    }
    return BUCKET_LABELS.map((label, i) => ({ label, count: counts[i] ?? 0 }))
  })
}

export function perfDaily(days: number, top: number, metric: PerfMetric): Promise<unknown[]> {
  return cache.memo(`perf-daily:${days}:${top}:${metric}`, () => repo.perfDaily(days, top, metric))
}

export function byUser(days: number): Promise<unknown[]> {
  return cache.memo(`by-user:${days}`, () => repo.byUser(days))
}

export function byError(days: number): Promise<unknown[]> {
  return cache.memo(`by-error:${days}`, () => repo.byError(days))
}

export function timeseries(
  groupBy: TimeseriesGroup,
  metric: 'runs' | 'gpu',
  days: number,
  top: number,
): Promise<unknown[]> {
  return cache.memo(`ts:${groupBy}:${metric}:${days}:${top}`, () =>
    repo.timeseries(groupBy, metric, days, top),
  )
}

export function distribution(groupBy: DistGroup, days: number): Promise<unknown[]> {
  return cache.memo(`dist:${groupBy}:${days}`, () => repo.distribution(groupBy, days))
}

export async function slowJobs(
  days: number,
  page: number,
  limit: number,
): Promise<SlowJobsResponse> {
  return cache.memo(`slow:${days}:${page}:${limit}`, async () => {
    const offset = (page - 1) * limit
    const rows = await repo.slowJobsPage(days, page, limit)

    let total = rows.length > 0 ? Number((rows[0] as Record<string, unknown>)['__total'] ?? 0) : 0
    // Past the end → run a count query so the UI can recover to a valid page.
    if (rows.length === 0 && offset > 0) {
      total = await repo.slowJobsCount(days)
    }
    const totalPages = Math.max(1, Math.ceil(total / limit))
    // Strip the pagination metadata before returning the rows themselves.
    const items = rows.map((r) => {
      const { __total: _drop, ...rest } = r as Record<string, unknown> & { __total?: unknown }
      return rest
    })
    // Lightweight log so an empty result is visible in the API logs while
    // tuning the predicate. Volume is low — at most one log per page-fetch.
    if (items.length === 0) {
      console.log(
        `[slow-jobs] days=${days} page=${page} limit=${limit} → 0 rows (total=${total}). ` +
          `Hit /api/analytics/slow-jobs/diagnose for predicate-match breakdown.`,
      )
    }
    return { items, page, totalPages, total }
  })
}

/** Diagnostic counts for the slow-jobs predicate. Surfaced via
 *  /api/analytics/slow-jobs/diagnose so we can tell whether an empty Slow
 *  tab is a SQL bug or just "no matching data in the window". Not cached —
 *  this endpoint is called manually during diagnosis, not on every page load. */
export function slowJobsDiagnose(days: number) {
  return repo.slowJobsDiagnose(days)
}

export async function entityDrilldown(
  kind: EntityKind,
  id: string,
  days: number,
): Promise<EntityResponse> {
  return cache.memo(`entity:${kind}:${id}:${days}`, async () => {
    const [kpis, trend, byErrorRows, byServerRows, byUserRows, byWorkflowRows, recent] =
      await repo.entityDrilldown(kind, id, days)
    return {
      kind,
      id,
      range: { days },
      kpis: kpis[0] ?? null,
      trend,
      byError: byErrorRows,
      byServer: byServerRows,
      byUser: byUserRows,
      byWorkflow: byWorkflowRows,
      recent,
    }
  })
}

export function repartition(days: number): Promise<unknown[]> {
  return cache.memo(`repartition:${days}`, () => repo.repartitionByDays(days))
}
