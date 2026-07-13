/**
 * Frontend mirror of api/src/lib/permissions.ts — per-brew read/write access.
 * Edit both sides together: the frontend hides the affordance, the backend
 * rejects the call.
 *
 *   admin    — write on everything
 *   operator — Workflows / Jobs / Services / Doctor / Analytics / Calendar / GT Users
 *   master   — Workflows + Jobs read-only, Analytics, GT Users ("MasterUser")
 *   user     — Workflows + Jobs read-only, Analytics
 */
import type { Page } from '../types'

export type Role = 'admin' | 'operator' | 'master' | 'user'

export const ROLES: readonly Role[] = ['admin', 'operator', 'master', 'user']
const ROLE_SET = new Set<string>(ROLES)

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  master: 'MasterUser',
  user: 'User',
}

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: 'All access — every brew writable, user management, credentials, Seto config.',
  operator: 'Runs the floor: Workflows, Jobs, Services, Doctor, Analytics, Calendar, GT Users.',
  master: 'Workflows & Jobs read-only, plus Analytics and GT Users.',
  user: 'Workflows & Jobs read-only, plus Analytics. No editing anywhere.',
}

/** Pre-rename role strings still present in stored sessions / old JWTs. */
const LEGACY_ROLE: Record<string, Role> = {
  ops: 'operator',
  designer: 'operator',
  viewer: 'user',
}

export function normalizeRoles(roles: readonly string[]): Role[] {
  const out: Role[] = []
  for (const r of roles) {
    const norm = ROLE_SET.has(r) ? (r as Role) : LEGACY_ROLE[r]
    if (norm && !out.includes(norm)) out.push(norm)
  }
  return out
}

const ROLE_PRIORITY: Role[] = ['admin', 'operator', 'master', 'user']

export function derivePrimaryRole(roles: readonly string[] | null | undefined): Role {
  if (!roles) return 'user'
  const norm = normalizeRoles(roles)
  for (const r of ROLE_PRIORITY) if (norm.includes(r)) return r
  return 'user'
}

export function isRole(s: unknown): s is Role {
  return typeof s === 'string' && ROLE_SET.has(s)
}

/* ── Brew access ─────────────────────────────────────────────────
 * One table drives the sidebar, the App-level route guard, and every edit
 * affordance. 'write' → full UI; 'read' → view-only UI (no edit tabs,
 * buttons, drag-drop, or cross-entity links); absent → page hidden. */

export type Access = 'read' | 'write'

const ALL_WRITE: Record<Page, Access> = {
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

export const ROLE_ACCESS: Record<Role, Partial<Record<Page, Access>>> = {
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

export function accessFor(role: Role | null | undefined, page: Page): Access | null {
  if (!role) return null
  return ROLE_ACCESS[role][page] ?? null
}

/** Page visible at all (read or write)? Drives sidebar + route guard. */
export function canSee(role: Role | null | undefined, page: Page): boolean {
  return accessFor(role, page) != null
}

/** Page fully editable? Drives every edit affordance inside the page. */
export function canWrite(role: Role | null | undefined, page: Page): boolean {
  return accessFor(role, page) === 'write'
}

export function landingFor(role: Role | null | undefined): Page {
  return canSee(role, 'home') ? 'home' : 'workflows'
}
