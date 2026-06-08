/**
 * Output / validation / history tools — the "did I do it right?" layer.
 *
 *   set_output_comparator — write tool, patches comfyui_config.outputComparator.
 *   validate_params       — read tool, runs the deep cross-reference validator.
 *   list_snapshots        — read tool, enumerates the .history/<id>/ contents.
 *   snapshot_restore      — write tool, rolls the workflow back to a snapshot.
 *
 * Grouped here rather than under node-config.ts because they share a theme
 * ("verify or roll back"), not because they share machinery. set_output_
 * comparator could just as well live in node-config — it's a comfyui_config
 * setter — but keeping it next to the validator + snapshot tools makes the
 * "after I edit, here's how I check and how I undo" loop obvious from one
 * file.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { restoreSnapshotById } from '../../services/workflows.js'
import { listSnapshots } from '../../lib/workflowFs.js'
import { applyParamsPatch, withComfyConfig, ParamsValidationError } from '../params-patch.js'
import { runDeepValidation } from '../validators.js'
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

const workflowIdSchema = z
  .string()
  .min(1)
  .describe('Workflow slug — use list_workflows to discover valid ids.')

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerValidationTools(server: McpServer): void {
  // ── set_output_comparator ────────────────────────────────────
  server.registerTool(
    'set_output_comparator',
    {
      title: 'Set output comparator',
      description:
        'Patches `params.comfyui_config.outputComparator` — controls the ' +
        'side-by-side output preview feature. The full shape on disk is ' +
        '`{ inputNodeId?: string, defaultEnabled?: boolean }`. ' +
        '\n\nMerge semantics: pass either or both keys to set them; pass a ' +
        'key as `null` to clear just that sub-key; omit a key to leave its ' +
        'current value untouched. After applying, if both sub-keys end up ' +
        'unset, the `outputComparator` block itself is dropped from ' +
        'params.json to keep the file clean. ' +
        '\n\nDoes NOT verify `inputNodeId` exists in workflow.json — that\'s ' +
        'a `validate_params` concern. The comparator silently disables at ' +
        'runtime if the node is missing; the AI should run validate_params ' +
        'after writing to confirm.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        inputNodeId: z
          .string()
          .nullable()
          .optional()
          .describe(
            'ComfyUI node id to use as the comparator anchor (e.g. "78"). ' +
              'null clears just this sub-key. Omit to leave unchanged.',
          ),
        defaultEnabled: z
          .boolean()
          .nullable()
          .optional()
          .describe(
            'Whether the comparator UI is on by default. null clears this ' +
              'sub-key. Omit to leave unchanged.',
          ),
      },
    },
    async ({ workflowId, inputNodeId, defaultEnabled }, extra) => {
      const auth = getMcpAuth(extra)
      if (inputNodeId === undefined && defaultEnabled === undefined) {
        return toolError(
          'No changes requested — pass at least one of inputNodeId / defaultEnabled (value, or null to clear).',
        )
      }
      try {
        const result = applyParamsPatch(workflowId, (params) =>
          withComfyConfig(params, (cc) => {
            const current = (cc.outputComparator ?? {}) as Record<string, unknown>
            const next = { ...current }
            if (inputNodeId !== undefined) {
              if (inputNodeId === null) delete next.inputNodeId
              else next.inputNodeId = inputNodeId
            }
            if (defaultEnabled !== undefined) {
              if (defaultEnabled === null) delete next.defaultEnabled
              else next.defaultEnabled = defaultEnabled
            }
            if (Object.keys(next).length === 0) {
              return Object.fromEntries(
                Object.entries(cc).filter(([k]) => k !== 'outputComparator'),
              )
            }
            return { ...cc, outputComparator: next }
          }),
        )
        auditMcp(
          'set_output_comparator',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, inputNodeId, defaultEnabled },
        )
        return toolJson({
          workflowId,
          inputNodeId,
          defaultEnabled,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_output_comparator failed')
      }
    },
  )

  // ── validate_params ──────────────────────────────────────────
  server.registerTool(
    'validate_params',
    {
      title: 'Validate params + workflow + SKILL.md',
      description:
        'Runs coffee-maker\'s deep validator against a workflow\'s ' +
        '`params.json`, `workflow.json` and `SKILL.md`. Returns ' +
        '`{ valid, summary, checks[], issues[] }`. ' +
        '\n\nNote: this is a *coffee-maker side* validator, not gt-plugins\' ' +
        'authoritative validator (which doesn\'t expose a network endpoint ' +
        'yet). Treat passing checks as "no known coffee-maker-visible ' +
        'problems"; treat failing checks as definitive errors. When gt-' +
        'plugins exposes its validator, this tool will additionally proxy it. ' +
        '\n\nChecks performed include:\n' +
        '  • params.json structural shape (root object, known key types).\n' +
        '  • workflow.json is readable JSON.\n' +
        '  • comfyui_config: every nodeId in hiddenNodeIds / wrappedNodeIds /' +
        ' subgraphs.nodesOrder / node_parsers.input_nodes exists in ' +
        'workflow.json.\n' +
        '  • Per-node parser inputs: every fieldName declared exists on the ' +
        'node\'s `inputs`.\n' +
        '  • Field-level + node-level connectTo: watched nodeId/inputField ' +
        'pairs resolve.\n' +
        '  • outputComparator.inputNodeId resolves.\n' +
        '  • powerflowConfig.availableConnections.{inputs,outputs}[]: every ' +
        'nodeId + field resolves.\n' +
        '  • imagine.mainMediaNode: nodeId + fieldName resolve; SKILL.md ' +
        'exists; frontmatter.name matches slug; frontmatter.mediaType ' +
        'matches mainMediaNode.type.\n\n' +
        'No side effects. Run after a sequence of write tools to confirm ' +
        'everything cross-references correctly. The `issues[]` array is ' +
        'human-readable — surface to the user verbatim if non-empty.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: { workflowId: workflowIdSchema },
    },
    async ({ workflowId }) => {
      try {
        return toolJson(runDeepValidation(workflowId))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'validate_params failed')
      }
    },
  )

  // ── list_snapshots ───────────────────────────────────────────
  server.registerTool(
    'list_snapshots',
    {
      title: 'List workflow snapshots',
      description:
        'Returns every saved snapshot for a workflow, newest first. Each ' +
        'entry is `{ id, savedAt, kind, label }` where `id` is the snapshot ' +
        'identifier (timestamp + kind), `kind` is one of "params" / ' +
        '"workflow" / "meta" / "import", and `savedAt` is an ISO timestamp. ' +
        'Snapshots are taken automatically by every MCP write tool, by the ' +
        'Node Manager save bar, and before each restore — so the same ' +
        'workflow accumulates many; the list returns at most ' +
        'SNAPSHOT_CAP (50) most-recent entries. ' +
        '\n\nUse the `id` field as input to `snapshot_restore` or ' +
        '`diff_params` for rollback workflows.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: { workflowId: workflowIdSchema },
    },
    async ({ workflowId }) => {
      try {
        const snaps = listSnapshots(workflowId)
        const LABEL: Record<string, string> = {
          params: 'Params edit',
          workflow: 'Workflow edit',
          meta: 'Metadata edit',
          import: 'Before import',
        }
        return toolJson({
          workflowId,
          count: snaps.length,
          snapshots: snaps.map((s) => ({
            id: s.id,
            savedAt: s.savedAt,
            kind: s.kind,
            label: LABEL[s.kind] ?? s.kind,
          })),
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'list_snapshots failed')
      }
    },
  )

  // ── snapshot_restore ─────────────────────────────────────────
  server.registerTool(
    'snapshot_restore',
    {
      title: 'Restore workflow from snapshot',
      description:
        'Restores the workflow folder from a named snapshot. **Restores the ' +
        'ENTIRE folder** — params.json, workflow.json, SKILL.md, icons, ' +
        'subfolders, everything — not just params.json. Snapshots are ' +
        'whole-folder copies, so a restore is an all-or-nothing operation. ' +
        '\n\nSafety: before overwriting, the current state is automatically ' +
        'snapshotted (kind="meta") so a follow-up `snapshot_restore` can ' +
        'undo the restore. The chain is: edit → snapshot → restore → ' +
        '(pre-restore snapshot) → if needed, restore the pre-restore snapshot. ' +
        '\n\nConfirmation required: pass `confirm: true`. Without it the ' +
        'tool returns an error and does nothing — the confirm flag forces ' +
        'the model to pause and confirm intent before destructive replace.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        snapshotId: z
          .string()
          .min(1)
          .describe(
            'The snapshot identifier from list_snapshots, e.g. ' +
              '"2025-05-19T10-30-45-123Z__params".',
          ),
        confirm: z
          .boolean()
          .describe(
            'Must be true to proceed. This is a forcing function, not a ' +
              'permission gate — set it only after you\'ve decided the ' +
              'restore is intentional.',
          ),
      },
    },
    async ({ workflowId, snapshotId, confirm }, extra) => {
      const auth = getMcpAuth(extra)
      if (!confirm) {
        return toolError(
          'snapshot_restore requires confirm: true. The restore replaces the ' +
            'entire workflow folder — set the flag and call again if you really mean it.',
          { workflowId, snapshotId },
        )
      }
      try {
        const summary = restoreSnapshotById(workflowId, snapshotId)
        auditMcp(
          'snapshot_restore',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, snapshotId },
        )
        return toolJson({
          workflowId,
          snapshotId,
          restored: true,
          summary,
          message:
            'Workflow folder restored. A pre-restore snapshot was saved automatically — ' +
            'use list_snapshots to find it if you need to undo.',
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'snapshot_restore failed')
      }
    },
  )
}
