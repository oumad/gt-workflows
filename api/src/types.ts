// Lightweight user object decoded from JWT — no DB lookup required.
// Populated by requireAuth; contains every claim embedded at login time.
// `role` is derived from `roles` at session creation and cached on the JWT
// so we don't recompute it on every middleware pass. `isAdmin` is the legacy
// flag (admin OR ops); preserved for every requireAdmin callsite.
export type AuthUser = {
  id: string
  username: string
  isAdmin: boolean
  roles: string[]
  role: import('./lib/permissions.js').Role
}

// Hono context variables — available via c.var.user etc.
export type AppVariables = {
  user: AuthUser
}

// Cursor-paginated response envelope
export type PageResult<T> = {
  items: T[]
  nextCursor: string | null // opaque base64 cursor or null if no more pages
  total: number | null // present only when cheap to compute
}

// BullMQ job shape as read from Redis (only the fields we care about)
export type BullJob = {
  id: string
  name: string // workflow name, stored in job name field
  timestamp: number // created epoch ms
  processedOn: number | null
  finishedOn: number | null
  returnvalue: unknown
  failedReason: string | null
  stacktrace: string[]
  attempts: number
  priority: number
  opts: Record<string, unknown>
  data: Record<string, unknown> // job payload: clientId, serverUrl, params…
}
