/**
 * Zod schemas for the credentials endpoints. Co-located so adding/changing a
 * field happens in one place rather than in both the route and the service.
 */
import { z } from 'zod'

export const createCredentialSchema = z.object({
  name: z.string().min(1).max(120),
  domain: z.string().max(120).optional().default(''),
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(500),
  description: z.string().max(500).nullable().optional(),
  serverIds: z.array(z.string()).optional().default([]),
})

export const patchCredentialSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  domain: z.string().max(120).optional(),
  username: z.string().min(1).max(120).optional(),
  password: z.string().min(1).max(500).optional(),
  description: z.string().max(500).nullable().optional(),
  serverIds: z.array(z.string()).optional(),
})

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>
export type PatchCredentialInput = z.infer<typeof patchCredentialSchema>
