import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { db, users } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import {
  derivePrimaryRole,
  deriveIsAdmin,
  ROLES,
  type Role,
} from '../lib/permissions.js'
import type { AppVariables } from '../types.js'

/* ─── Shared schemas ────────────────────────────────────────────
   Username / password rules are enforced in one place so create, /me PATCH
   and password endpoints can't drift. Match the existing /me PATCH regex
   (lowercase a-z0-9._-, 2–64 chars). */
const usernameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9._-]+$/, 'lowercase letters, numbers, . _ -')
const passwordSchema = z.string().min(8).max(256)
const roleSchema = z.enum(ROLES as readonly [Role, ...Role[]])

type DbUserRow = typeof users.$inferSelect

/** Project a user row to its wire shape: strip secrets, add the derived
 *  `role` + canonical `isAdmin`. Every returned-user code path goes through
 *  this so the frontend always sees the same shape. */
function projectUser(row: Omit<DbUserRow, 'passwordHash'>) {
  const roles = row.roles ?? []
  const effective =
    roles.length > 0 ? roles : row.isAdmin ? ['admin'] : ['designer']
  return {
    ...row,
    roles: effective,
    role: derivePrimaryRole(effective),
    isAdmin: deriveIsAdmin(effective),
  }
}

const app = new Hono<{ Variables: AppVariables }>()

/** Count how many users currently have effective admin privileges. Used to
 *  block the last-admin-standing from being deleted or demoted. Cheap query
 *  — runs only when the action would meaningfully affect this. */
async function adminCount(): Promise<number> {
  const rows = await db.query.users.findMany({ columns: { roles: true, isAdmin: true } })
  return rows.filter((r) => deriveIsAdmin(r.roles) || r.isAdmin).length
}

// ── GET /users/me ─────────────────────────────
app.get('/me', requireAuth, async (c) => {
  const row = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, c.var.user.id),
    columns: { passwordHash: false },
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(projectUser(row))
})

// ── POST /users/me/password — change own password ─
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .strict()

app.post(
  '/me/password',
  requireAuth,
  zValidator('json', changePasswordSchema),
  async (c) => {
    const me = c.var.user
    const { currentPassword, newPassword } = c.req.valid('json')

    const row = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, me.id),
      columns: { id: true, passwordHash: true },
    })
    if (!row) return c.json({ error: 'Not found' }, 404)
    if (!row.passwordHash) {
      // Account has no password yet (created via the bootstrap admin path,
      // never set one). Refuse the change — the caller should go through
      // the admin reset path so we don't normalize a "no password" state.
      return c.json({ error: 'No password is set for this account' }, 400)
    }
    const valid = await verifyPassword(currentPassword, row.passwordHash)
    if (!valid) return c.json({ error: 'Current password is incorrect' }, 401)
    if (currentPassword === newPassword) {
      return c.json({ error: 'New password must differ from current' }, 400)
    }
    const hash = await hashPassword(newPassword)
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, me.id))
    return c.body(null, 204)
  },
)

// ── PATCH /users/me ───────────────────────────
const patchMeSchema = z.object({ username: usernameSchema }).strict()

app.patch('/me', requireAuth, zValidator('json', patchMeSchema), async (c) => {
  const me = c.var.user
  const { username } = c.req.valid('json')
  const next = username.toLowerCase().trim()

  const taken = await db.query.users.findFirst({
    where: (u, { eq, and, ne }) => and(eq(u.username, next), ne(u.id, me.id)),
  })
  if (taken) return c.json({ error: 'Username is already taken' }, 409)

  const [row] = await db
    .update(users)
    .set({ username: next })
    .where(eq(users.id, me.id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  const { passwordHash: _pw, ...safe } = row
  return c.json(projectUser(safe))
})

// ── GET /users ────────────────────────────────
app.get('/', requireAuth, requireAdmin, async (c) => {
  const rows = await db.query.users.findMany({
    orderBy: (u, { asc }) => asc(u.username),
    columns: { passwordHash: false },
  })
  return c.json(rows.map(projectUser))
})

// ── GET /users/:id ────────────────────────────
app.get('/:id', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const row = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, id),
    columns: { passwordHash: false },
  })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(projectUser(row))
})

// ── PATCH /users/:id ──────────────────────────
// Admin can set the role (preferred) OR write the raw roles array. Setting
// `role` overrides `roles` — the user holds exactly one role at a time
// today, the array shape stays around for future multi-role layering.
// `isAdmin` is now derived from role, so accepting it directly is mostly
// legacy compat — admin → adds 'admin' to roles, false → no-op.
const patchSchema = z
  .object({
    role: z.enum(ROLES as readonly [Role, ...Role[]]).optional(),
    roles: z.array(z.string()).optional(),
    isAdmin: z.boolean().optional(),
  })
  .strict()

// ── POST /users — admin creates a new user ──
const createUserSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    role: roleSchema,
  })
  .strict()

app.post(
  '/',
  requireAuth,
  requireAdmin,
  zValidator('json', createUserSchema),
  async (c) => {
    const { username, password, role } = c.req.valid('json')
    const normalized = username.toLowerCase().trim()

    const taken = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.username, normalized),
      columns: { id: true },
    })
    if (taken) return c.json({ error: 'Username is already taken' }, 409)

    const hash = await hashPassword(password)
    const [row] = await db
      .insert(users)
      .values({
        username: normalized,
        passwordHash: hash,
        roles: [role],
        isAdmin: role === 'admin' || role === 'ops',
      })
      .returning()
    if (!row) return c.json({ error: 'Failed to create user' }, 500)
    const { passwordHash: _pw, ...safe } = row
    return c.json(projectUser(safe), 201)
  },
)

// ── DELETE /users/:id — admin removes a user ──
// Refuses if you're deleting yourself OR you're about to leave the system
// with zero admins (foot-gun: lock everyone out).
app.delete('/:id', requireAuth, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const me = c.var.user
  if (id === me.id) return c.json({ error: 'You cannot delete your own account' }, 400)

  const target = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, id),
    columns: { id: true, roles: true, isAdmin: true },
  })
  if (!target) return c.json({ error: 'Not found' }, 404)

  const targetIsAdmin = deriveIsAdmin(target.roles) || target.isAdmin
  if (targetIsAdmin && (await adminCount()) <= 1) {
    return c.json(
      { error: 'Refusing to delete the only remaining admin — promote another user first' },
      400,
    )
  }
  await db.delete(users).where(eq(users.id, id))
  return c.body(null, 204)
})

// ── POST /users/:id/password — admin resets another user's password ──
const adminResetPasswordSchema = z
  .object({ newPassword: passwordSchema })
  .strict()

app.post(
  '/:id/password',
  requireAuth,
  requireAdmin,
  zValidator('json', adminResetPasswordSchema),
  async (c) => {
    const id = c.req.param('id')
    const { newPassword } = c.req.valid('json')
    const exists = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, id),
      columns: { id: true },
    })
    if (!exists) return c.json({ error: 'Not found' }, 404)
    const hash = await hashPassword(newPassword)
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, id))
    return c.body(null, 204)
  },
)

app.patch('/:id', requireAuth, requireAdmin, zValidator('json', patchSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  // Resolve the next roles array. `role` wins, then explicit `roles`, then
  // `isAdmin` (legacy). If none are set, the row is untouched on roles.
  const update: Partial<typeof users.$inferInsert> = {}
  if (body.role !== undefined) {
    update.roles = [body.role]
    update.isAdmin = body.role === 'admin' || body.role === 'ops'
  } else if (body.roles !== undefined) {
    update.roles = body.roles
    update.isAdmin = deriveIsAdmin(body.roles)
  } else if (body.isAdmin !== undefined) {
    // Legacy: if only isAdmin is provided, translate to a role array so
    // we don't leave the row's roles[] inconsistent with the flag.
    update.isAdmin = body.isAdmin
    update.roles = body.isAdmin ? ['admin'] : ['designer']
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  // Last-admin guard: if this patch would strip admin from the only remaining
  // admin, refuse. Same safeguard as the DELETE path — keeps the system from
  // locking itself out.
  if (update.isAdmin === false) {
    const target = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, id),
      columns: { roles: true, isAdmin: true },
    })
    if (target && (deriveIsAdmin(target.roles) || target.isAdmin)) {
      if ((await adminCount()) <= 1) {
        return c.json(
          { error: 'Refusing to demote the only remaining admin — promote another user first' },
          400,
        )
      }
    }
  }

  const [row] = await db.update(users).set(update).where(eq(users.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  const { passwordHash: _pw, ...safe } = row
  return c.json(projectUser(safe))
})

export default app
