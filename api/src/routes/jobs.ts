/**
 * Unified jobs HTTP routes (workflow_jobs ∪ training_jobs read view).
 *
 * Thin adapter onto services/jobs.ts. The only HTTP-specific logic that stays
 * here is the SSE stream loop in /stream, which uses Hono's streaming helper.
 * Type-specific operations (per-job logs, ingest webhooks, detail joins) live
 * on /api/wf-jobs and /api/lora-jobs.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { streamSSE } from 'hono/streaming'
import { requireAuth, requireAccess } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import { listJobsQuery, jobReportSchema, forceStopSchema } from '../validators/jobs.js'
import * as jobsService from '../services/jobs.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /jobs — unified, page-based list ─────────────
app.get('/', requireAuth, zValidator('query', listJobsQuery), async (c) => {
  return c.json(await jobsService.list(c.req.valid('query')))
})

// ── GET /jobs/live — merged WF+LoRA live snapshot ────
app.get('/live', requireAuth, async (c) => c.json(await jobsService.live()))

// ── GET /jobs/stream — Server-Sent Events feed ───────
// Pushes a fresh live payload every LIVE_TICK_MS as an `event: live` frame.
// The browser's EventSource API can't set custom headers, so token-bearer
// auth is supported via ?token=… as well as the Authorization header.
const LIVE_TICK_MS = 2_000

app.get('/stream', async (c) => {
  // Promote ?token=… into the Authorization header before running requireAuth.
  const qToken = c.req.query('token')
  if (qToken && !c.req.header('Authorization')) {
    c.req.raw.headers.set('Authorization', `Bearer ${qToken}`)
  }
  // Run requireAuth manually so we get its 401 response directly if it rejects;
  // applying it as middleware on this single route would early-return the SSE
  // stream setup instead of producing a proper 401.
  let authed = false
  const authRes = await requireAuth(c, async () => {
    authed = true
  })
  if (!authed) return authRes

  return streamSSE(c, async (stream) => {
    // Initial push so clients don't wait LIVE_TICK_MS for the first frame.
    await stream.writeSSE({ event: 'live', data: JSON.stringify(await jobsService.live()) })
    while (!stream.aborted) {
      await stream.sleep(LIVE_TICK_MS)
      if (stream.aborted) break
      try {
        const data = await jobsService.live()
        await stream.writeSSE({ event: 'live', data: JSON.stringify(data) })
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: e instanceof Error ? e.message : 'tick failed' }),
        })
      }
    }
  })
})

// ── GET /jobs/stats — per-status counts (5s cache) ──
app.get('/stats', requireAuth, async (c) => c.json(await jobsService.stats()))

// ── POST /jobs/:id/force-stop — terminal mark in DB + Redis ──
// Operator escape hatch for jobs no runner will ever finish (trainer lost
// the job, stale rows): force-fails the BullMQ hash and closes the Postgres
// row. No runner is contacted. Optional body.kind disambiguates wf/lora ids.
// Gated on jobs write — same access as the ComfyUI stop; this writes the
// shared gt-workflows queue so it must not be weaker than the gentler stop.
app.post(
  '/:id/force-stop',
  requireAuth,
  requireAccess('jobs', 'write'),
  zValidator('json', forceStopSchema),
  async (c) => {
    try {
      const { kind } = c.req.valid('json')
      const result = await jobsService.forceStop(c.req.param('id'), c.var.user.username, kind)
      return c.json({ ok: true, ...result })
    } catch (err) {
      return httpErrorResponse(c, err)
    }
  },
)

// ── POST /jobs/:id/report — Discord webhook bug report ─
app.post('/:id/report', requireAuth, zValidator('json', jobReportSchema), async (c) => {
  try {
    await jobsService.report(c.req.param('id'), c.req.valid('json'), c.var.user.username)
    return c.json({ ok: true })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
