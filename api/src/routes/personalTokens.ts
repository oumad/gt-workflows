/**
 * Personal token management — HTTP CRUD for the new long-lived bearer-token
 * system (replaces the single per-user weekly-rotating api key).
 *
 * Auth: this router is JWT-only. You shouldn't be able to mint or revoke
 * tokens *with* a token — that would let a leaked token quietly rotate itself
 * before the user notices. Browser session (or dev bypass) only.
 *
 * Roles:
 *  - Any authenticated user can list / create / revoke their own tokens.
 *  - Admins can list across all users and revoke anyone's token. Admins can
 *    also create tokens on behalf of another user (the "service account"
 *    workflow: mint a token for a synthetic `gt-plugins-sync` user).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import {
  createPersonalToken,
  listAllPersonalTokens,
  listPersonalTokensForUser,
  revokePersonalToken,
} from '../services/personalTokens.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

const createSchema = z
  .object({
    label: z.string().min(1).max(80),
    scopes: z.array(z.string()).optional(),
    /** Admin-only — mint a token on behalf of another user (e.g. a service
     *  account). Ignored for non-admin callers. */
    userId: z.string().uuid().optional(),
  })
  .strict()

// ── GET /personal-tokens ─────────────────────────────────
// Lists the caller's tokens. `?all=1` returns everyone's (admin only).
app.get('/', requireAuth, async (c) => {
  const me = c.var.user
  const wantsAll = c.req.query('all') === '1'
  if (wantsAll) {
    if (!me.isAdmin) return c.json({ error: 'Forbidden' }, 403)
    return c.json(await listAllPersonalTokens())
  }
  return c.json(await listPersonalTokensForUser(me.id))
})

// ── POST /personal-tokens ────────────────────────────────
// Returns { token, ...tokenView }. `token` is the raw secret and is the
// only time it will ever be transmitted — the caller MUST display/copy it
// immediately and warn the user it cannot be recovered.
app.post('/', requireAuth, zValidator('json', createSchema), async (c) => {
  const me = c.var.user
  const body = c.req.valid('json')
  const targetUserId = body.userId && me.isAdmin ? body.userId : me.id
  const { token, row } = await createPersonalToken({
    userId: targetUserId,
    label: body.label,
    scopes: body.scopes,
  })
  return c.json({ token, ...row }, 201)
})

// ── DELETE /personal-tokens/:id ──────────────────────────
// Users revoke their own tokens; admins can revoke any.
app.delete('/:id', requireAuth, async (c) => {
  const me = c.var.user
  const id = c.req.param('id')
  const ok = await revokePersonalToken(id, me.isAdmin ? null : me.id)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

// ── GET /personal-tokens/users/:userId — admin: list a user's tokens ──
// Convenience for the admin users page; equivalent to filtering /all=1.
app.get('/users/:userId', requireAuth, requireAdmin, async (c) => {
  return c.json(await listPersonalTokensForUser(c.req.param('userId')))
})

export default app
