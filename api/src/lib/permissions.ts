/**
 * Role-based access control — per-brew read/write.
 *
 * Every top-level tool ("brew") is either invisible, read-only, or writable
 * for a role. One table drives the sidebar, the route guards, and the UI
 * edit affordances:
 *
 *   admin    — write on everything
 *   operator — Workflows / Jobs / Services / Doctor / Analytics / Calendar / GT Users
 *   master   — Workflows + Jobs read-only, Analytics, GT Users ("MasterUser")
 *   user     — Workflows + Jobs read-only, Analytics
 *
 * A user holds zero or more roles in `users.roles` (text[]). The *primary*
 * role is the first one recognised in priority order. Legacy role strings
 * (ops / designer / viewer) are normalised at read time so old DB rows and
 * old JWTs keep working without a migration.
 *
 * Mirrored in frontend/src/lib/permissions.ts — edit both sides together.
 */

export type Role = 'admin' | 'operator' | 'master' | 'user'

export const ROLES: readonly Role[] = ['admin', 'operator', 'master', 'user']
const ROLE_SET = new Set<string>(ROLES)

/** Pre-rename role strings still present in DB rows / long-lived JWTs. */
const LEGACY_ROLE: Record<string, Role> = {
  ops: 'operator',
  designer: 'operator',
  viewer: 'user',
}

/** Map any historical role string onto the current 4-role set. */
export function normalizeRoles(roles: readonly string[]): Role[] {
  const out: Role[] = []
  for (const r of roles) {
    const norm = ROLE_SET.has(r) ? (r as Role) : LEGACY_ROLE[r]
    if (norm && !out.includes(norm)) out.push(norm)
  }
  return out
}

/** Priority order for resolving a primary role when a user has multiple. */
const ROLE_PRIORITY: Role[] = ['admin', 'operator', 'master', 'user']

/** Resolve the effective role for a user. Unknown/empty → 'user' (the
 *  most restricted role: read-only workflows/jobs/analytics). */
export function derivePrimaryRole(roles: readonly string[]): Role {
  const norm = normalizeRoles(roles)
  for (const r of ROLE_PRIORITY) if (norm.includes(r)) return r
  return 'user'
}

/** True only for the admin role. (Pre-refactor this also covered 'ops';
 *  operators now go through brew-level guards instead of requireAdmin.) */
export function deriveIsAdmin(roles: readonly string[]): boolean {
  return normalizeRoles(roles).includes('admin')
}

/* ── Brew access ─────────────────────────────────────────────────
 * A brew is a top-level tool. Access is 'write', 'read', or absent
 * (invisible). This single table replaces the old capability list. */

export type Brew =
  | 'home'
  | 'workflows'
  | 'jobs'
  | 'services'
  | 'servers'
  | 'doctor'
  | 'analytics'
  | 'calendar'
  | 'clients' // GT Users
  | 'users' // Coffee Maker users
  | 'credentials'
  | 'seto'
  | 'preferences'

export type Access = 'read' | 'write'

const ALL_WRITE: Record<Brew, Access> = {
  home: 'write',
  workflows: 'write',
  jobs: 'write',
  services: 'write',
  servers: 'write',
  doctor: 'write',
  analytics: 'write',
  calendar: 'write',
  clients: 'write',
  users: 'write',
  credentials: 'write',
  seto: 'write',
  preferences: 'write',
}

export const ROLE_ACCESS: Record<Role, Partial<Record<Brew, Access>>> = {
  admin: ALL_WRITE,
  operator: {
    home: 'read',
    workflows: 'write',
    jobs: 'write',
    services: 'write',
    doctor: 'write',
    analytics: 'read',
    calendar: 'write',
    clients: 'write',
    preferences: 'write',
  },
  master: {
    workflows: 'read',
    jobs: 'read',
    analytics: 'read',
    clients: 'write',
    preferences: 'write',
  },
  user: {
    workflows: 'read',
    jobs: 'read',
    analytics: 'read',
    preferences: 'write',
  },
}

export function accessFor(role: Role | null | undefined, brew: Brew): Access | null {
  if (!role) return null
  return ROLE_ACCESS[role][brew] ?? null
}

/** Can the role see this brew at all (read or write)? */
export function canRead(role: Role | null | undefined, brew: Brew): boolean {
  return accessFor(role, brew) != null
}

/** Can the role mutate anything inside this brew? */
export function canWrite(role: Role | null | undefined, brew: Brew): boolean {
  return accessFor(role, brew) === 'write'
}
