/**
 * Seto — the in-app "doc" persona.
 *
 *   /api/seto/config   GET / PATCH (admin) — adjustable thresholds
 *   /api/seto/check    POST                — run the rule set against a
 *                                            live job / history job /
 *                                            service / server and return a
 *                                            list of findings.
 *
 * Thin HTTP adapter onto services/seto.ts. The rule evaluators + threshold
 * defaults live there; this file just wires URLs, auth, and validation.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin, requireAccess } from '../middleware/auth.js'
import { patchConfigSchema, checkSchema } from '../validators/seto.js'
import * as setoService from '../services/seto.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /seto/config ────────────────────────────────────────
// Anyone with auth can read the thresholds (the modal renders the numbers
// it would compare against in "warn" messages). Writes are admin-only.
app.get('/config', requireAuth, async (c) => c.json(await setoService.getConfig()))

// ── PATCH /seto/config — admin only ─────────────────────────
app.patch(
  '/config',
  requireAuth,
  requireAdmin,
  zValidator('json', patchConfigSchema),
  async (c) => {
    return c.json(await setoService.patchConfig(c.req.valid('json')))
  },
)

// ── POST /seto/check ────────────────────────────────────────
// Gated on services write so read-only accounts can't run the rule engine —
// admin / operator pass.
app.post(
  '/check',
  requireAuth,
  requireAccess('services', 'write'),
  zValidator('json', checkSchema),
  async (c) => {
    const { kind, id } = c.req.valid('json')
    try {
      return c.json(await setoService.runCheck(kind, id, c.var.user?.username))
    } catch (err) {
      console.error('[seto] check failed:', err instanceof Error ? err.message : err)
      return c.json({ error: 'Check failed' }, 500)
    }
  },
)

export default app
