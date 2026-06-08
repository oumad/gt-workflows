/**
 * MCP tools that operate on workflow metadata + node graph.
 *
 * All tools in this file are READ-ONLY. They never write to disk and never
 * snapshot. They give the AI the context it needs to plan changes (which
 * write tools — coming in later batches — will then apply through targeted
 * patches with snapshots and validation).
 *
 * Tool descriptions are written for the model, not the human. Be explicit:
 *  - What does this tool do?
 *  - When should the model use it?
 *  - What does each parameter mean?
 *  - What shape does the result take?
 *
 * The model reads these descriptions to decide which tool to invoke. Vague
 * descriptions => bad tool calls; verbose-but-specific descriptions => good
 * tool calls. Bias toward verbose.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listWorkflows, resolveFolder, readParams } from '../../services/workflows.js'
import { listTree } from '../../services/workflowFiles.js'
import { historyRoot, listSnapshots } from '../../lib/workflowFs.js'
import {
  toolJson,
  toolError,
  readSnapshotParams,
  readWorkflowJsonForId,
  diffObjects,
} from '../tool-helpers.js'

/* ─── Tool input schemas ───────────────────────────────────────── */
const workflowIdSchema = z
  .string()
  .min(1)
  .describe(
    'The workflow id (slug). Matches the folder name on disk after slugify — ' +
      'e.g. "image-edit-qwen" or "lora-flux-train". Use list_workflows to find ' +
      'valid ids. NOT the human-readable name.',
  )

const nodeIdSchema = z
  .string()
  .min(1)
  .describe(
    'The ComfyUI node id — the string key in workflow.json. Always numeric in ' +
      'practice ("6", "12", "78") but stored as a string. Use read_workflow ' +
      'first to discover valid node ids.',
  )

const fieldNameSchema = z
  .string()
  .min(1)
  .describe(
    'The input field name on a ComfyUI node (the key under the node\'s `inputs` ' +
      'object). Examples: "text", "ckpt_name", "seed", "steps", "image".',
  )

/* ─── Helpers ──────────────────────────────────────────────────── */

/** Read workflow.json or throw — turns the shared helper's `null` result
 *  into a tool-friendly error message. */
function readWorkflowJson(id: string): Record<string, unknown> {
  const wf = readWorkflowJsonForId(id)
  if (!wf) throw new Error('Workflow file is missing or could not be parsed as JSON.')
  return wf
}

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerWorkflowTools(server: McpServer): void {
  // ── list_workflows ───────────────────────────────────────────
  server.registerTool(
    'list_workflows',
    {
      title: 'List workflows',
      description:
        'Returns a concise list of every workflow registered in coffee-maker. ' +
        'Each entry includes: id (the slug — use this in other tools), name ' +
        '(human-readable label), parser (e.g. "comfyui", "script"), category, ' +
        'powerflow (true when the workflow has powerflowConfig in params.json), ' +
        'and tags. Use this as the entry point when the user mentions a ' +
        'workflow by name but you don\'t know its id. The result is sorted by ' +
        'category then name. Lightweight — does not read workflow.json.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe(
            'Optional filter — only return workflows in this category. ' +
              'Categories are inferred from name unless params.json sets one ' +
              'explicitly. Common values: "Image", "Video", "Training", ' +
              '"Data", "General".',
          ),
      },
    },
    async ({ category }) => {
      const all = listWorkflows(category ?? null)
      const summarised = all.map((w) => {
        // Cheap powerflow detection — reads params.json (small) but not
        // workflow.json. The full powerflow config is available via
        // read_params if the AI needs to inspect it.
        let powerflow = false
        try {
          const { folderAbs } = resolveFolder(w.id)
          const params = readParams(folderAbs) as { powerflowConfig?: unknown }
          powerflow = !!params.powerflowConfig
        } catch {
          /* ignore */
        }
        return {
          id: w.id,
          name: w.name,
          path: w.path,
          category: w.category,
          parser: w.parser,
          tags: w.tags,
          powerflow,
          tested: w.tested,
          audited: w.audited,
          devMode: w.devMode,
        }
      })
      return toolJson({ count: summarised.length, workflows: summarised })
    },
  )

  // ── read_params ──────────────────────────────────────────────
  server.registerTool(
    'read_params',
    {
      title: 'Read params.json',
      description:
        'Returns the full params.json for a workflow. This is the file that ' +
        'controls metadata (label, description, tags, timeout, servers), ' +
        'parser configuration (parser.inputs for per-node field overrides, ' +
        'parser.outputs, parser.connectTo), and feature configs (describe, ' +
        'imagine, powerflowConfig). Use this when you need to understand or ' +
        'reason about how a workflow is configured. Use read_workflow for the ' +
        'ComfyUI node graph itself.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { workflowId: workflowIdSchema },
    },
    async ({ workflowId }) => {
      try {
        const { folderAbs } = resolveFolder(workflowId)
        return toolJson(readParams(folderAbs))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'read_params failed')
      }
    },
  )

  // ── read_workflow ────────────────────────────────────────────
  server.registerTool(
    'read_workflow',
    {
      title: 'Read workflow.json',
      description:
        'Returns the full ComfyUI workflow.json — the raw node graph sent to ' +
        'the ComfyUI server at run time. Object keyed by node id (e.g. "6", ' +
        '"12"); each node has { class_type, inputs, _meta? }. inputs values ' +
        'are either literals (string/number/boolean) or two-element ' +
        '[fromNodeId, outputSlot] tuples for inter-node connections. Use ' +
        'before editing nodes/connections to know what already exists, and ' +
        'pair with read_params to see the parser config layered on top.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { workflowId: workflowIdSchema },
    },
    async ({ workflowId }) => {
      try {
        const wf = readWorkflowJson(workflowId)
        return toolJson({
          nodeCount: Object.keys(wf).length,
          nodeIds: Object.keys(wf),
          workflow: wf,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'read_workflow failed')
      }
    },
  )

  // ── get_node_info ────────────────────────────────────────────
  server.registerTool(
    'get_node_info',
    {
      title: 'Get node info',
      description:
        'Returns everything known about a single node: its class_type and ' +
        '_meta from workflow.json, the inputs object (literal values + ' +
        'reference tuples), and the parser config for that node from ' +
        'params.json (parser.inputs[nodeId]) if any. This is the right tool ' +
        'when the user asks about a specific node ("what does node 6 do?", ' +
        '"what are the inputs on the KSampler?"). Cheaper than read_workflow ' +
        'when you only care about one node.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { workflowId: workflowIdSchema, nodeId: nodeIdSchema },
    },
    async ({ workflowId, nodeId }) => {
      try {
        const wf = readWorkflowJson(workflowId)
        const node = wf[nodeId] as Record<string, unknown> | undefined
        if (!node) return toolError(`Node ${nodeId} not found in workflow.json`)
        const { folderAbs } = resolveFolder(workflowId)
        const params = readParams(folderAbs) as {
          comfyui_config?: {
            node_parsers?: { input_nodes?: Record<string, Record<string, unknown>> }
            hiddenNodeIds?: string[]
            wrappedNodeIds?: string[]
          }
        }
        const cc = params.comfyui_config
        const parserCfg = cc?.node_parsers?.input_nodes?.[nodeId]
        return toolJson({
          nodeId,
          class_type: node.class_type,
          _meta: node._meta ?? null,
          inputs: node.inputs ?? {},
          parserConfig: parserCfg ?? null,
          isHidden: Array.isArray(cc?.hiddenNodeIds) && cc.hiddenNodeIds.includes(nodeId),
          isWrapped: Array.isArray(cc?.wrappedNodeIds) && cc.wrappedNodeIds.includes(nodeId),
          inputCount: node.inputs && typeof node.inputs === 'object'
            ? Object.keys(node.inputs as object).length
            : 0,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'get_node_info failed')
      }
    },
  )

  // ── get_field_config ─────────────────────────────────────────
  server.registerTool(
    'get_field_config',
    {
      title: 'Get resolved field config',
      description:
        'Returns the resolved configuration for one specific input field on ' +
        'one node — the result of merging the parser default for that field ' +
        'with the per-field override in params.json (parser.inputs[nodeId]' +
        '[fieldName]). Output: { exists, currentValue (from workflow.json), ' +
        'override (from params.json parser config, or null), class_type, ' +
        'isHidden (true if the override is `false`) }. Use when reasoning ' +
        'about whether a field is exposed in the UI, has a custom default, ' +
        'or is wired to a connectTo / power flow rule.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        workflowId: workflowIdSchema,
        nodeId: nodeIdSchema,
        fieldName: fieldNameSchema,
      },
    },
    async ({ workflowId, nodeId, fieldName }) => {
      try {
        const wf = readWorkflowJson(workflowId)
        const node = wf[nodeId] as { class_type?: string; inputs?: Record<string, unknown> } | undefined
        if (!node) return toolError(`Node ${nodeId} not found`)
        const currentValue = node.inputs?.[fieldName]
        const { folderAbs } = resolveFolder(workflowId)
        const params = readParams(folderAbs) as {
          comfyui_config?: {
            node_parsers?: {
              input_nodes?: Record<
                string,
                { inputs?: Record<string, unknown>; connectTo?: unknown }
              >
            }
          }
        }
        const nodeEntry = params.comfyui_config?.node_parsers?.input_nodes?.[nodeId]
        const nodeInputs = nodeEntry?.inputs
        const fieldOverride =
          nodeInputs && Object.prototype.hasOwnProperty.call(nodeInputs, fieldName)
            ? nodeInputs[fieldName]
            : null
        return toolJson({
          exists: node.inputs !== undefined && fieldName in (node.inputs as object),
          class_type: node.class_type ?? null,
          currentValue: currentValue ?? null,
          override: fieldOverride,
          isHidden: fieldOverride === false,
          isConfigured: fieldOverride != null && fieldOverride !== false,
          // The field-level connectTo (auto-set value) and node-level connectTo
          // (visibility) live in different places — surface both so the model
          // doesn't have to chase down which is which.
          fieldConnectTo:
            fieldOverride &&
            typeof fieldOverride === 'object' &&
            !Array.isArray(fieldOverride) &&
            'connectTo' in (fieldOverride as object)
              ? (fieldOverride as { connectTo?: unknown }).connectTo
              : null,
          nodeConnectTo: nodeEntry?.connectTo ?? null,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'get_field_config failed')
      }
    },
  )

  // ── diff_params ──────────────────────────────────────────────
  server.registerTool(
    'diff_params',
    {
      title: 'Diff params vs snapshot',
      description:
        'Compares the current params.json to a previously-saved snapshot and ' +
        'returns the structural diff. Each entry has { path (JSON path like ' +
        '"$.parser.inputs.6.text"), kind ("added" | "removed" | "changed"), ' +
        'before?, after? }. Use to (a) explain to the user what changed since ' +
        'a previous save, (b) verify an edit landed, (c) prepare a rollback ' +
        '("the only diff is $.timeout — set it back to 300"). If snapshotId ' +
        'is omitted, defaults to the most recent snapshot (other than any ' +
        'snapshot kind "meta" with no actual file change). Use ' +
        'list_files or read params.history to enumerate available snapshots.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        workflowId: workflowIdSchema,
        snapshotId: z
          .string()
          .optional()
          .describe(
            'Snapshot id from the workflow\'s .history folder, e.g. ' +
              '"2025-05-19T10-30-45-123Z__params". Omit to compare against ' +
              'the most recent snapshot.',
          ),
      },
    },
    async ({ workflowId, snapshotId }) => {
      try {
        const { folderAbs } = resolveFolder(workflowId)
        const current = readParams(folderAbs)
        const snaps = listSnapshots(workflowId)
        if (snaps.length === 0) {
          return toolError('No snapshots exist for this workflow yet — nothing to diff against')
        }
        const target = snapshotId
          ? snaps.find((s) => s.id === snapshotId)
          : snaps[0] // newest first
        if (!target) {
          return toolError(`Snapshot ${snapshotId} not found`, {
            available: snaps.map((s) => s.id).slice(0, 10),
          })
        }
        const base = readSnapshotParams(historyRoot(workflowId), target.id)
        const diff = diffObjects(base, current)
        return toolJson({
          workflowId,
          snapshot: { id: target.id, savedAt: target.savedAt, kind: target.kind },
          unchanged: diff.length === 0,
          changes: diff,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'diff_params failed')
      }
    },
  )

  // ── list_files (workflow folder tree) ────────────────────────
  // Lives under workflows.ts because the tree is rooted at a single workflow.
  // Kept here even though there's a files.ts because list_files is "list the
  // tree of one workflow" (which IS a workflow operation). The files.ts file
  // owns the per-path read/write/delete primitives.
  server.registerTool(
    'list_files',
    {
      title: 'List workflow files',
      description:
        'Returns the recursive folder tree for one workflow. Every node has ' +
        '{ path (relative to folder root, POSIX-style), name, type ("dir" | ' +
        '"file"), size?, modifiedAt?, children? }. The history folder ' +
        '(.history/) is hidden — use diff_params to compare against ' +
        'snapshots. Use this when the AI needs to know what auxiliary files ' +
        'exist (SKILL.md, prompts, scripts, datasets, icons) before reading ' +
        'or editing them.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { workflowId: workflowIdSchema },
    },
    async ({ workflowId }) => {
      try {
        return toolJson(listTree(workflowId))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'list_files failed')
      }
    },
  )
}
