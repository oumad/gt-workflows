/**
 * Wire-format and internal types for workflows.
 *
 * Workflows live as folders on disk (one folder = one workflow) — `ParamsJson`
 * is the shape of the per-folder `params.json` config file. Most fields are
 * optional because every key has a sensible default; what's actually stored
 * on disk can be a strict subset.
 */

export interface ParamsJson {
  label?: string
  description?: string
  category?: string
  tags?: string[]
  icon?: string
  order?: number
  timeout?: number
  devMode?: boolean
  tested?: boolean
  audited?: boolean
  parser?: string
  workflowFile?: string
  servers?: string[]
  serverIds?: string[] // legacy alias — prefer servers[]
  comfyui_config?: { serverUrl?: string | string[]; workflow?: string }
  // Legacy "badge" widget embedded in params.json by GTCM. Carries a CSS-ish
  // positioning bundle; we only consume content + colors. Any other key on
  // this object is ignored.
  iconBadge?: {
    content?: string
    backgroundColor?: string
    color?: string
    [k: string]: unknown
  }
}

export type NormalizedIconBadge = { label: string; bg: string | null; color: string | null }

export interface WorkflowSummary {
  id: string
  name: string
  path: string
  description: string | null
  category: string
  serverUrls: string[]
  icon: string | null
  iconBadge: NormalizedIconBadge | null
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

/** Internal shape — includes `order` for sorting; stripped before returning to
 *  the client (the UI doesn't need it once the array order is fixed). */
export interface WorkflowItem extends WorkflowSummary {
  order: number
}

export interface ImportAnalysis {
  kind: 'params' | 'workflow' | 'zip'
  params: Record<string, unknown> | null
  workflow: Record<string, unknown> | null
  nodeCount: number
  warnings: string[]
}

export interface HistoryEntry {
  id: string
  savedAt: string
  kind: 'params' | 'workflow' | 'meta' | 'import'
  label: string
}

/** What POST /:id/audit returns — per-node + per-model availability against
 *  the ComfyUI server's /object_info. `missing` means the server doesn't
 *  know this class_type or doesn't have this model file. */
export interface AuditResult {
  serverName: string
  serverUrl: string
  nodes: Array<{ classType: string; status: 'ok' | 'missing' }>
  models: Array<{
    nodeId: string
    classType: string
    inputName: string
    value: string
    status: 'ok' | 'missing'
  }>
}
