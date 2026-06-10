/**
 * Personal tokens — long-lived, per-user bearer credentials. Replaces the
 * single per-user `api_key_hash` column on `users` with a proper many-tokens
 * table that supports labels, scopes, revocation and `lastUsedAt` tracking.
 *
 * Used for:
 *  - Programmatic access to /api/* HTTP routes (X-API-Key replacement).
 *  - MCP transport at /api/mcp (Authorization: Bearer ...).
 *
 * Same wire format as the legacy api key (random 24-byte CSPRNG hex, branded
 * prefix). The prefix is `cm_pat_` ("Coffee-Maker Personal Access Token") so
 * leaked tokens are immediately recognizable in grep / logs / GitHub secret
 * scanning.
 *
 * Hashing is sha-256 of the raw token. That's safe here because each token is
 * 24 bytes of CSPRNG entropy (192 bits) — there is nothing to brute-force, no
 * rainbow table to defeat. argon2/bcrypt would be overkill and slow down every
 * request.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, personalTokens, users } from '../db/index.js'
import type { PersonalToken } from '../db/index.js'

/* ─── Crypto primitives ────────────────────────────────────────── */

const TOKEN_PREFIX = 'cm_pat_'
const PREFIX_LEN_FOR_INDEX = 16 // 'cm_pat_' + 9 hex chars — short, distinctive

/** Generate a new opaque personal token. Returned to the caller exactly once. */
export function generatePersonalToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString('hex')
}

/** SHA-256 hex of a token. The only form ever stored. */
export function hashPersonalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time hash equality. Both inputs are 64-char hex strings. */
function hashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** First N chars of the raw token — stored so the UI can display "cm_pat_abc…"
 *  without ever holding the secret. Also used to narrow the auth lookup before
 *  the constant-time hash compare. */
function tokenPrefixForIndex(token: string): string {
  return token.slice(0, PREFIX_LEN_FOR_INDEX)
}

/* ─── Wire DTO ────────────────────────────────────────────────── */

/** Public shape returned to clients. The hash is never included. The `token`
 *  field is only present on the create response (one-shot reveal). */
export type PersonalTokenView = {
  id: string
  userId: string
  label: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

function projectToken(row: PersonalToken): PersonalTokenView {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    prefix: row.prefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }
}

/* ─── CRUD ─────────────────────────────────────────────────────── */

export type CreateTokenInput = {
  userId: string
  label: string
  scopes?: string[]
}

export async function createPersonalToken(
  input: CreateTokenInput,
): Promise<{ token: string; row: PersonalTokenView }> {
  const token = generatePersonalToken()
  const [row] = await db
    .insert(personalTokens)
    .values({
      userId: input.userId,
      label: input.label.trim() || 'Personal token',
      prefix: tokenPrefixForIndex(token),
      hash: hashPersonalToken(token),
      scopes: input.scopes ?? [],
    })
    .returning()
  if (!row) throw new Error('Failed to create personal token')
  return { token, row: projectToken(row) }
}

export async function listPersonalTokensForUser(userId: string): Promise<PersonalTokenView[]> {
  const rows = await db.query.personalTokens.findMany({
    where: (t, { eq }) => eq(t.userId, userId),
    orderBy: (t) => [desc(t.createdAt)],
  })
  return rows.map(projectToken)
}

export async function listAllPersonalTokens(): Promise<PersonalTokenView[]> {
  const rows = await db.query.personalTokens.findMany({
    orderBy: (t) => [desc(t.createdAt)],
  })
  return rows.map(projectToken)
}

export async function revokePersonalToken(
  id: string,
  /** When non-null, only revokes if the row belongs to this user (the
   *  /me/personal-tokens endpoint passes the caller's id; admin endpoints
   *  pass null to revoke anyone's token). */
  ownerId: string | null,
): Promise<boolean> {
  const [row] = await db
    .update(personalTokens)
    .set({ revokedAt: new Date() })
    .where(
      ownerId
        ? and(
            eq(personalTokens.id, id),
            eq(personalTokens.userId, ownerId),
            isNull(personalTokens.revokedAt),
          )
        : and(eq(personalTokens.id, id), isNull(personalTokens.revokedAt)),
    )
    .returning({ id: personalTokens.id })
  return !!row
}

/* ─── Auth lookup ──────────────────────────────────────────────── */

export type ResolvedToken = {
  token: PersonalToken
  user: typeof users.$inferSelect
}

/**
 * Resolve a raw bearer token to its DB row + owning user, or null if invalid.
 * Returns null for:
 *   - Wrong prefix shape
 *   - No matching prefix index row
 *   - Hash mismatch (constant-time)
 *   - Token has been revoked
 *
 * Does NOT throw — auth failure is just `null` so the caller decides whether
 * to 401 or fall through to the next auth mechanism.
 */
export async function resolveBearerToken(rawToken: string): Promise<ResolvedToken | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null
  const prefix = tokenPrefixForIndex(rawToken)
  const hash = hashPersonalToken(rawToken)

  // Index lookup by prefix narrows the search to a handful of rows; the
  // constant-time hash compare is the actual auth.
  const candidates = await db.query.personalTokens.findMany({
    where: (t, { eq, and, isNull }) => and(eq(t.prefix, prefix), isNull(t.revokedAt)),
  })

  for (const t of candidates) {
    if (hashesMatch(t.hash, hash)) {
      const user = await db.query.users.findFirst({ where: eq(users.id, t.userId) })
      if (!user) return null
      return { token: t, user }
    }
  }
  return null
}

/** Stamp `last_used_at` to now. Fire-and-forget — any failure is non-critical
 *  and must not impact the request that triggered it. Debounce by checking the
 *  current value first (skip if updated in the last minute) to avoid one write
 *  per request from a chatty MCP client. */
export function touchLastUsed(tokenId: string, currentLastUsedAt: Date | null): void {
  if (currentLastUsedAt && Date.now() - currentLastUsedAt.getTime() < 60_000) return
  db.update(personalTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalTokens.id, tokenId))
    .catch(() => {
      /* non-critical */
    })
}
