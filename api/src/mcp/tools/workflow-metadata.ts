/**
 * Workflow-metadata write tools. These target the top-level scalar / array
 * fields on params.json — the bits that drive how a workflow shows up in the
 * Workflows list, the sidebar, and the launch UI.
 *
 *   set_workflow_metadata  → label / description / category / order / timeout
 *   set_workflow_tags      → tags[]    (add | remove | replace | clear)
 *   set_workflow_servers   → servers[] (add | remove | replace | clear)
 *   set_icon_badge         → iconBadge { content, backgroundColor, color }
 *
 * Pattern is the same as every other write tool group: applyParamsPatch ↑
 * read-clone-mutate-validate-write-snapshot. None of these tools touch the
 * comfyui_config / powerflowConfig / imagine sub-objects; deletion of a
 * field is by passing `null` for that key (scalars) or by mode='clear' (for
 * arrays). iconBadge has an extra `remove: true` shortcut to drop the whole
 * sub-object.
 *
 * Note on `name` vs `label`: ParamsJson stores the display name as `label`;
 * "name" in workflow listings is derived from `label` (falling back to a
 * prettified folder slug). To rename a workflow's display, write `label`.
 *
 * Note on `servers` vs legacy `serverIds`: params.json historically used
 * `serverIds` as an alias. New writes go to `servers` and the legacy key is
 * scrubbed in the same patch so the two can't drift.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { applyParamsPatch, ParamsValidationError } from '../params-patch.js'
import { toolJson, toolError } from '../tool-helpers.js'
import { getMcpAuth } from '../auth-ctx.js'

/* ─── Audit ────────────────────────────────────────────────────── */
function auditMcp(
  action: string,
  ctx: { userId: string; username: string; tokenPrefix: string },
  details: Record<string, unknown>,
): void {
  console.log(
    `[mcp-audit] ${action} by ${ctx.username} (${ctx.userId}) via token ${ctx.tokenPrefix}…`,
    JSON.stringify(details),
  )
}

/* ─── Common schemas ──────────────────────────────────────────── */
const workflowIdSchema = z
  .string()
  .min(1)
  .describe('Workflow slug — use list_workflows to discover valid ids.')

const arrayModeSchema = z
  .enum(['add', 'remove', 'replace', 'clear'])
  .describe(
    'How the patch applies to the existing array: ' +
      '"add" appends values (dedup, preserves order), ' +
      '"remove" deletes the listed values (silently ignores absent), ' +
      '"replace" overwrites the array entirely with the new list, ' +
      '"clear" drops the key from params.json (ignores values[]).',
  )

/* ─── Patch helpers ───────────────────────────────────────────── */

/** Set or delete a single top-level key on params. `value === undefined` is
 *  treated as "no change" by the caller (we never enter this helper). Pass
 *  `null` to delete the key entirely; any other value sets it. */
function setOrClear(
  params: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (value === null) {
    if (!(key in params)) return params
    return Object.fromEntries(Object.entries(params).filter(([k]) => k !== key))
  }
  return { ...params, [key]: value }
}

/** Apply the array mode against the current array. Returns the new value to
 *  set; if `null`, the caller should DELETE the key. */
function applyArrayMode(
  current: unknown,
  mode: 'add' | 'remove' | 'replace' | 'clear',
  values: string[] | undefined,
): string[] | null {
  if (mode === 'clear') return null
  const safeCurrent = Array.isArray(current) ? current.filter((v) => typeof v === 'string') : []
  const safeValues = values ?? []
  if (mode === 'replace') return safeValues
  if (mode === 'add') {
    const set = new Set(safeCurrent)
    const next = [...safeCurrent]
    for (const v of safeValues) {
      if (!set.has(v)) {
        next.push(v)
        set.add(v)
      }
    }
    return next
  }
  // remove
  const toRemove = new Set(safeValues)
  return safeCurrent.filter((v) => !toRemove.has(v))
}

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerWorkflowMetadataTools(server: McpServer): void {
  // ── set_workflow_metadata ────────────────────────────────────
  server.registerTool(
    'set_workflow_metadata',
    {
      title: 'Set workflow metadata',
      description:
        "Updates the workflow's top-level scalar metadata fields on " +
        'params.json: label (display name), description, category, order ' +
        '(sort key in the workflow list), timeout (seconds). All fields ' +
        'optional; omit a field to leave it unchanged, pass `null` to clear ' +
        'it (key removed from params.json). At least one field must be ' +
        'present, otherwise the tool errors. ' +
        '\n\nNote: "name" in workflow listings is derived from label (fallback: ' +
        'prettified folder slug). To rename what users see, set `label`. ' +
        '\n\ntimeout is in SECONDS, not milliseconds — typical values 60–600. ' +
        'order is a number used as the sort key; lower comes first; default ' +
        '0 when absent.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        label: z
          .string()
          .nullable()
          .optional()
          .describe('Display name. null clears (falls back to prettified folder slug).'),
        description: z
          .string()
          .nullable()
          .optional()
          .describe('Short description shown on cards / detail page. null clears.'),
        category: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Category label — free-form string. Common values: "Image", ' +
              '"Video", "Training", "Data", "General". null clears (the ' +
              'workflow will inherit a derived category from its name).',
          ),
        order: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe('Sort key (lower comes first). null clears (defaults to 0).'),
        timeout: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe(
            'Job timeout in SECONDS (integer, > 0). null clears (system ' +
              'default applies). Typical: 60–600.',
          ),
      },
    },
    async ({ workflowId, label, description, category, order, timeout }, extra) => {
      const auth = getMcpAuth(extra)
      const fields: Record<string, unknown> = {}
      if (label !== undefined) fields.label = label
      if (description !== undefined) fields.description = description
      if (category !== undefined) fields.category = category
      if (order !== undefined) fields.order = order
      if (timeout !== undefined) fields.timeout = timeout
      if (Object.keys(fields).length === 0) {
        return toolError(
          'No changes requested — pass at least one of label/description/category/order/timeout (value, or null to clear).',
        )
      }
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          let next = params
          for (const [k, v] of Object.entries(fields)) {
            next = setOrClear(next, k, v)
          }
          return next
        })
        auditMcp(
          'set_workflow_metadata',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, fieldsTouched: Object.keys(fields) },
        )
        return toolJson({
          workflowId,
          fields,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_workflow_metadata failed')
      }
    },
  )

  // ── set_workflow_tags ────────────────────────────────────────
  server.registerTool(
    'set_workflow_tags',
    {
      title: 'Set workflow tags',
      description:
        'Manages `params.tags` — the free-form tags array shown on workflow ' +
        'cards and used by the search/filter UI. Modes: ' +
        '\n  • "add" appends new tags (dedup, preserves existing order), ' +
        '\n  • "remove" removes the listed tags (no-op if absent), ' +
        '\n  • "replace" overwrites the array with the new list, ' +
        '\n  • "clear" deletes the tags key entirely. ' +
        '\n\nValues are case-sensitive — "Image" and "image" are different ' +
        'tags. Empty arrays end up as no `tags` key in params.json.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        mode: arrayModeSchema,
        tags: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'The tags to add / remove / replace with. Ignored when mode="clear". ' +
              'Required (non-empty) for add/remove/replace.',
          ),
      },
    },
    async ({ workflowId, mode, tags }, extra) => {
      const auth = getMcpAuth(extra)
      if (mode !== 'clear' && (!tags || tags.length === 0)) {
        return toolError(`Mode "${mode}" requires a non-empty tags[] array.`)
      }
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          const next = applyArrayMode(params.tags, mode, tags)
          if (next === null || next.length === 0) {
            return Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'tags'))
          }
          return { ...params, tags: next }
        })
        auditMcp(
          'set_workflow_tags',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, mode, tagCount: tags?.length ?? 0 },
        )
        return toolJson({
          workflowId,
          mode,
          tags,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_workflow_tags failed')
      }
    },
  )

  // ── set_workflow_servers ─────────────────────────────────────
  server.registerTool(
    'set_workflow_servers',
    {
      title: 'Set workflow servers',
      description:
        'Manages `params.servers` — the list of server IDs (or service URLs) ' +
        'this workflow may run on. Drives the server picker in the launch UI ' +
        'and is used by Seto rules to validate availability. Same mode ' +
        'semantics as set_workflow_tags: add / remove / replace / clear. ' +
        '\n\nLegacy compatibility: params.json historically used `serverIds` ' +
        'as an alias. This tool always writes to `servers` AND scrubs any ' +
        "legacy `serverIds` key in the same patch, so the two can't drift. " +
        '\n\nDoes NOT validate that the provided ids/URLs actually exist in ' +
        'the Servers table — a runtime check happens at job dispatch.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        mode: arrayModeSchema,
        servers: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Server identifiers (ids or service URLs). Required (non-empty) ' +
              'for add/remove/replace; ignored when mode="clear".',
          ),
      },
    },
    async ({ workflowId, mode, servers }, extra) => {
      const auth = getMcpAuth(extra)
      if (mode !== 'clear' && (!servers || servers.length === 0)) {
        return toolError(`Mode "${mode}" requires a non-empty servers[] array.`)
      }
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          // Compute new servers[] AND drop legacy serverIds in the same patch.
          let next = params
          const nextServers = applyArrayMode(params.servers, mode, servers)
          if (nextServers === null || nextServers.length === 0) {
            next = Object.fromEntries(Object.entries(next).filter(([k]) => k !== 'servers'))
          } else {
            next = { ...next, servers: nextServers }
          }
          if ('serverIds' in next) {
            next = Object.fromEntries(Object.entries(next).filter(([k]) => k !== 'serverIds'))
          }
          return next
        })
        auditMcp(
          'set_workflow_servers',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, mode, serverCount: servers?.length ?? 0 },
        )
        return toolJson({
          workflowId,
          mode,
          servers,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_workflow_servers failed')
      }
    },
  )

  // ── set_icon_badge ───────────────────────────────────────────
  server.registerTool(
    'set_icon_badge',
    {
      title: 'Set workflow icon badge',
      description:
        'Patches `params.iconBadge` — the small overlaid label on a ' +
        "workflow's card icon. Shape: " +
        '`{ content?: string, backgroundColor?: string, color?: string }`. ' +
        '\n\nMerge semantics: pass a key to set it, pass `null` for a key to ' +
        'clear just that sub-key, omit a key to leave it unchanged. After ' +
        'applying, if every sub-key ends up unset, the iconBadge block is ' +
        'dropped from params.json. ' +
        '\n\nShortcut: pass `remove: true` to drop the whole iconBadge block ' +
        'regardless of other args. ' +
        '\n\ncontent is typically 1–3 chars ("BETA", "NEW", "v2"). ' +
        'backgroundColor / color accept any CSS color string ("#ff0066", ' +
        '"var(--accent)", "rgb(255,0,102)").',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        content: z
          .string()
          .nullable()
          .optional()
          .describe('Badge text. null clears just this sub-key.'),
        backgroundColor: z
          .string()
          .nullable()
          .optional()
          .describe('CSS color for the badge background. null clears just this sub-key.'),
        color: z
          .string()
          .nullable()
          .optional()
          .describe('CSS color for the badge text. null clears just this sub-key.'),
        remove: z
          .boolean()
          .optional()
          .describe('When true, drops the entire iconBadge block (ignores other args).'),
      },
    },
    async ({ workflowId, content, backgroundColor, color, remove }, extra) => {
      const auth = getMcpAuth(extra)
      if (
        !remove &&
        content === undefined &&
        backgroundColor === undefined &&
        color === undefined
      ) {
        return toolError(
          'No changes requested — pass at least one of content/backgroundColor/color (value or null), or remove:true.',
        )
      }
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          if (remove) {
            return Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'iconBadge'))
          }
          const current = (params.iconBadge ?? {}) as Record<string, unknown>
          const next = { ...current }
          if (content !== undefined) {
            if (content === null) delete next.content
            else next.content = content
          }
          if (backgroundColor !== undefined) {
            if (backgroundColor === null) delete next.backgroundColor
            else next.backgroundColor = backgroundColor
          }
          if (color !== undefined) {
            if (color === null) delete next.color
            else next.color = color
          }
          if (Object.keys(next).length === 0) {
            return Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'iconBadge'))
          }
          return { ...params, iconBadge: next }
        })
        auditMcp(
          'set_icon_badge',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, removed: !!remove, content, backgroundColor, color },
        )
        return toolJson({
          workflowId,
          removed: !!remove,
          content,
          backgroundColor,
          color,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_icon_badge failed')
      }
    },
  )
}
