/**
 * Git routes. Phase 3 is read-only: a single status endpoint backing the
 * workflows banner. Mutating endpoints (update/publish) land in a later phase.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAccess } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import * as git from '../services/git.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /api/git/status — git state for the workflows chip ──
app.get('/status', requireAuth, async (c) => {
  try {
    return c.json(await git.status())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /api/git/switch — change branch (allowed set only; refused when dirty) ──
app.post(
  '/switch',
  requireAccess('workflows', 'write'),
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
app.post('/update', requireAccess('workflows', 'write'), async (c) => {
  try {
    return c.json(await git.update())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /api/git/publish — validate + squash + ff-only push ──
app.post('/publish', requireAccess('workflows', 'write'), async (c) => {
  try {
    return c.json(await git.publish())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /api/git/discard — drop all local changes (snapshotted to History) ──
app.post('/discard', requireAccess('workflows', 'write'), async (c) => {
  try {
    return c.json(await git.discard())
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
