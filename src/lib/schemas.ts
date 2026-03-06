import { z } from 'zod'

// ---------------------------------------------------------------------------
// WorkflowParams
// .catchall(z.unknown()) preserves [key: string]: unknown in the inferred type
// so it stays compatible with the WorkflowParams TypeScript interface.
// ---------------------------------------------------------------------------
export const WorkflowParamsSchema = z
  .object({
    label: z.string().optional(),
    process: z.union([z.string(), z.array(z.string())]).optional(),
    main: z.string().optional(),
    icon: z.string().optional(),
    parser: z.string().optional(),
    executionName: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
    order: z.number().optional(),
    scope: z.string().optional(),
    timeout: z.number().optional(),
    devMode: z.boolean().optional(),
    forceLocal: z.boolean().optional(),
    processArgs: z.array(z.string()).optional(),
    comfyui_config: z.record(z.unknown()).optional(),
    parameters: z.record(z.unknown()).optional(),
    ui: z.record(z.unknown()).optional(),
    use: z.record(z.unknown()).optional(),
    dashboard: z.record(z.unknown()).optional(),
    iconBadge: z.record(z.unknown()).optional(),
    documentation: z.string().optional(),
  })
  .catchall(z.unknown())

export const WorkflowSchema = z.object({
  name: z.string(),
  folderPath: z.string(),
  params: WorkflowParamsSchema,
  hasWorkflowFile: z.boolean(),
  workflowFilePath: z.string().optional(),
})

/** Response shape for GET /api/workflows/list */
export const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  pages: z.number(),
})

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------
const WorkflowDetailUIStateSchema = z.object({
  showWorkflowJson: z.boolean().optional(),
  showParamsJson: z.boolean().optional(),
  lastTestRun: z.string().optional(),
  lastTestRunStatus: z.enum(['ok', 'nok']).optional(),
  lastAuditRun: z.string().optional(),
  lastAuditRunStatus: z.enum(['ok', 'nok']).optional(),
})

export const AppPreferencesSchema = z.object({
  anonymiseUsers: z.boolean(),
  serversOpen: z.boolean(),
  userDetailsOpen: z.boolean(),
  monitoredServers: z.array(z.string()),
  expandedCategories: z.array(z.string()),
  workflowDetailUI: z.record(WorkflowDetailUIStateSchema),
  // Stored as the full Workflow shape; partial with required name for resilience against older stored data
  workflowsInfo: z.array(WorkflowSchema.partial().extend({ name: z.string() })),
  serverAliases: z.record(z.string()),
})
