/**
 * Cluster-wide status summary — powers the ops transition toasts.
 *
 * Returns the IDENTITIES (id + name) of down hosts/services, not just counts,
 * so the client can set-diff between polls: that catches simultaneous
 * down+recover within one poll window (a count delta would net to zero and
 * miss both) and lets toasts name the actual record. Plus two rolling 5-minute
 * job facets the client edge-triggers on:
 *   • downServers / downServices — confirmed-offline records (excl. maintenance)
 *   • servicesInMaintenance      — intentionally offline, count only
 *   • failedJobs5m               — non-aborted job failures in the last 5 min
 *   • slowJobs5m                 — running wf jobs already past 1.5× avg
 *
 * Counts are cached for 5s so a busy cluster doesn't hammer the DB while the
 * client polls on a short interval.
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

    // Confirmed-down only (probed and offline) — never-probed / stale (unknown)
    // records aren't alarmed on, so a fresh grind doesn't flash "down". Split
    // host vs service by URL shape so the banner can label and route each.
    const hasPort = (s: (typeof servers)[number]) => {
      try {
        return !!new URL(s.url).port
      } catch {
        return false
      }
    }
    const isDown = (s: (typeof servers)[number]) =>
      !s.isMaintenance && s.health !== null && s.health.status === 'offline'
    const ident = (s: (typeof servers)[number]) => ({ id: s.id, name: s.name })
    const downServers = servers.filter((s) => isDown(s) && !hasPort(s)).map(ident)
    const downServices = servers.filter((s) => isDown(s) && hasPort(s)).map(ident)

    const servicesInMaintenance = servers.filter((s) => s.isMaintenance).length

    const [failedJobs5m, slowJobs5m] = await Promise.all([
      countFailedJobs5m(),
      countSlowRunningJobs(),
    ])

    return {
      ts: Date.now(),
      downServers,
      downServices,
      servicesInMaintenance,
      failedJobs5m,
      slowJobs5m,
    }
  })
  return c.json(data)
})

export default app
