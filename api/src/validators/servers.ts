/**
 * Zod schemas for the servers endpoints.
 */
import { z } from 'zod'

export const createServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  tags: z.array(z.string()).optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  type: z.enum(['workflow', 'lora']).optional(),
})

export const patchServerSchema = z
  .object({
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
    tags: z.array(z.string()).optional(),
    color: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    type: z.enum(['workflow', 'lora']).optional(),
    isMaintenance: z.boolean().optional(),
    // null clears the soft cap; positive ints set it. 0 / negatives are rejected
    // because a "0 concurrent" server makes no sense — set isMaintenance instead.
    maxConcurrent: z.number().int().positive().max(10_000).nullable().optional(),
  })
  .strict()

export const reportServerSchema = z
  .object({
    message: z.string().min(1).max(2000),
    // Optional Seto findings snapshot, embedded in the Discord report when
    // the report is sent from the (merged) Seto modal.
    findings: z
      .array(
        z.object({
          severity: z.enum(['ok', 'info', 'warn', 'bad']),
          title: z.string().min(1).max(300),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict()

export type CreateServerInput = z.infer<typeof createServerSchema>
export type PatchServerInput = z.infer<typeof patchServerSchema>
export type ReportServerInput = z.infer<typeof reportServerSchema>

/** `?days=N` for /incidents. Returns null for "no date filter" (default). */
export function parseIncidentDays(raw: string | undefined): number | null {
  return raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null
}
