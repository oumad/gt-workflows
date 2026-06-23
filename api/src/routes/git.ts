/**
 * Git routes. Phase 3 is read-only: a single status endpoint backing the
 * workflows banner. Mutating endpoints (update/publish) land in a later phase.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import * as git from '../services/git.js'
import { serverNudge } from '../services/workflows.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /api/git/status — git state + "needs a server" nudge ──
app.get('/status', requireAuth, async (c) => {
  try {
    const status = await git.status()
    // Nudge only when enabled (the scan is pointless otherwise, and the banner
    // is hidden anyway).
    const nudge = status.enabled ? serverNudge() : { needsServer: 0 }
    return c.json({ ...status, ...nudge })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /api/git/switch — change branch (allowed set only; refused when dirty) ──
app.post(
  '/switch',
  requireAdmin,
  zValidator('json', z.object({ branch: z.string().min(1) })),
  async (c) => {
    try {
      return c.json(await git.switchBranch(c.req.valid('json').branch))
    } catch (err) {
      return httpErrorResponse(c, err)
    }
  },
)

// ── POST /api/git/update — conflict-free update (snapshot + reset + take-theirs) ──
app.post('/update', requireAdmin, async (c) => {
  try {
    return c.json(await git.update())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /api/git/publish — validate + squash + ff-only push ──
app.post('/publish', requireAdmin, async (c) => {
  try {
    return c.json(await git.publish())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /api/git/discard — drop all local changes (snapshotted to History) ──
app.post('/discard', requireAdmin, async (c) => {
  try {
    return c.json(await git.discard())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
