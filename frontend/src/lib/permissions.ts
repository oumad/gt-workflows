/**
 * Frontend mirror of api/src/lib/permissions.ts. Same Role + Capability types,
 * same can() table. When you add a capability, add it BOTH sides so the
 * frontend hides the button and the backend rejects the call.
 */

export type Role = 'admin' | 'ops' | 'designer' | 'viewer'

export const ROLES: readonly Role[] = ['admin', 'ops', 'designer', 'viewer']

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

const ROLE_PRIORITY: Role[] = ['admin', 'ops', 'designer', 'viewer']

export function derivePrimaryRole(roles: readonly string[] | null | undefined): Role {
  if (!roles) return 'viewer'
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r
  return 'viewer'
}

export function isRole(s: unknown): s is Role {
  return typeof s === 'string' && (ROLES as readonly string[]).includes(s)
}

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

const CAPABILITY_BY_ROLE: Record<Capability, ReadonlySet<Role>> = {
  'view-users': new Set<Role>(['admin', 'ops']),
  'view-credentials': new Set<Role>(['admin', 'ops']),
  'view-seto-config': new Set<Role>(['admin', 'ops']),
  'view-servers': new Set<Role>(['admin', 'ops']),
  'use-seto-modal': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-workflow': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-calendar': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-service': new Set<Role>(['admin', 'ops', 'designer']),
  'edit-server': new Set<Role>(['admin', 'ops']),
  'edit-user': new Set<Role>(['admin', 'ops']),
  'edit-credential': new Set<Role>(['admin', 'ops']),
  'edit-seto-config': new Set<Role>(['admin', 'ops']),
  'delete-service': new Set<Role>(['admin', 'ops']),
  'delete-server': new Set<Role>(['admin', 'ops']),
  scrape: new Set<Role>(['admin', 'ops']),
  'stop-job': new Set<Role>(['admin', 'ops', 'designer']),
  rdp: new Set<Role>(['admin', 'ops']),
}

export function can(role: Role | undefined | null, capability: Capability): boolean {
  if (!role) return false
  return CAPABILITY_BY_ROLE[capability].has(role)
}

/* ── Page access ────────────────────────────────────────────
 * Which roles can see each top-level page. Drives sidebar filtering and the
 * App-level guard that redirects forbidden pages back to a landing.
 *
 * Viewer's landing is /analytics (their only meaningful page). Everyone else
 * lands on /home as before.
 */
import type { Page } from '../types'

export const PAGE_ACCESS: Record<Page, ReadonlySet<Role>> = {
  home: new Set<Role>(['admin', 'ops', 'designer']),
  workflows: new Set<Role>(['admin', 'ops', 'designer']),
  jobs: new Set<Role>(['admin', 'ops', 'designer']),
  doctor: new Set<Role>(['admin', 'ops', 'designer']),
  services: new Set<Role>(['admin', 'ops', 'designer']),
  servers: new Set<Role>(['admin', 'ops']), // designer hidden
  analytics: new Set<Role>(['admin', 'ops', 'designer', 'viewer']),
  calendar: new Set<Role>(['admin', 'ops', 'designer']),
  clients: new Set<Role>(['admin', 'ops', 'designer']),
  users: new Set<Role>(['admin', 'ops']),
  credentials: new Set<Role>(['admin', 'ops']),
  seto: new Set<Role>(['admin', 'ops']),
  preferences: new Set<Role>(['admin', 'ops', 'designer', 'viewer']),
}

export function canSee(role: Role | undefined | null, page: Page): boolean {
  if (!role) return false
  return PAGE_ACCESS[page].has(role)
}

export function landingFor(role: Role | undefined | null): Page {
  if (role === 'viewer') return 'analytics'
  return 'home'
}
