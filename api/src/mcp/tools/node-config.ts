/**
 * Node-config write tools. Every tool here mutates `params.json` through
 * `applyParamsPatch` — the read-patch-validate-write helper that snapshots
 * before disk write and refuses to persist a malformed result.
 *
 * Each tool targets exactly one path inside `params.comfyui_config`:
 *
 *   set_node_parser     → comfyui_config.node_parsers.input_nodes[nodeId].inputs
 *   set_node_visibility → comfyui_config.hiddenNodeIds / wrappedNodeIds
 *   set_node_condition  → comfyui_config.node_parsers.input_nodes[nodeId].connectTo
 *   set_field_condition → comfyui_config.node_parsers.input_nodes[nodeId].inputs[fieldName].connectTo
 *   set_subgraph        → comfyui_config.subgraphs[subgraphId]
 *   set_placeholders    → comfyui_config.placeholders
 *
 * The patch helper diff-summarises the change so the tool result tells the
 * AI exactly which keys moved, without dumping the entire file. Heavy on
 * description text — these are write tools that touch user-visible UI, so
 * the model needs the right vocabulary up front to plan good edits.
 *
 * Snapshot semantics: every successful patch writes a `__params` snapshot to
 * `.history/<id>/` before the new bytes hit disk. Use the History panel or
 * `diff_params` to roll back.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyParamsPatch,
  withComfyConfig,
  withNodeParser,
  toggleInComfyArray,
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
    'ComfyUI node id — the string key in workflow.json. Numeric in practice ' +
      '("6", "78") but stored as a string.',
  )

const fieldNameSchema = z
  .string()
  .min(1)
  .describe(
    'Input field name on a ComfyUI node — the key under that node\'s `inputs` ' +
      'object in workflow.json. Examples: "text", "ckpt_name", "seed", "steps".',
  )

const fieldValueSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .describe('Primitive value — string, number, or boolean. Matches the FieldValue type.')

// Mode flag used by tools that can either merge into existing config or
// replace it outright. Default is 'merge' everywhere because that preserves
// unrelated config — the safer behaviour for AI-driven edits.
const mergeModeSchema = z
  .enum(['merge', 'replace'])
  .optional()
  .describe(
    '"merge" (default) preserves existing keys not mentioned in the patch — ' +
      'safest for incremental edits. "replace" overwrites the target entry ' +
      'entirely. Use "replace" only when you have read the current state and ' +
      'are intentionally clearing other keys.',
  )

/* ─── ConnectTo schemas ──────────────────────────────────────── */
// Node-level connectTo gates VISIBILITY: when the watched field has value X,
// the node is shown (or hidden, depending on which key is set in conditions).
const nodeConnectToSchema = z
  .object({
    nodeId: z
      .string()
      .describe('The id of the WATCHED node — the one whose field value drives the rule.'),
    inputField: z
      .string()
      .describe('The field name on the watched node to compare.'),
    conditions: z
      .array(
        z
          .object({
            displayedWhen: fieldValueSchema.optional(),
            hiddenWhen: fieldValueSchema.optional(),
          })
          .describe(
            'One condition per array entry. Exactly one of displayedWhen / ' +
              'hiddenWhen should be set. displayedWhen: show this node when ' +
              'the watched field equals the value. hiddenWhen: hide when equal.',
          ),
      )
      .min(1)
      .describe(
        'Array of conditions — combined with OR semantics within a kind ' +
          '(any displayedWhen match shows; any hiddenWhen match hides).',
      ),
  })
  .describe(
    'Node-level visibility rule. The node this connectTo lives on is the ' +
      'GATED one; nodeId/inputField identify the WATCHED field.',
  )

// Field-level connectTo AUTO-SETS this field's value when another field
// matches — schema is different: { whenValue, value } not { displayedWhen,
// hiddenWhen }. Keep these two straight in tool descriptions to prevent the
// AI from mixing them up.
const fieldConnectToSchema = z
  .object({
    nodeId: z.string().describe('Id of the WATCHED node.'),
    inputField: z.string().describe('Field on the watched node to compare.'),
    conditions: z
      .array(
        z
          .object({
            whenValue: fieldValueSchema.optional(),
            value: fieldValueSchema.optional(),
          })
          .describe(
            'When the watched field equals whenValue, this field is auto-set ' +
              'to value. Both should be set; if only one is, the rule is a ' +
              'pass-through (preserved on save but not enforced).',
          ),
      )
      .min(1)
      .describe('Array of {whenValue, value} pairs.'),
  })
  .describe(
    'Field-level auto-set rule. Different shape from node-level connectTo: ' +
      'this one assigns the field a value rather than gating its visibility.',
  )

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerNodeConfigTools(server: McpServer): void {
  // ── set_node_parser ──────────────────────────────────────────
  server.registerTool(
    'set_node_parser',
    {
      title: 'Set node parser entry',
      description:
        'Updates the field-config map for a node — i.e. ' +
        '`params.comfyui_config.node_parsers.input_nodes[nodeId].inputs`. ' +
        'Each key in `fields` is a field name on the node; each value is a ' +
        'FieldConfig (type/label/default/options/etc.) describing how the ' +
        'field should appear in the UI, OR `false` to hide it entirely. ' +
        '\n\nFieldConfig.type is the main control type: "textField", ' +
        '"textArea", "number", "slider", "select", "checkbox", "uploadImage", ' +
        '"uploadVideo", "uploadAudio", "file", "folder", or "unknown". Other ' +
        'common keys: label (display name), default (initial value), min/max/' +
        'step (numbers), options (for select), required, accept (file ' +
        'types). ' +
        '\n\nModes: "merge" (default) adds/updates listed fields, leaves ' +
        'other field configs on this node untouched. "replace" wipes the ' +
        'whole node entry and writes only what you provided. Use read_params ' +
        'first if unsure which fields already exist. ' +
        '\n\nPass an empty `fields` object with mode=replace to clear all ' +
        'field configs for the node (which also drops the entry from ' +
        'input_nodes when no other keys like connectTo remain on it). ' +
        '\n\nSnapshots automatically; validates the resulting params.json ' +
        'shape and refuses to persist if invalid.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        nodeId: nodeIdSchema,
        fields: z
          .record(
            z.string(),
            // FieldConfig accepts arbitrary extra keys (passthrough) — the
            // on-disk schema isn't strictly enforced; we mirror that. `false`
            // marks the field as hidden.
            z.union([z.literal(false), z.record(z.string(), z.unknown())]),
          )
          .describe(
            'Map of fieldName → FieldConfig (object) or `false`. Examples: ' +
              '{ "text": { "type": "textArea", "label": "Prompt", "default": "" }, ' +
              '"seed": { "type": "number", "label": "Seed", "default": 0 }, ' +
              '"secret_param": false }',
          ),
        mode: mergeModeSchema,
      },
    },
    async ({ workflowId, nodeId, fields, mode }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withNodeParser(params, nodeId, (entry) => {
            const currentInputs = (entry.inputs ?? {}) as Record<string, unknown>
            const nextInputs =
              mode === 'replace' ? { ...fields } : { ...currentInputs, ...fields }
            // If the result is an empty inputs map AND the entry has no other
            // keys (e.g. no connectTo), drop the entry entirely.
            const keptInputs = Object.keys(nextInputs).length > 0 ? nextInputs : undefined
            const next: Record<string, unknown> = { ...entry }
            if (keptInputs) next.inputs = keptInputs
            else delete next.inputs
            return Object.keys(next).length > 0 ? next : null
          }),
        )
        auditMcp(
          'set_node_parser',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, nodeId, fieldsTouched: Object.keys(fields), mode: mode ?? 'merge' },
        )
        return toolJson({
          workflowId,
          nodeId,
          mode: mode ?? 'merge',
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_node_parser failed')
      }
    },
  )

  // ── set_node_visibility ──────────────────────────────────────
  server.registerTool(
    'set_node_visibility',
    {
      title: 'Set node visibility',
      description:
        'Adds or removes a node from coffee-maker\'s UI visibility lists: ' +
        '`comfyui_config.hiddenNodeIds[]` (node not rendered in the editor ' +
        'at all) and `comfyui_config.wrappedNodeIds[]` (node folded into a ' +
        'subgraph wrapper). Pass `true` to ensure the node IS in the list, ' +
        '`false` to ensure it ISN\'T, or `null`/omit to leave that list ' +
        'unchanged. Both lists can be touched in one call. ' +
        '\n\nThis tool is idempotent — calling it twice with the same args ' +
        'is a no-op the second time. ' +
        '\n\nExamples: { hidden: true } hides the node; { wrapped: false } ' +
        'pulls the node back out of subgraph wrapping but leaves its ' +
        'hidden-ness alone; { hidden: false, wrapped: false } fully exposes ' +
        'the node again.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        nodeId: nodeIdSchema,
        hidden: z
          .boolean()
          .nullable()
          .optional()
          .describe(
            'Add to (`true`) or remove from (`false`) hiddenNodeIds. ' +
              'null/omit leaves it unchanged.',
          ),
        wrapped: z
          .boolean()
          .nullable()
          .optional()
          .describe(
            'Add to (`true`) or remove from (`false`) wrappedNodeIds. ' +
              'null/omit leaves it unchanged.',
          ),
      },
    },
    async ({ workflowId, nodeId, hidden, wrapped }, extra) => {
      const auth = getMcpAuth(extra)
      if (hidden == null && wrapped == null) {
        return toolError('No changes requested — pass hidden and/or wrapped (boolean).')
      }
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          let next = params
          if (hidden != null) next = toggleInComfyArray(next, 'hiddenNodeIds', nodeId, hidden)
          if (wrapped != null) next = toggleInComfyArray(next, 'wrappedNodeIds', nodeId, wrapped)
          return next
        })
        auditMcp(
          'set_node_visibility',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, nodeId, hidden, wrapped },
        )
        return toolJson({
          workflowId,
          nodeId,
          hidden,
          wrapped,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_node_visibility failed')
      }
    },
  )

  // ── set_node_condition ───────────────────────────────────────
  server.registerTool(
    'set_node_condition',
    {
      title: 'Set node-level connectTo (visibility rule)',
      description:
        'Sets the node-level `connectTo` on a node parser entry — i.e. ' +
        '`params.comfyui_config.node_parsers.input_nodes[nodeId].connectTo`. ' +
        'This rule gates the node\'s VISIBILITY: when a watched field on ' +
        'another node has a specific value, this node is either shown ' +
        '(displayedWhen) or hidden (hiddenWhen) in the editor. ' +
        '\n\nDistinct from set_field_condition: that one auto-sets a field\'s ' +
        'value based on another field. Pick the right tool: visibility = ' +
        'set_node_condition; auto-set value = set_field_condition. ' +
        '\n\nPass `connectTo: null` to remove the rule entirely. The shape ' +
        'is { nodeId (watched), inputField (watched field), conditions[] }, ' +
        'where each condition has displayedWhen OR hiddenWhen (exactly one). ' +
        '\n\nIf the targeted node has no other parser config (no inputs, no ' +
        'other keys), removing the connectTo drops the node entry entirely ' +
        'to keep params.json clean.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        nodeId: nodeIdSchema.describe(
          'The id of the node being GATED (the one whose visibility depends on ' +
            'the rule). The watched node lives in `connectTo.nodeId`.',
        ),
        connectTo: nodeConnectToSchema
          .nullable()
          .describe('The visibility rule, or null to remove the current one.'),
      },
    },
    async ({ workflowId, nodeId, connectTo }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withNodeParser(params, nodeId, (entry) => {
            const next: Record<string, unknown> = { ...entry }
            if (connectTo === null) delete next.connectTo
            else next.connectTo = connectTo
            return Object.keys(next).length > 0 ? next : null
          }),
        )
        auditMcp(
          'set_node_condition',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, nodeId, cleared: connectTo === null },
        )
        return toolJson({
          workflowId,
          nodeId,
          connectTo,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_node_condition failed')
      }
    },
  )

  // ── set_field_condition ──────────────────────────────────────
  server.registerTool(
    'set_field_condition',
    {
      title: 'Set field-level connectTo (auto-set value)',
      description:
        'Sets the field-level `connectTo` on a field config — i.e. ' +
        '`params.comfyui_config.node_parsers.input_nodes[nodeId].inputs' +
        '[fieldName].connectTo`. When the watched field matches `whenValue`, ' +
        'this field is auto-set to `value`. Use to wire form-driven ' +
        'parameter cascades (e.g. when "model" is "flux-dev" auto-set ' +
        '"steps" to 28). ' +
        '\n\nNot the same as set_node_condition: that one gates whether a ' +
        'NODE is shown; this one rewrites a FIELD\'s value. Both can coexist ' +
        'on the same node. ' +
        '\n\nIf the field has no FieldConfig yet, an empty one is created ' +
        'first ({ connectTo: ... }) — the field becomes "parsed". Pass ' +
        '`connectTo: null` to remove just the rule, leaving the rest of the ' +
        'FieldConfig (type, label, default, etc.) intact. If the FieldConfig ' +
        'becomes empty after removal, the field entry itself is dropped.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        nodeId: nodeIdSchema,
        fieldName: fieldNameSchema,
        connectTo: fieldConnectToSchema
          .nullable()
          .describe(
            'The auto-set rule, or null to remove the existing one from this field.',
          ),
      },
    },
    async ({ workflowId, nodeId, fieldName, connectTo }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withNodeParser(params, nodeId, (entry) => {
            const inputs = { ...((entry.inputs ?? {}) as Record<string, unknown>) }
            const currentField = inputs[fieldName]
            // If the existing entry is `false` (hidden), we can't add a
            // connectTo to it — refuse politely by throwing; the helper will
            // surface as a validation error.
            if (currentField === false) {
              throw new Error(
                `Field "${fieldName}" on node ${nodeId} is hidden (false). ` +
                  'Use set_node_parser to give it a config first.',
              )
            }
            const fieldCfg =
              (currentField && typeof currentField === 'object' && !Array.isArray(currentField)
                ? { ...(currentField as Record<string, unknown>) }
                : {}) as Record<string, unknown>
            if (connectTo === null) delete fieldCfg.connectTo
            else fieldCfg.connectTo = connectTo
            if (Object.keys(fieldCfg).length === 0) {
              delete inputs[fieldName]
            } else {
              inputs[fieldName] = fieldCfg
            }
            const next: Record<string, unknown> = { ...entry }
            if (Object.keys(inputs).length > 0) next.inputs = inputs
            else delete next.inputs
            return Object.keys(next).length > 0 ? next : null
          }),
        )
        auditMcp(
          'set_field_condition',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, nodeId, fieldName, cleared: connectTo === null },
        )
        return toolJson({
          workflowId,
          nodeId,
          fieldName,
          connectTo,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_field_condition failed')
      }
    },
  )

  // ── set_subgraph ─────────────────────────────────────────────
  server.registerTool(
    'set_subgraph',
    {
      title: 'Set subgraph config',
      description:
        'Configures a subgraph entry at `params.comfyui_config.subgraphs' +
        '[subgraphId]`. Subgraphs wrap several wrapped nodes (those in ' +
        'wrappedNodeIds) into a single collapsible block in the Node Manager ' +
        'UI, with their own label, ordering, and optional label-hiding for ' +
        'a cleaner inner layout. ' +
        '\n\nKeys (all optional, all merged by default): ' +
        '\n- label: human-readable title for the subgraph ' +
        '\n- hideNodeLabels: `true` to hide every inner node\'s label, an ' +
        'array of node ids to hide selectively, or `false`/omit to show them ' +
        '\n- nodesOrder: ordered array of node ids — controls the display ' +
        'order of inner nodes within the subgraph. ' +
        '\n\nMode "merge" (default) updates only the keys you pass. ' +
        '"replace" overwrites the whole subgraph entry. Pass `config: null` ' +
        'to delete the subgraph entirely. ' +
        '\n\nA subgraph "exists" once it has an entry here — the ' +
        'subgraphId is a free-form string the workflow author chooses.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        subgraphId: z
          .string()
          .min(1)
          .describe(
            'Free-form subgraph identifier — the key under `subgraphs`. ' +
              'Examples: "advanced", "samplers", "post". Choose something ' +
              'human-readable; it shows up in the UI.',
          ),
        config: z
          .object({
            label: z.string().optional().describe('Display title for the subgraph.'),
            hideNodeLabels: z
              .union([z.boolean(), z.array(z.string())])
              .optional()
              .describe(
                '`true` to hide every inner node\'s label; an array of node ' +
                  'ids to hide selectively; false/omit to show.',
              ),
            nodesOrder: z
              .array(z.string())
              .optional()
              .describe('Ordered list of inner node ids — controls render order.'),
          })
          .passthrough()
          .nullable()
          .describe('Subgraph config, or null to delete the subgraph entry.'),
        mode: mergeModeSchema,
      },
    },
    async ({ workflowId, subgraphId, config, mode }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withComfyConfig(params, (cc) => {
            const current = (cc.subgraphs ?? {}) as Record<string, Record<string, unknown>>
            const updated = { ...current }
            if (config === null) {
              delete updated[subgraphId]
            } else {
              const existing = (updated[subgraphId] ?? {}) as Record<string, unknown>
              updated[subgraphId] = mode === 'replace' ? { ...config } : { ...existing, ...config }
            }
            if (Object.keys(updated).length > 0) return { ...cc, subgraphs: updated }
            return Object.fromEntries(Object.entries(cc).filter(([k]) => k !== 'subgraphs'))
          }),
        )
        auditMcp(
          'set_subgraph',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, subgraphId, cleared: config === null, mode: mode ?? 'merge' },
        )
        return toolJson({
          workflowId,
          subgraphId,
          config,
          mode: mode ?? 'merge',
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_subgraph failed')
      }
    },
  )

  // ── set_placeholders ─────────────────────────────────────────
  server.registerTool(
    'set_placeholders',
    {
      title: 'Set placeholder mappings',
      description:
        'Updates `params.comfyui_config.placeholders` — a map from ' +
        'placeholder name → list of strings used by the parser to substitute ' +
        'dynamic values at run time (e.g. dropdown options that depend on ' +
        'enumerated server-side resources). ' +
        '\n\nModes: "merge" (default) adds/updates the placeholders in your ' +
        'patch and keeps the rest. "replace" wipes the existing map and ' +
        'writes only what you provide. Pass an empty object `{}` with ' +
        'mode="replace" to clear every placeholder. ' +
        '\n\nTo remove a single placeholder by name, pass it with `null` ' +
        '(NOT `[]`, which would set an empty option list — semantically ' +
        'different). The tool accepts either form and translates `null` to ' +
        'deletion.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        placeholders: z
          .record(z.string(), z.union([z.array(z.string()), z.null()]))
          .describe(
            'Map of placeholderName → string[] (the option list), or null ' +
              '(to delete this placeholder key). Examples: { "models": ' +
              '["sd_xl", "flux_dev"], "deprecated": null }.',
          ),
        mode: mergeModeSchema,
      },
    },
    async ({ workflowId, placeholders, mode }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withComfyConfig(params, (cc) => {
            const current = (cc.placeholders ?? {}) as Record<string, string[]>
            const base = mode === 'replace' ? {} : { ...current }
            for (const [k, v] of Object.entries(placeholders)) {
              if (v === null) delete base[k]
              else base[k] = v
            }
            if (Object.keys(base).length > 0) return { ...cc, placeholders: base }
            return Object.fromEntries(Object.entries(cc).filter(([k]) => k !== 'placeholders'))
          }),
        )
        auditMcp(
          'set_placeholders',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          {
            workflowId,
            keysTouched: Object.keys(placeholders),
            removed: Object.entries(placeholders)
              .filter(([, v]) => v === null)
              .map(([k]) => k),
            mode: mode ?? 'merge',
          },
        )
        return toolJson({
          workflowId,
          placeholdersTouched: Object.keys(placeholders),
          mode: mode ?? 'merge',
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_placeholders failed')
      }
    },
  )
}
