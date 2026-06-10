import type { MiddlewareHandler } from 'hono'
import type { AppVariables, AuthUser } from '../types.js'
import { db, users } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { verify } from 'hono/jwt'
import { config } from '../config/index.js'
import { resolveBearerToken, touchLastUsed } from '../services/personalTokens.js'
import {
  type Capability,
  type Role,
  can,
  derivePrimaryRole,
  deriveIsAdmin,
} from '../lib/permissions.js'

/** Coffee-maker personal-access-token prefix. Recognised by requireAuth and
 *  the MCP middleware so a `Bearer cm_pat_...` header is treated as a token
 *  lookup, while everything else falls through to JWT verification. */
const PAT_PREFIX = 'cm_pat_'

/** Project a DB user row into the AuthUser shape every middleware sets on
 *  c.var.user. Single helper so JWT / API-key / personal-token paths agree
 *  on field derivation. */
function authUserFromRow(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    username: row.username,
    isAdmin: deriveIsAdmin(row.roles) || row.isAdmin,
    roles: row.roles,
    role: derivePrimaryRole(row.roles.length > 0 ? row.roles : row.isAdmin ? ['admin'] : []),
  }
}

const BYPASS_AUTH = config.isDev && config.AUTH_BYPASS

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  // Already authenticated by an earlier middleware (e.g. apiKeyAuth on the
  // workflows router) — don't demand a JWT on top.
  if (c.var.user) return next()

  // Dev bypass — still needs a DB hit but only in local dev mode
  if (BYPASS_AUTH) {
    const devUser = await db.query.users.findFirst({ where: eq(users.isAdmin, true) })
    if (devUser) {
      c.set('user', {
        id: devUser.id,
        username: devUser.username,
        isAdmin: deriveIsAdmin(devUser.roles) || devUser.isAdmin,
        roles: devUser.roles,
        role: derivePrimaryRole(
          devUser.roles.length > 0 ? devUser.roles : devUser.isAdmin ? ['admin'] : [],
        ),
      })
      return next()
    }
  }

  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // Personal access tokens are recognised by their prefix and resolved
    // against the personal_tokens table. The prefix-and-then-hash pattern
    // means JWTs (which never have this prefix) keep their fast pure-crypto
    // path with no DB hit.
    if (token.startsWith(PAT_PREFIX)) {
      try {
        const resolved = await resolveBearerToken(token)
        if (resolved) {
          c.set('user', authUserFromRow(resolved.user))
          touchLastUsed(resolved.token.id, resolved.token.lastUsedAt)
          db.update(users)
            .set({ lastSeenAt: new Date() })
            .where(eq(users.id, resolved.user.id))
            .catch(() => {
              /* non-critical */
            })
          return next()
        }
      } catch {
        /* fall through to 401 */
      }
      // Header had cm_pat_ prefix but didn't resolve — clear intent, hard 401.
      return c.json({ error: 'Invalid personal token' }, 401)
    }

    try {
      // Pure cryptographic verify — no DB round-trip.
      // isAdmin/roles are embedded in the token at login time.
      const payload = (await verify(token, config.JWT_SECRET, 'HS256')) as {
        sub: string
        username?: string
        isAdmin?: boolean
        roles?: string[]
        role?: Role
      }

      if (payload.sub) {
        const roles = payload.roles ?? []
        const authUser: AuthUser = {
          id: payload.sub,
          username: payload.username ?? '',
          // Effective admin = JWT-stamped isAdmin OR derived from current roles.
          // Both are kept in sync at login but tokens older than a role change
          // would still authorise correctly if the roles array was migrated.
          isAdmin: deriveIsAdmin(roles) || payload.isAdmin === true,
          roles,
          role:
            payload.role ??
            derivePrimaryRole(roles.length > 0 ? roles : payload.isAdmin ? ['admin'] : []),
        }
        c.set('user', authUser)

        // Stamp lastSeenAt without blocking the request — DB hiccups must not cause 401s
        db.update(users)
          .set({ lastSeenAt: new Date() })
          .where(eq(users.id, authUser.id))
          .catch(() => {
            /* non-critical */
          })

        return next()
      }
    } catch {
      // Invalid / expired token — fall through to 401
    }
  }

  return c.json({ error: 'Unauthorized' }, 401)
}

/**
 * Standalone personal-token gate — does NOT fall back to JWT.
 *
 * Use this on routes that only accept programmatic clients (the MCP transport
 * is the canonical example: browsers don't speak MCP, so allowing a stale JWT
 * here only widens the attack surface). Requires `Authorization: Bearer
 * cm_pat_...`; anything else is a 401.
 *
 * Sets `c.var.user` exactly like requireAuth does, so downstream
 * requireCapability checks work identically.
 */
export const personalTokenAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (
  c,
  next,
) => {
  if (c.var.user) return next()

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Personal token required' }, 401)
  }
  const token = authHeader.slice(7)
  if (!token.startsWith(PAT_PREFIX)) {
    return c.json({ error: 'Personal token required' }, 401)
  }

  let resolved
  try {
    resolved = await resolveBearerToken(token)
  } catch {
    return c.json({ error: 'Auth check failed' }, 503)
  }
  if (!resolved) return c.json({ error: 'Invalid personal token' }, 401)

  c.set('user', authUserFromRow(resolved.user))
  touchLastUsed(resolved.token.id, resolved.token.lastUsedAt)
  db.update(users)
    .set({ lastSeenAt: new Date() })
    .where(eq(users.id, resolved.user.id))
    .catch(() => {
      /* non-critical */
    })
  return next()
}

/** Admin-only routes. Some routes are registered with only `requireAdmin` (no
 *  `requireAuth` ahead of it), so this middleware authenticates the request
 *  itself before checking the admin flag — `c.var.user` would otherwise be
 *  undefined and every call would 403.
 *  Admin OR ops passes — they share the same effective set. */
export const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  if (!c.var.user) {
    // Run requireAuth's auth logic. If it short-circuits with a 401 response,
    // return that directly; otherwise fall through to the admin check.
    let authProceeded = false
    const res = await requireAuth(c, async () => {
      authProceeded = true
    })
    if (!authProceeded) return res
  }
  if (!c.var.user?.isAdmin) return c.json({ error: 'Forbidden' }, 403)
  return next()
}

/** Gate a route on a specific capability — the granular alternative to
 *  requireAdmin. Use this when a route should accept designer (e.g.
 *  edit-service) but not viewer, or vice-versa. Authenticates first if the
 *  request hasn't been through requireAuth yet — same pattern as requireAdmin. */
export function requireCapability(
  capability: Capability,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    if (!c.var.user) {
      let authProceeded = false
      const res = await requireAuth(c, async () => {
        authProceeded = true
      })
      if (!authProceeded) return res
    }
    const user = c.var.user
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    if (!can(user.role, capability)) {
      return c.json({ error: 'Forbidden', code: 'missing_capability', capability }, 403)
    }
    return next()
  }
}
