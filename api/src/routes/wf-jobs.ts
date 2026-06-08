import { Hono } from 'hono'
import { db } from '../db/index.js'
import { getRedisJob, getRedisJobLogs } from '../services/redis.js'
import { getAvgDurationsLast90d } from '../services/workflowAvgDurations.js'
import { stopWfJob } from '../services/wfJobStop.js'
import { requireAuth, requireCapability } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ─────────────────────────────────────────────
// WF-specific routes — list/live/stats live on the unified /api/jobs.
// ─────────────────────────────────────────────

// ── GET /wf-jobs/avg-duration ──────────────────
// Per-workflow average duration (seconds, last 90 days, completed only).
// Powers the ETA column in the live feed. Backed by the shared cache in
// services/workflowAvgDurations so /status/summary and seto rules see the
// same numbers.
app.get('/avg-duration', requireAuth, async (c) => {
  return c.json(await getAvgDurationsLast90d())
})

// ── GET /wf-jobs/:id ──────────────────────────
app.get('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const row = await db.query.workflowJobs.findFirst({
    where: (j, { eq }) => eq(j.id, id),
    with: { workflow: true, server: true, client: true },
  })
  if (!row) return c.json({ error: 'Not found' }, 404)

  const redisJob = await getRedisJob(id)
  return c.json({ ...row, redis: redisJob })
})

// ── GET /wf-jobs/:id/logs ─────────────────────
app.get('/:id/logs', requireAuth, async (c) => {
  const id = c.req.param('id')
  const start = Number(c.req.query('start') ?? 0)
  const end = Number(c.req.query('end') ?? -1)
  const logs = await getRedisJobLogs(id, start, end)
  return c.json({ id, logs })
})

// ── POST /wf-jobs/:id/stop ────────────────────
// Manual cancellation of an in-flight ComfyUI workflow job. The prompt id
// is scraped from the service log (we don't get it any other way — see
// services/wfJobStop.ts for the rationale). Any auth'd user can fire this;
// the audit row on workflow_jobs.cm_audit_log captures the username for
// accountability.
app.post('/:id/stop', requireAuth, requireCapability('stop-job'), async (c) => {
  try {
    const result = await stopWfJob(c.req.param('id'), c.var.user.username)
    return c.json(result)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
