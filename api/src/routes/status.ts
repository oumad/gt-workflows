/**
 * Cluster-wide status summary — powers the multi-issue header banner.
 *
 * Aggregates four facets that ops needs at a glance:
 *   • serversDown            — hosts/services that aren't healthy right now
 *   • servicesInMaintenance  — anything intentionally taken offline
 *   • failedJobs5m           — non-aborted job failures in the last 5 minutes
 *   • slowJobs5m             — currently-running wf jobs already past 1.5× avg
 *
 * Counts are cached for 5s so a busy cluster doesn't hammer the DB while
 * every page polls this on a short interval. The banner clears within one
 * cache window when issues resolve.
 */
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import * as serversService from '../services/servers.js'
import * as jobsService from '../services/jobs.js'
import { getAvgDurationsLast90d } from '../services/workflowAvgDurations.js'
import { TtlCache } from '../lib/ttlCache.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

const summaryCache = new TtlCache(5_000)

/** Slow threshold: a running job is "slow" when its elapsed time has already
 *  exceeded this multiplier of the workflow's historical average. Mirrors
 *  the threshold used by the inline slow-job chip in job lists. */
const SLOW_MULTIPLIER = 1.5

async function countFailedJobs5m(): Promise<number> {
  // Both job tables share the same "aborted" classification pattern — see
  // repositories/jobs.ts. ABORTED jobs are user cancellations, not real
  // failures, so they're excluded from the banner count.
  const rows = await db.execute(sql`
    SELECT (
      (SELECT COUNT(*) FROM workflow_jobs
         WHERE status = 'failed'
           AND finished_at > now() - interval '5 minutes'
           AND (failed_reason IS NULL OR failed_reason !~* 'cancel|aborted|SIGINT|SIGTERM'))
      +
      (SELECT COUNT(*) FROM training_jobs
         WHERE status = 'failed'
           AND finished_at > now() - interval '5 minutes'
           AND (failed_reason IS NULL OR failed_reason !~* 'cancel|aborted|SIGINT|SIGTERM'))
    )::text AS n
  `)
  const first = rows[0] as { n?: string } | undefined
  return first?.n ? Number(first.n) : 0
}

async function countSlowRunningJobs(): Promise<number> {
  // Slow = currently-running WF job whose elapsed time >= 1.5× the workflow's
  // historical avg. LoRA training has unbounded variance per arch — skipping
  // it here so the count stays signal-not-noise. Per-job avg lookup is
  // O(running × 1), in-memory after the cache fills.
  const [live, avgMap] = await Promise.all([jobsService.live(), getAvgDurationsLast90d()])
  const now = Date.now()
  let n = 0
  for (const j of live.running) {
    if (j.type !== 'wf') continue
    const avgSec = avgMap[j.name]
    if (!avgSec) continue
    // Prefer comfyStartedAt (actual GPU work started); fall back to processedOn
    // (queue pickup) so jobs stuck in comfy's pre-execution warmup also count.
    const startedMs = j.comfyStartedAt ?? j.processedOn
    if (!startedMs) continue
    const elapsedSec = (now - startedMs) / 1000
    if (elapsedSec >= avgSec * SLOW_MULTIPLIER) n++
  }
  return n
}

app.get('/summary', requireAuth, async (c) => {
  const data = await summaryCache.memo('summary', async () => {
    const servers = await serversService.listServers()

    // "down" = not in maintenance, monitored, and either offline / unknown /
    // service-down. Mirrors the serverStatus() classification used by the UI.
    const serversDown = servers.filter(
      (s) =>
        !s.isMaintenance &&
        s.isMonitored &&
        (s.health === null ||
          s.health.status === 'offline' ||
          s.health.status === 'unknown' ||
          s.health.status === 'service-down'),
    ).length

    const servicesInMaintenance = servers.filter((s) => s.isMaintenance).length

    const [failedJobs5m, slowJobs5m] = await Promise.all([
      countFailedJobs5m(),
      countSlowRunningJobs(),
    ])

    return {
      ts: Date.now(),
      serversDown,
      servicesInMaintenance,
      failedJobs5m,
      slowJobs5m,
    }
  })
  return c.json(data)
})

export default app
