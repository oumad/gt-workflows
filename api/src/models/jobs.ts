/**
 * Wire-format types for the unified jobs endpoints.
 *
 * "Unified" = workflow_jobs (BullMQ/ComfyUI) + training_jobs (LoRA) merged
 * at the read layer so the UI can show one chronological feed. The two
 * tables have different columns, so optional fields here are the WF-only
 * timing metrics (waitMs, comfyQueueMs, comfyRunMs) and the LoRA-only arch.
 */

export interface UnifiedJob {
  type: 'wf' | 'lora'
  id: string
  name: string | null
  arch: string | null // baseModel for LoRA, null for WF
  serverId: string | null
  serverUrl: string | null
  clientId: string | null
  userName: string | null
  status: string
  durationMs: number | null
  failedReason: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  workflowId: string | null
  comfyStartedAt: string | null
  waitMs: number | null
  comfyQueueMs: number | null
  comfyRunMs: number | null
}

export interface UnifiedLiveJob {
  type: 'wf' | 'lora'
  id: string
  name: string
  arch: string | null
  serverUrl: string | null
  serverId: string | null
  clientId: string | null
  userName: string
  createdAt: number
  processedOn: number | null
  comfyStartedAt: number | null
  priority: number
  attempts: number
}

export interface JobsListResponse {
  items: UnifiedJob[]
  page: number
  totalPages: number
  total: number
}

export interface JobsStatsResponse {
  wf: { total: number; active: number; waiting: number; completed: number; failed: number }
  lora: { total: number; running: number; pending: number; completed: number; failed: number }
  running: number
  waiting: number
}

export interface JobsLivePayload {
  running: UnifiedLiveJob[]
  waiting: UnifiedLiveJob[]
  ts: number
}
