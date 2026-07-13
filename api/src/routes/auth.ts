import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { sign } from 'hono/jwt'
import { config } from '../config/index.js'
import { db, users } from '../db/index.js'
import { verifyPassword } from '../lib/password.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { derivePrimaryRole, deriveIsAdmin, normalizeRoles } from '../lib/permissions.js'

const app = new Hono()

const JWT_EXPIRES_IN = 60 * 60 * 24 * 30 // 30 days — see F06 for refresh-token plan

const loginSchema = z.object({
  username: z
    .string()
    .min(1)
    .trim()
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1),
})

// 5 attempts per minute per IP. Slows credential-stuffing without affecting
// legitimate users who get their password right within a few tries.
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 })

// ── POST /auth/login ──────────────────────────
app.post('/login', loginLimiter, zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json')

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  })

  if (!user || !user.passwordHash) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Fire-and-forget — don't make the user wait on the DB write (B01).
  db.update(users)
    .set({ lastSeenAt: new Date() })
    .where(eq(users.id, user.id))
    .catch(() => {
      /* non-critical */
    })

  // Derive role + admin flag from the user's role array. Legacy role strings
  // (ops/designer/viewer) are normalised to the current set. isAdmin=true
  // users without an explicit role land on 'admin'; empty roles + isAdmin=false
  // defaults to 'operator' so existing daily-driver accounts keep working.
  const normalized = normalizeRoles(user.roles)
  const effectiveRoles = normalized.length > 0 ? normalized : user.isAdmin ? ['admin'] : ['operator']
  const role = derivePrimaryRole(effectiveRoles)
  const isAdmin = deriveIsAdmin(effectiveRoles)

  const now = Math.floor(Date.now() / 1000)
  const token = await sign(
    {
      sub: user.id,
      username: user.username,
      isAdmin,
      roles: effectiveRoles,
      role,
      iat: now,
      exp: now + JWT_EXPIRES_IN,
    },
    config.JWT_SECRET,
    'HS256',
  )

  const { passwordHash: _pw, ...rest } = user
  return c.json({
    token,
    user: { ...rest, isAdmin, roles: effectiveRoles, role },
  })
})

export default app
