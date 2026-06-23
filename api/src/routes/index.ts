import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { getSyncStatus } from '../services/sync.js'
import type { AppVariables } from '../types.js'
import authRouter from './auth.js'
import serversRouter from './servers.js'
import workflowsRouter from './workflows.js'
import globalEnvRouter from './globalEnv.js'
import gitRouter from './git.js'
import jobsRouter from './jobs.js'
import wfJobsRouter from './wf-jobs.js'
import loraJobsRouter from './lora-jobs.js'
import usersRouter from './users.js'
import clientsRouter from './clients.js'
import analyticsRouter from './analytics.js'
import calendarRouter from './calendar.js'
import credentialsRouter from './credentials.js'
import setoRouter from './seto.js'
import statusRouter from './status.js'
import personalTokensRouter from './personalTokens.js'
import mcpRouter from './mcp.js'
import mcpCatalogRouter from './mcpCatalog.js'

const api = new Hono<{ Variables: AppVariables }>()

// ── GET /api/health — public liveness + readiness probe ──
// No auth: the frontend polls this to detect when the backend is unreachable
// (request fails / non-2xx) and whether the initial Redis→Postgres sync has
// completed (`sync.firstSyncDone`). Lives under /api so the Vite dev proxy and
// any /api gateway route it without extra config.
api.get('/health', async (c) => {
  const sync = getSyncStatus()
  try {
    await db.execute(sql`SELECT 1`)
    return c.json({ ok: true, db: 'up', sync, ts: new Date().toISOString() })
  } catch (err) {
    return c.json({ ok: false, db: 'down', sync, error: String(err) }, 503)
  }
})

api.route('/auth', authRouter) // no requireAuth — public login endpoint
api.route('/servers', serversRouter)
api.route('/workflows', workflowsRouter)
api.route('/global-env', globalEnvRouter) // WS globalEnv bindings (key -> url|url[])
api.route('/git', gitRouter) // read-only git status (Phase 3)
api.route('/jobs', jobsRouter) // unified list/live/stats across WF + LoRA
api.route('/wf-jobs', wfJobsRouter) // WF-specific: detail, logs, avg-duration
api.route('/lora-jobs', loraJobsRouter) // LoRA-specific: detail, ingest, status webhook
api.route('/users', usersRouter) // internal staff
api.route('/gt-users', clientsRouter) // external gt-workflows users
api.route('/analytics', analyticsRouter)
api.route('/calendar', calendarRouter)
api.route('/credentials', credentialsRouter)
api.route('/seto', setoRouter)
api.route('/status', statusRouter)
api.route('/personal-tokens', personalTokensRouter) // long-lived bearer tokens (per-user)
api.route('/mcp', mcpRouter) // Model Context Protocol — token-auth only
api.route('/mcp-catalog', mcpCatalogRouter) // read-only tool catalog — JWT auth (Preferences UI)

export default api
