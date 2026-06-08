/**
 * Zod schemas for workflow endpoints. The two CRUD endpoints use proper
 * schemas; the file-write endpoints and import endpoints validate inline
 * because they accept either raw JSON bodies (whose shape is the workflow
 * itself) or multipart uploads (which Zod can't validate directly).
 */
import { z } from 'zod'

export const createWorkflowSchema = z.object({
  folderName: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, underscores and hyphens only'),
  label: z.string().optional(),
  parser: z.enum(['default', 'comfyui']).optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  serverUrls: z.array(z.string()).optional(),
})

export const patchWorkflowSchema = z.object({
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().optional(),
  parser: z.enum(['default', 'comfyui']).nullable().optional(),
  tags: z.array(z.string()).optional(),
  timeout: z.number().nullable().optional(),
  devMode: z.boolean().optional(),
  serverUrls: z.array(z.string()).optional(),
  order: z.number().optional(),
})

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>
export type PatchWorkflowInput = z.infer<typeof patchWorkflowSchema>

/** Folder-name validator reused by /import/create (multipart, so it doesn't
 *  flow through zValidator). Same rule as createWorkflowSchema.folderName. */
export const FOLDER_NAME_RE = /^[a-zA-Z0-9_-]+$/
