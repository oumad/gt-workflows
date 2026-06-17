/**
 * Wire-format types for the Seto assistant.
 *
 * Seto inspects a single entity (live job / history job / service / server)
 * against a configurable rule set and returns a short list of `Finding`s
 * the UI renders as "diagnoses" in a modal.
 */

export interface Finding {
  code: string
  /** ok = a positive confirmation ("checked and green"), distinct from info
   *  (neutral FYI) so the UI can render verified-good in green. */
  severity: 'ok' | 'info' | 'warn' | 'bad'
  title: string
  body: string
}

export interface Cfg {
  maxUserJobs: number
  maxServiceJobs: number
  maxServerJobs: number
  maxWaitTimeSec: number
  maxLinkedWf: number
  maxServerLatencyMs: number
  maxServerServices: number
}

export type CheckKind = 'live-job' | 'history-job' | 'service' | 'server' | 'error' | 'workflow'

export interface CheckResponse {
  greeting: string
  findings: Finding[]
}

/** Internal: a normalised "job from either table" shape so the rule
 *  evaluators don't have to fork on workflow vs LoRA. */
export interface JobLookup {
  kind: 'wf' | 'lora'
  id: string
  name: string | null
  status: string
  clientId: string | null
  userName: string | null
  serverId: string | null
  serverUrl: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  waitMs: number | null
  failedReason: string | null
}
