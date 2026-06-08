import { z } from 'zod'

export const JOBS_DEFAULT_LIMIT = 50
export const JOBS_MAX_LIMIT = 200

export const listJobsQuery = z.object({
  type: z.enum(['wf', 'lora', 'all']).optional(),
  status: z.string().optional(),
  userId: z.string().uuid().optional(),
  serverId: z.string().optional(),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(JOBS_MAX_LIMIT).optional(),
  // "all" / "0" / missing → no date filter. Numeric values are capped at 90 to
  // match the analytics endpoints; the Doctor's "All time" toggle sends "all".
  days: z.string().optional(),
  // Hide rows whose failed_reason classifies as ABORTED (cancel/aborted/SIG*).
  // Used by the Doctor's Failures tab so pagination doesn't reserve slots for
  // user-cancelled jobs that the UI is going to filter out anyway.
  excludeAborted: z.coerce.boolean().optional(),
})

export const jobReportSchema = z
  .object({
    message: z.string().min(1).max(2000),
    server: z.string().nullable().optional(),
    findings: z
      .array(
        z.object({
          code: z.string(),
          severity: z.enum(['info', 'warn', 'bad']),
          title: z.string(),
          body: z.string(),
        }),
      )
      .optional(),
  })
  .strict()

export type ListJobsQuery = z.infer<typeof listJobsQuery>
export type JobReportInput = z.infer<typeof jobReportSchema>
