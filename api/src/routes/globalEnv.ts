/**
 * Workflow Studio globalEnv bindings — the per-env map (key -> url | url[]) that
 * `globalEnv.<key>` tokens in workflows resolve against. Read for the binding
 * editor; writes are the deliberate human edit path (PUT), distinct from the
 * additive sync path (a later phase). Backed by WS_CONFIG_PATH; see
 * services/globalEnv.ts.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { httpErrorResponse } from '../lib/httpError.js'
import { loadGlobalEnv, setGlobalEnvKey } from '../services/globalEnv.js'
import { globalEnvBlock } from '../services/workflows.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /api/global-env — current binding map (key -> url | url[]) ──
app.get('/', requireAuth, (c) => c.json(loadGlobalEnv()))

// ── GET /api/global-env/block — the WS-config snippet to add/restore ──
// All referenced keys (+ a default server), for an operator to copy into
// Workflow Studio's config.
app.get('/block', requireAuth, (c) => c.json(globalEnvBlock()))

// ── PUT /api/global-env/:key — set/replace a binding's URL(s) ──
// May overwrite an existing value (deliberate edit); snapshots first.
app.put(
  '/:key',
  requireAdmin,
  zValidator('json', z.object({ urls: z.array(z.string().min(1)).min(1) })),
  (c) => {
    try {
      return c.json(setGlobalEnvKey(c.req.param('key'), c.req.valid('json').urls))
    } catch (err) {
      return httpErrorResponse(c, err)
    }
  },
)

export default app
