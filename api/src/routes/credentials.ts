/**
 * HTTP routes for credentials. Thin adapter: validate input, delegate to
 * `services/credentials`, translate service errors → HTTP status codes.
 * No DB calls or business logic should appear in this file.
 *
 * This is the canonical pattern for new routes — see /api/src/services/credentials.ts
 * and /api/src/repositories/credentials.ts. The plan is to migrate the rest
 * of the routes/* files onto this layout incrementally (F11 in the audit).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import { createCredentialSchema, patchCredentialSchema } from '../validators/credentials.js'
import * as credentialsService from '../services/credentials.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

app.get('/', requireAuth, requireAdmin, async (c) => {
  return c.json(await credentialsService.list())
})

app.post('/', requireAuth, requireAdmin, zValidator('json', createCredentialSchema), async (c) => {
  try {
    return c.json(await credentialsService.create(c.req.valid('json')))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

app.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  zValidator('json', patchCredentialSchema),
  async (c) => {
    try {
      await credentialsService.patch(c.req.param('id'), c.req.valid('json'))
      return c.json({ ok: true })
    } catch (err) {
      return httpErrorResponse(c, err)
    }
  },
)

app.delete('/:id', requireAuth, requireAdmin, async (c) => {
  try {
    await credentialsService.remove(c.req.param('id'))
    return c.json({ ok: true })
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

export default app
