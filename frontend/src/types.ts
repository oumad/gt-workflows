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
  /** ComfyUI server URLs this workflow targets — params.json
   *  `comfyui_config.serverUrl`, normalized to an array. */
  serverUrls: string[]
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
  // 'offline'      → host unreachable (ICMP + TCP both failed)
  // 'service-down' → host reachable, but ComfyUI/AI-Toolkit not answering
  status: 'online' | 'offline' | 'service-down' | 'unknown'
  latencyMs: number | null
  lastPingAt: string
  comfyOk: boolean | null
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
