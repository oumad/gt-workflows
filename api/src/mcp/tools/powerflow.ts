/**
 * Powerflow write tools — operate on `params.powerflowConfig` (top-level
 * sibling to `comfyui_config`, NOT nested under it).
 *
 * The on-disk shape (from frontend parser-types.ts):
 *
 *   powerflowConfig: {
 *     enabled?:   boolean,
 *     exclusive?: boolean,
 *     availableConnections?: {
 *       inputs?:  PowerflowNodeSpec[],
 *       outputs?: PowerflowNodeSpec[],
 *     },
 *   }
 *   PowerflowNodeSpec = { nodeId: string, fields: PowerflowFieldSpec[] }
 *   PowerflowFieldSpec =
 *     | string                                      // bare field name
 *     | { name: string, label?: string, type?: string }
 *
 * The field-spec union is the trickiest part: when a field has no overrides
 * it's stored as a bare string ("image"); the moment you add a label or
 * type it gets promoted to object form. `set_pf_field` handles promotion
 * and demotion (clearing all overrides demotes back to a string) so the
 * on-disk shape stays canonical.
 *
 * Every write goes through `applyParamsPatch` → read → clone → mutate →
 * validateParamsShape → writeParamsFile (which snapshots first). Same
 * safety contract as the node-config tools.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyParamsPatch,
  withPowerflow,
  ParamsValidationError,
} from '../params-patch.js'
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

const nodeIdSchema = z
  .string()
  .min(1)
  .describe(
    'ComfyUI node id from workflow.json — the string key, numeric in ' +
      'practice ("4", "8") but always stored as a string.',
  )

const pfKindSchema = z
  .enum(['input', 'output'])
  .describe(
    'Which side of the powerflow integration to target: "input" (data ' +
      'flowing IN to the workflow from an upstream powerflow node) → maps to ' +
      'powerflowConfig.availableConnections.inputs[]. "output" (data flowing ' +
      'OUT of the workflow to downstream) → .outputs[]. Pick one per call.',
  )

const pfFieldSpecSchema = z
  .union([
    z.string().describe('Bare field name — no label/type overrides.'),
    z
      .object({
        name: z.string().describe('Field name on the node.'),
        label: z.string().optional().describe('Display label in the powerflow UI.'),
        type: z.string().optional().describe('Override type (e.g. "text", "image").'),
      })
      .strict(),
  ])
  .describe(
    'Powerflow field specifier — either a bare string for the field name ' +
      '(no overrides) or an object { name, label?, type? } when you want to ' +
      'customise how the field is displayed in the powerflow UI. Mixed ' +
      'arrays of both forms are supported.',
  )

/* ─── Helpers ──────────────────────────────────────────────────── */

type ConnList = Record<string, unknown>[]
type FieldSpec = string | { name: string; label?: string; type?: string }

const KEY_FOR_KIND: Record<'input' | 'output', 'inputs' | 'outputs'> = {
  input: 'inputs',
  output: 'outputs',
}

function getConnectionsList(pf: Record<string, unknown>, key: 'inputs' | 'outputs'): ConnList {
  const ac = (pf.availableConnections ?? {}) as Record<string, unknown>
  const list = ac[key]
  return Array.isArray(list) ? (list as ConnList) : []
}

function setConnectionsList(
  pf: Record<string, unknown>,
  key: 'inputs' | 'outputs',
  next: ConnList,
): Record<string, unknown> {
  const ac = { ...((pf.availableConnections ?? {}) as Record<string, unknown>) }
  if (next.length === 0) delete ac[key]
  else ac[key] = next
  const cleaned = { ...pf }
  if (Object.keys(ac).length > 0) cleaned.availableConnections = ac
  else delete cleaned.availableConnections
  return cleaned
}

/** Find a field in a connection's fields array, returning its index + the
 *  effective field name. Handles both bare-string and object forms. */
function findFieldIndex(
  fields: FieldSpec[],
  fieldName: string,
): number {
  return fields.findIndex((f) =>
    typeof f === 'string' ? f === fieldName : f.name === fieldName,
  )
}

/** Demote a field spec back to a bare string if it has no overrides left. */
function canonicaliseField(field: FieldSpec): FieldSpec {
  if (typeof field === 'string') return field
  const hasOverrides =
    (field.label !== undefined && field.label !== null) ||
    (field.type !== undefined && field.type !== null)
  return hasOverrides ? field : field.name
}

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerPowerflowTools(server: McpServer): void {
  // ── set_powerflow_flags ──────────────────────────────────────
  server.registerTool(
    'set_powerflow_flags',
    {
      title: 'Set powerflow flags',
      description:
        'Toggles the top-level boolean flags on `params.powerflowConfig`: ' +
        '`enabled` (whether the powerflow integration is active for this ' +
        'workflow) and `exclusive` (whether the workflow runs ONLY through ' +
        'powerflow, ignoring direct runs). ' +
        '\n\nPass `true`/`false` to set, or `null`/omit to leave that flag ' +
        'unchanged. At least one of the two must be specified. Setting both ' +
        'to false does NOT delete the powerflowConfig block — it stays so ' +
        'availableConnections + flags remain editable. ' +
        '\n\nThis tool will create the powerflowConfig block if missing — ' +
        'no need to call add_pf_connection first to bootstrap it.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        enabled: z
          .boolean()
          .nullable()
          .optional()
          .describe('Set true/false. null/omit leaves it unchanged.'),
        exclusive: z
          .boolean()
          .nullable()
          .optional()
          .describe('Set true/false. null/omit leaves it unchanged.'),
      },
    },
    async ({ workflowId, enabled, exclusive }, extra) => {
      const auth = getMcpAuth(extra)
      if (enabled == null && exclusive == null) {
        return toolError(
          'No changes requested — pass at least one of enabled / exclusive (boolean).',
        )
      }
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withPowerflow(params, (pf) => {
            const next = { ...pf }
            if (enabled != null) next.enabled = enabled
            if (exclusive != null) next.exclusive = exclusive
            return next
          }),
        )
        auditMcp(
          'set_powerflow_flags',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, enabled, exclusive },
        )
        return toolJson({
          workflowId,
          enabled,
          exclusive,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_powerflow_flags failed')
      }
    },
  )

  // ── add_pf_connection ────────────────────────────────────────
  server.registerTool(
    'add_pf_connection',
    {
      title: 'Add powerflow connection',
      description:
        'Adds a node to `params.powerflowConfig.availableConnections.inputs' +
        '[]` (kind="input") or `.outputs[]` (kind="output"). Each entry is ' +
        '{ nodeId, fields[] } where each field is either a bare string ' +
        '("image") or an object ({ name, label?, type? }) when you want to ' +
        'override how it\'s displayed in the powerflow UI. ' +
        '\n\nNOT idempotent: if a connection with the same nodeId already ' +
        'exists in the target list, this tool errors. To modify an existing ' +
        'connection\'s fields, use set_pf_field per field, or call ' +
        'remove_pf_connection then add_pf_connection. ' +
        '\n\nValidates: nodeId must be a non-empty string, fields must be a ' +
        'non-empty array, and each field must match the union shape. The ' +
        'tool does NOT verify the nodeId exists in workflow.json — that\'s ' +
        'on the caller. Use read_workflow to confirm valid node ids first.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        kind: pfKindSchema,
        nodeId: nodeIdSchema,
        fields: z
          .array(pfFieldSpecSchema)
          .min(1)
          .describe(
            'At least one field. Examples: ["image"] (one bare field), ' +
              '["image", { "name": "prompt", "label": "Text Prompt", "type": "text" }] ' +
              '(mixed bare + override).',
          ),
      },
    },
    async ({ workflowId, kind, nodeId, fields }, extra) => {
      const auth = getMcpAuth(extra)
      const key = KEY_FOR_KIND[kind]
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withPowerflow(params, (pf) => {
            const current = getConnectionsList(pf, key)
            const existing = current.findIndex((c) => c.nodeId === nodeId)
            if (existing >= 0) {
              throw new Error(
                `Connection for nodeId=${nodeId} already exists in ${key}. ` +
                  'Use set_pf_field to update its fields, or remove_pf_connection first.',
              )
            }
            const next: ConnList = [...current, { nodeId, fields: fields.map(canonicaliseField) }]
            return setConnectionsList(pf, key, next)
          }),
        )
        auditMcp(
          'add_pf_connection',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, kind, nodeId, fieldCount: fields.length },
        )
        return toolJson({
          workflowId,
          kind,
          nodeId,
          fields,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'add_pf_connection failed')
      }
    },
  )

  // ── remove_pf_connection ─────────────────────────────────────
  server.registerTool(
    'remove_pf_connection',
    {
      title: 'Remove powerflow connection',
      description:
        'Removes the entry for `nodeId` from `params.powerflowConfig.' +
        'availableConnections.inputs[]` (kind="input") or `.outputs[]` ' +
        '(kind="output"). Idempotent — if the entry isn\'t there, the tool ' +
        'returns success with no changes. ' +
        '\n\nAfter the removal, if the target list becomes empty it\'s ' +
        'dropped from the params.json entirely (no `"inputs": []` litter). ' +
        'If both inputs and outputs lists end up gone, ' +
        '`availableConnections` itself is removed. The powerflowConfig ' +
        'object (and its enabled/exclusive flags) is preserved either way ' +
        '— use set_powerflow_flags or write_file to clear them.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        kind: pfKindSchema,
        nodeId: nodeIdSchema,
      },
    },
    async ({ workflowId, kind, nodeId }, extra) => {
      const auth = getMcpAuth(extra)
      const key = KEY_FOR_KIND[kind]
      try {
        let removed = false
        const result = applyParamsPatch(workflowId, (params) =>
          withPowerflow(params, (pf) => {
            const current = getConnectionsList(pf, key)
            const next = current.filter((c) => {
              if (c.nodeId === nodeId) {
                removed = true
                return false
              }
              return true
            })
            return setConnectionsList(pf, key, next)
          }),
        )
        auditMcp(
          'remove_pf_connection',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, kind, nodeId, removed },
        )
        return toolJson({
          workflowId,
          kind,
          nodeId,
          removed,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'remove_pf_connection failed')
      }
    },
  )

  // ── set_pf_field ─────────────────────────────────────────────
  server.registerTool(
    'set_pf_field',
    {
      title: 'Set powerflow field overrides',
      description:
        'Updates the label and/or type of one field on an existing ' +
        'powerflow connection. Targets ' +
        '`params.powerflowConfig.availableConnections.{inputs|outputs}[] ' +
        '→ find by nodeId → fields[] → find by fieldName`. ' +
        '\n\nForm promotion/demotion: if the field is currently stored as a ' +
        'bare string ("image") and you set a label or type, it\'s ' +
        'auto-promoted to object form ({ name, label, type }). If it\'s ' +
        'already an object and you pass `null` for both label and type, the ' +
        'field is demoted back to a bare string — keeping the on-disk shape ' +
        'canonical (no `{ name: "image" }` with no overrides). ' +
        '\n\nPass `label: null` or `type: null` to remove just that ' +
        'override; pass a string to set/replace it. At least one of label / ' +
        'type must be provided. ' +
        '\n\nErrors if the connection or the field doesn\'t exist — use ' +
        'add_pf_connection first if the connection is missing.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        kind: pfKindSchema,
        nodeId: nodeIdSchema,
        fieldName: z
          .string()
          .min(1)
          .describe(
            'The field name to update — matches either a bare-string entry ' +
              'or the `.name` of an object entry in the connection\'s fields[].',
          ),
        label: z
          .string()
          .nullable()
          .optional()
          .describe(
            'New label, or null to remove the label override. Omit to leave ' +
              'the current label alone.',
          ),
        type: z
          .string()
          .nullable()
          .optional()
          .describe(
            'New type, or null to remove the type override. Omit to leave ' +
              'the current type alone.',
          ),
      },
    },
    async ({ workflowId, kind, nodeId, fieldName, label, type }, extra) => {
      const auth = getMcpAuth(extra)
      if (label === undefined && type === undefined) {
        return toolError(
          'No changes requested — pass label and/or type (string, or null to clear).',
        )
      }
      const key = KEY_FOR_KIND[kind]
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withPowerflow(params, (pf) => {
            const current = getConnectionsList(pf, key)
            const connIdx = current.findIndex((c) => c.nodeId === nodeId)
            if (connIdx < 0) {
              throw new Error(
                `No powerflow ${kind} connection for nodeId=${nodeId}. Call add_pf_connection first.`,
              )
            }
            const conn = { ...current[connIdx] } as Record<string, unknown>
            const fields = Array.isArray(conn.fields) ? ([...conn.fields] as FieldSpec[]) : []
            const fieldIdx = findFieldIndex(fields, fieldName)
            if (fieldIdx < 0) {
              throw new Error(
                `Field "${fieldName}" not found on ${kind} connection nodeId=${nodeId}. ` +
                  'Add it to the connection first via remove+add or by extending fields[].',
              )
            }
            // Promote to object form so we can apply overrides; then maybe
            // demote back if everything's cleared.
            const cur = fields[fieldIdx]
            const obj: { name: string; label?: string; type?: string } =
              typeof cur === 'string'
                ? { name: cur }
                : { ...(cur as { name: string; label?: string; type?: string }) }
            if (label !== undefined) {
              if (label === null) delete obj.label
              else obj.label = label
            }
            if (type !== undefined) {
              if (type === null) delete obj.type
              else obj.type = type
            }
            fields[fieldIdx] = canonicaliseField(obj)
            conn.fields = fields
            const nextList: ConnList = [...current]
            nextList[connIdx] = conn
            return setConnectionsList(pf, key, nextList)
          }),
        )
        auditMcp(
          'set_pf_field',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, kind, nodeId, fieldName, label, type },
        )
        return toolJson({
          workflowId,
          kind,
          nodeId,
          fieldName,
          label,
          type,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_pf_field failed')
      }
    },
  )
}
