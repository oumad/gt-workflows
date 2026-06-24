export type User = {
  id: string
  username: string
  isAdmin: boolean
  roles: string[]
  /** Derived primary role (admin | ops | designer | viewer). Backend
   *  computes this off `roles[]` and stamps it on every user payload — the
   *  frontend reads this directly instead of recomputing. */
  role: import('./lib/permissions').Role
  createdAt: string
  lastSeenAt: string | null
}

export type Session = {
  token: string
  user: User
}

/** Optional decoration on the card — read from `params.iconBadge.content`
 *  plus its `backgroundColor`/`color`. `null` when no badge is configured. */
export type WorkflowIconBadge = {
  label: string
  bg: string | null
  color: string | null
}

export type Workflow = {
  id: string
  name: string
  path: string
  description: string | null
  category: string
  /** Resolved real ComfyUI server URLs (`<globalEnv.key>` expressions expanded
   *  against the WS config). For display, matching and dispatch. */
  serverUrls: string[]
  /** Raw server refs as stored in params.json `comfyui_config.serverUrl` —
   *  literal URLs and/or `<globalEnv.key>` expressions. For the editor, so a
   *  binding round-trips unresolved instead of being baked into a URL. */
  serverRefs: string[]
  icon: string | null
  iconBadge: WorkflowIconBadge | null
  tags: string[]
  timeout: number | null
  devMode: boolean
  tested: boolean
  audited: boolean
  parser: string | null
  workflowFile: string | null
  createdAt: string
  updatedAt: string
}

export type ServerHealth = {
  // online = this record's own probe passed (a server's ping, or a service's
  // ComfyUI/AI-Toolkit reachability). Servers and services are independent.
  status: 'online' | 'offline' | 'unknown'
  latencyMs: number | null
  lastPingAt: string
}

export type ServerKind = 'workflow' | 'lora'

export type Server = {
  id: string
  name: string
  url: string
  tags: string[]
  color: string | null
  description: string | null
  type: ServerKind
  gpu: string | null
  isMaintenance: boolean
  /** Soft cap used by the saturation heatmap: tiles colour by
   *  activeJobs / maxConcurrent. null = not calibrated; the UI falls back to
   *  a neutral tile until the operator sets a value via Settings. */
  maxConcurrent: number | null
  health: ServerHealth | null
  activeJobs: number
  waitingJobs: number
  createdAt: string
  updatedAt: string
}

/**
 * Top-level page identifiers. `services` and `servers` are two distinct views:
 *   - services = workflow services running on hosts (formerly `'servers'`)
 *   - servers  = physical hosts (formerly `'hosts'`)
 * The rename brings code names into line with what the sidebar labels show,
 * removing the cross-search hazard the audit (F10) flagged.
 */
export type Page =
  | 'home'
  | 'workflows'
  | 'jobs'
  | 'doctor'
  | 'services'
  | 'servers'
  | 'analytics'
  | 'calendar'
  | 'clients'
  | 'users'
  | 'credentials'
  | 'seto'
  | 'preferences'

/** App-level navigation: switch page, optionally to a specific sub-path. */
export type NavigateFn = (page: Page, path?: string) => void
