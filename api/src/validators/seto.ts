import { z } from 'zod'

export const patchConfigSchema = z.object({
  maxUserJobs: z.number().int().min(1).max(100).optional(),
  maxServiceJobs: z.number().int().min(1).max(100).optional(),
  maxServerJobs: z.number().int().min(1).max(1000).optional(),
  maxWaitTimeSec: z.number().int().min(10).max(86_400).optional(),
  maxLinkedWf: z.number().int().min(1).max(1000).optional(),
  maxServerLatencyMs: z.number().int().min(1).max(60_000).optional(),
  maxServerServices: z.number().int().min(1).max(1000).optional(),
})

export const checkSchema = z.object({
  // 'error' kind: `id` is the error code (e.g. "OOM", "ECONNREFUSED").
  // 'workflow' kind: `id` is the workflow slug — recent runs + failure
  // patterns + server health summary for that workflow.
  kind: z.enum(['live-job', 'history-job', 'service', 'server', 'error', 'workflow']),
  id: z.string().min(1),
})

export type PatchConfigInput = z.infer<typeof patchConfigSchema>
export type CheckInput = z.infer<typeof checkSchema>
