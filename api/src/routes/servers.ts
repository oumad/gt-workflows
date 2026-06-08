/**
 * Servers HTTP routes. Thin adapter onto the servers service layer:
 *  - services/servers.ts     — list/get/CRUD/insights/incidents/repartition/scrape
 *  - services/serverComfy.ts — ComfyUI + AI Toolkit proxy (stats, logs, gpu, control actions)
 *
 * What lives here: HTTP wiring (auth middleware, query params, returning the
 * service results as JSON / 204).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin, requireCapability } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import { hostnameOf } from '../lib/serverUrl.js'
import { can } from '../lib/permissions.js'
import * as repo from '../repositories/servers.js'
import {
  createServerSchema,
  patchServerSchema,
  reportServerSchema,
  parseIncidentDays,
} from '../validators/servers.js'
import { parseDays } from '../validators/analytics.js'
import * as svc from '../services/servers.js'
import * as comfy from '../services/serverComfy.js'
import * as rdp from '../services/rdp.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /servers ─────────────────────────────────────────
app.get('/', requireAuth, async (c) => c.json(await svc.listServers()))

// ── GET /servers/insights ────────────────────────────────
app.get('/insights', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await svc.getInsights(days))
})

// ── GET /servers/incidents ───────────────────────────────
app.get('/incidents', requireAuth, async (c) => {
  return c.json(await svc.getIncidents(parseIncidentDays(c.req.query('days'))))
})

// ── GET /servers/repartition ─────────────────────────────
app.get('/repartition', requireAuth, async (c) => {
  const days = parseDays(c.req.query('days'))
  return c.json(await svc.getRepartition(days))
})

// ── POST /servers/scrape ─────────────────────────────────
app.post('/scrape', requireAuth, requireAdmin, async (c) => c.json(await svc.scrapeServers()))

// ── POST /servers ────────────────────────────────────────
app.post('/', requireAuth, requireAdmin, zValidator('json', createServerSchema), async (c) => {
  try {
    return c.json(await svc.createServer(c.req.valid('json')), 201)
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id ─────────────────────────────────────
app.get('/:id', requireAuth, async (c) => {
  try {
    return c.json(await svc.getServer(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/jobs ────────────────────────────────
app.get('/:id/jobs', requireAuth, async (c) => {
  try {
    return c.json(await svc.getServerJobs(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/rdp/status ──────────────────────────
// Cheap status preflight for the SetoModal RDP section: does the server
// look reachable, does it have linked credentials? No actual RDP traffic.
// Admin-only because the response leaks the credential id.
app.get('/:id/rdp/status', requireAuth, requireAdmin, async (c) => {
  try {
    return c.json(await rdp.rdpStatus(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /servers/:id/rdp/connect ────────────────────────
// Spawns xfreerdp + Xvfb to validate the stored credentials against the
// host's RDP port. Synchronous — holds the request ~15s while the session
// runs. Admin-only.
app.post('/:id/rdp/connect', requireAuth, requireAdmin, async (c) => {
  try {
    return c.json(await rdp.rdpConnect(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/top-users ───────────────────────────
// Top N GT users by job count on this server over the last `hours` (default 1).
// Powers the "Top users" widget on the server detail page so ops can identify
// who's monopolising a worker in under three clicks.
app.get('/:id/top-users', requireAuth, async (c) => {
  try {
    const hours = Math.min(Math.max(Number(c.req.query('hours') ?? 1), 1), 168)
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 10), 1), 50)
    return c.json(await svc.getTopUsers(c.req.param('id'), { hours, limit }))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/stats ───────────────────────────────
app.get('/:id/stats', requireAuth, async (c) => {
  try {
    return c.json(await svc.getStats24h(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/comfy/stats ─────────────────────────
app.get('/:id/comfy/stats', requireAuth, async (c) => {
  try {
    return c.json(await comfy.getComfyStats(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/comfy/logs ──────────────────────────
app.get('/:id/comfy/logs', requireAuth, async (c) => {
  try {
    return c.json(await comfy.getComfyLogs(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /servers/:id/gpu (AI Toolkit) ────────────────────
app.get('/:id/gpu', requireAuth, async (c) => {
  try {
    return c.json(await comfy.getGpuInfo(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── PATCH /servers/:id ───────────────────────────────────
// Edit-service is the floor (designer + above can call). Inside the handler
// we check the target row's URL shape — a designer can patch a service
// (URL with port) but not a host (port-less). Servers/hosts edit requires
// admin/ops, gated via the per-row check.
app.patch(
  '/:id',
  requireAuth,
  requireCapability('edit-service'),
  zValidator('json', patchServerSchema),
  async (c) => {
    try {
      const id = c.req.param('id')
      const row = await repo.findById(id)
      if (!row) return c.json({ error: 'Not found' }, 404)
      // hostnameOf returns the hostname only; if the URL has no port the
      // serverUrl URL.port is empty — defensive check against URL shape.
      const isHost = (() => {
        try {
          const u = new URL(/^https?:\/\//i.test(row.url) ? row.url : `http://${row.url}`)
          return !u.port
        } catch {
          return true // unparseable → conservative: treat as host
        }
      })()
      if (isHost && !can(c.var.user.role, 'edit-server')) {
        return c.json(
          {
            error: 'Forbidden',
            code: 'missing_capability',
            capability: 'edit-server',
          },
          403,
        )
      }
      void hostnameOf // touch import (used in other routes)
      return c.json(await svc.patchServer(id, c.req.valid('json')))
    } catch (err) {
      return httpErrorResponse(c, err)
    }
  },
)

// ── DELETE /servers/:id ──────────────────────────────────
// Deleting a host AND a service are both admin-only. The frontend gates
// the Delete button by capability ('delete-server' or 'delete-service'),
// both of which are admin/ops; keeping a single requireAdmin here matches.
app.delete('/:id', requireAuth, requireAdmin, async (c) => {
  await svc.deleteServer(c.req.param('id'))
  return c.body(null, 204)
})

// ── POST /servers/:id/report (Discord webhook) ───────────
app.post('/:id/report', requireAuth, zValidator('json', reportServerSchema), async (c) => {
  try {
    await svc.reportServer(c.req.param('id'), c.req.valid('json'), c.var.user.username)
    return c.json({ ok: true })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /servers/:id/comfy/restart ──────────────────────
app.post('/:id/comfy/restart', requireAuth, requireAdmin, async (c) => {
  try {
    await comfy.restartComfy(c.req.param('id'))
    return c.json({ ok: true })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /servers/:id/comfy/empty-vram ───────────────────
app.post('/:id/comfy/empty-vram', requireAuth, requireAdmin, async (c) => {
  try {
    await comfy.emptyVram(c.req.param('id'))
    return c.json({ ok: true })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /servers/:id/comfy/clear-cache ──────────────────
app.post('/:id/comfy/clear-cache', requireAuth, requireAdmin, async (c) => {
  try {
    await comfy.clearCache(c.req.param('id'))
    return c.json({ ok: true })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /servers/:id/probe ──────────────────────────────
app.post('/:id/probe', requireAuth, async (c) => {
  try {
    return c.json(await svc.probeServerNow(c.req.param('id')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
