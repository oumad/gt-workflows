/* ─── API types ─────────────────────────────────────────────────── */
// WF-specific shape — returned by GET /api/wf-jobs/:id (detail) and by
// GET /api/servers/:id/jobs (split active/waiting per server).
export interface WfJob {
  id: string
  workflowId: string | null
  workflowName: string | null
  serverId: string | null
  serverUrl: string | null
  clientId: string | null
  status: string
  durationMs: number | null
  failedReason: string | null
  createdAt: string
  processedAt: string | null
  finishedAt: string | null
  comfyStartedAt: string | null
  waitMs: number | null
  comfyQueueMs: number | null
  comfyRunMs: number | null
  data?: { userName?: string; [k: string]: unknown } | null
}
// LoRA-specific shape — returned by GET /api/lora-jobs/:id (detail) and by
// GET /api/servers/:id/jobs.
export interface LoraJob {
  id: string
  processId: string
  outputName: string
  baseModel: string | null
  serverId: string | null
  serverUrl: string | null
  status: string
  failedReason: string | null
  durationMs: number | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  client?: { id: string; name: string | null; email: string | null } | null
}

// Unified shape — returned by GET /api/jobs (list across both tables) and
// embedded in GET /api/jobs/live. WF-only fields (workflowId, comfyStartedAt,
// waitMs, comfyQueueMs, comfyRunMs) are null on LoRA rows; arch is null on WF.
export interface UnifiedJob {
  type: 'wf' | 'lora'
  id: string
  name: string | null
  arch: string | null
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

export interface UnifiedJobsPage {
  items: UnifiedJob[]
  page: number
  totalPages: number
  total: number
}

// Live shape returned by GET /api/jobs/live
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

export interface UnifiedLiveResponse {
  running: UnifiedLiveJob[]
  waiting: UnifiedLiveJob[]
  ts: number
}

/* ─── Unified display row ───────────────────────────────────────── */
export type Tone = 'good' | 'bad' | 'warn' | 'muted' | 'info'
export interface Row {
  kind: 'wf' | 'lora'
  key: string
  id: string
  rawId: string
  name: string
  arch: string | null
  who: string
  server: string | null
  status: string
  statusLabel: string
  statusTone: Tone
  elapsedSec: number | null
  timeoutSec: number
  waitingSec: number | null
  startedLabel: string | null
  totalSec: number | null
  /** Pure processing duration (duration_ms → seconds), excluding queue wait.
   *  This is the metric the Doctor slow-jobs query compares against the
   *  per-workflow average, so SlowChip uses it to stay consistent. */
  durationSec: number | null
  waitTimeSec: number | null
  completedAt: Date | null
  createdAt: string
  processedAt: string | null
  execAt: string | null
  finishedAt: string | null
  failedReason: string | null
  raw: WfJob | LoraJob
  phase: 'comfyui-wait' | 'generating' | null
  clientId: string | null
  serverId: string | null
}
