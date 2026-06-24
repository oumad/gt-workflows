/**
 * Workflow Studio globalEnv bindings — the per-env map (key -> url | url[]) that
 * `<globalEnv.key>` expressions in workflows resolve against. READ-ONLY: CM
 * never writes WS config (the per-env binding it owns lives in the gitignored
 * workflow-envtable.json). Backed by WS_CONFIG_PATH; see services/globalEnv.ts.
 */
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { loadGlobalEnv } from '../services/globalEnv.js'
import { globalEnvBlock } from '../services/workflows.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /api/global-env — current binding map (key -> url | url[]) ──
app.get('/', requireAuth, (c) => c.json(loadGlobalEnv()))

// ── GET /api/global-env/block — the WS-config snippet to add/restore ──
// All referenced keys (+ a default server), for an operator to copy into
// Workflow Studio's config.
app.get('/block', requireAuth, (c) => c.json(globalEnvBlock()))

export default app
