/**
 * Role-based access control.
 *
 *   admin    — every right
 *   ops      — every right (same effective set as admin; the distinct label
 *              lets us see who's actually carrying the pager)
 *   designer — daily-driver: workflows, jobs, services, calendar, GT users,
 *              analytics. Cannot manage users, credentials, Seto config,
 *              hosts (Servers tool), nor perform destructive actions
 *              (delete, scrape) or admin-grade ones (RDP). CAN edit services.
 *   viewer   — read-only analytics + preferences. Nothing else, nothing edit.
 *
 * A user holds zero or more roles in `users.roles` (text[]). The *primary*
 * role is the first one we recognise in a fixed priority order; that's what
 * the UI shows and what `can()` evaluates against. The schema-array shape is
 * kept for future multi-role layering — today we treat it as single-role.
 */

export type Role = 'admin' | 'ops' | 'designer' | 'viewer'

export const ROLES: readonly Role[] = ['admin', 'ops', 'designer', 'viewer']
const ROLE_SET = new Set<string>(ROLES)

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  ops: 'Ops',
  designer: 'Designer',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: 'Every capability — including user management, credentials, Seto config.',
  ops: 'Same as admin. Distinct label for accountability.',
  designer:
    'Daily driver: workflows, jobs, services, calendar, GT users. Cannot manage users / credentials / Seto / hosts, cannot delete or scrape.',
  viewer: 'Read-only Analytics + Preferences. No edit anywhere.',
}

/** Priority order for resolving a primary role when a user has multiple. */
const ROLE_PRIORITY: Role[] = ['admin', 'ops', 'designer', 'viewer']

/** Resolve the effective role for a user. Used everywhere that asks "what
 *  can this user do" — single source of truth so a user record with weird
 *  data (empty array, unknown role strings) always lands on a defined value. */
export function derivePrimaryRole(roles: readonly string[]): Role {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r
  // No recognised role → safest default. Newly-created users with no role
  // see only analytics until an admin promotes them.
  return 'viewer'
}

/** Legacy isAdmin flag (used by every existing requireAdmin check). True for
 *  admin AND ops — same effective set. Keeping this derivation lets the
 *  pre-existing middleware keep working without touching every callsite. */
export function deriveIsAdmin(roles: readonly string[]): boolean {
  return roles.includes('admin') || roles.includes('ops')
}

/** Type-safe role validator for input (form submits, API patches). */
export function isRole(s: unknown): s is Role {
  return typeof s === 'string' && ROLE_SET.has(s)
}

/* ── Capabilities ────────────────────────────────────────────────
 * A capability names a single sensitive action. The frontend uses the same
 * set of names to gate buttons; backend middleware uses them to gate routes.
 * Adding one in only one half is a bug — pair them up in the same PR. */

export type Capability =
  | 'view-users'
  | 'view-credentials'
  | 'view-seto-config'
  | 'view-servers'
  | 'use-seto-modal'
  | 'edit-workflow'
  | 'edit-calendar'
  | 'edit-service'
  | 'edit-server'
  | 'edit-user'
  | 'edit-credential'
  | 'edit-seto-config'
  | 'delete-service'
  | 'delete-server'
  | 'scrape'
  | 'stop-job'
  | 'rdp'

const CAPABILITY_BY_ROLE: Record<Capability, Set<Role>> = {
  // View — page-level gates. "view-servers" is the host-tool, not Services.
  'view-users': new Set<Role>(['admin', 'ops']),
  'view-credentials': new Set<Role>(['admin', 'ops']),
  'view-seto-config': new Set<Role>(['admin', 'ops']),
  'view-servers': new Set<Role>(['admin', 'ops']),
  // Use the Ask Seto modal anywhere — designer is fine, viewer is not.
  'use-seto-modal': new Set<Role>(['admin', 'ops', 'designer']),
  // Edit
  'edit-workflow': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-calendar': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-service': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-server': new Set<Role>(['admin', 'ops']),
  'edit-user': new Set<Role>(['admin', 'ops']),
  'edit-credential': new Set<Role>(['admin', 'ops']),
  'edit-seto-config': new Set<Role>(['admin', 'ops']),
  // Destructive
  'delete-service': new Set<Role>(['admin', 'ops']),
  'delete-server': new Set<Role>(['admin', 'ops']),
  'scrape': new Set<Role>(['admin', 'ops']),
  // Operational
  'stop-job': new Set<Role>(['admin', 'ops', 'designer']),
  'rdp': new Set<Role>(['admin', 'ops']),
}

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITY_BY_ROLE[capability].has(role)
}
