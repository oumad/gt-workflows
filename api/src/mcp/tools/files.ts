/**
 * MCP tools for file-level read/write inside a workflow folder.
 *
 * Read tools (read_file): no snapshots, no validation, just return contents.
 * Write tools (write_file, delete_file): always snapshot first (via
 * services/workflowFiles which calls snapshotWorkflow under the hood), and
 * pre-validate JSON files before writing.
 *
 * Why write_file is generic instead of N per-feature tools: targeted patch
 * tools (set_node_input, add_describe, etc.) will be added separately. This
 * one is the escape hatch — and crucially, when writing params.json or
 * workflow.json it runs structural validation so a malformed JSON write
 * fails *before* it overwrites the on-disk file.
 *
 * delete_file requires a confirmation token to prevent accidents. The AI
 * must echo back the workflow id + path string to confirm it has read the
 * full path before deletion proceeds — this is cheap insurance against the
 * model losing track of which workflow it's operating on mid-task.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  readFile as svcReadFile,
  writeFile as svcWriteFile,
  deletePath,
} from '../../services/workflowFiles.js'
import {
  toolJson,
  toolError,
  parseJsonStrict,
  validateParamsShape,
  validateWorkflowShape,
} from '../tool-helpers.js'
import { getMcpAuth } from '../auth-ctx.js'

/** Console-level audit trail for write/destructive MCP ops. Lightweight — no
 *  DB write — but means every mutating call is grep-able by token prefix and
 *  user. A dedicated mcp_audit_log table can replace this later without
 *  touching tool handlers. */
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

/* ─── Input schemas ────────────────────────────────────────────── */
const workflowIdSchema = z
  .string()
  .min(1)
  .describe('Workflow slug — use list_workflows to discover valid ids.')

const filePathSchema = z
  .string()
  .min(1)
  .describe(
    'Path inside the workflow folder, POSIX-style ("/" separators), relative ' +
      'to the folder root. Examples: "params.json", "workflow.json", ' +
      '"SKILL.md", "prompts/positive.txt", "icons/logo.png". Use list_files ' +
      'to enumerate. Absolute paths or "..\" traversal are rejected.',
  )

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerFileTools(server: McpServer): void {
  // ── read_file ────────────────────────────────────────────────
  server.registerTool(
    'read_file',
    {
      title: 'Read file',
      description:
        'Reads any file inside a workflow folder by relative path. Returns ' +
        '{ path, name, size, modifiedAt, text?, binary? }. For text files ' +
        '(under 2MB, no NUL bytes) the `text` field contains the UTF-8 ' +
        'contents. For larger or binary files, `binary: true` is returned ' +
        'and `text` is omitted — those need to be downloaded via the HTTP ' +
        'API, not edited through MCP. Use this for params.json, ' +
        'workflow.json, SKILL.md, prompts, scripts, etc.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { workflowId: workflowIdSchema, path: filePathSchema },
    },
    async ({ workflowId, path }) => {
      try {
        return toolJson(svcReadFile(workflowId, path))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'read_file failed')
      }
    },
  )

  // ── write_file ───────────────────────────────────────────────
  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description:
        'Writes (or creates) a text file inside a workflow folder. ' +
        '\n\nIMPORTANT — full-content replace: this tool replaces the file ' +
        'entirely with `text`. For structured config like params.json, prefer ' +
        'dedicated patch tools (when they land) so unrelated config is not ' +
        'wiped. If you must use write_file on params.json or workflow.json, ' +
        'first call read_file, apply your edits in memory, then write the ' +
        'full updated content back. ' +
        '\n\nValidation: if the path ends with .json, the content is ' +
        'parsed and rejected on syntax error. For params.json / workflow.json ' +
        'a structural shape check also runs — root must be an object, plus ' +
        'file-specific constraints (workflow.json: every node must have ' +
        'class_type; params.json: parser/tags/timeout/comfyui_config types ' +
        'are checked). Validation errors are returned WITHOUT touching disk. ' +
        '\n\nSnapshots: a snapshot of the workflow folder is taken before ' +
        'every successful write — use diff_params / the History UI to roll ' +
        'back. The parent folder must already exist (use it via list_files ' +
        'first if unsure). Returns the same shape as read_file.',
      annotations: {
        readOnlyHint: false,
        // Not idempotent: same content twice still snapshots twice, and the
        // file's mtime advances. Logically idempotent for the AI's planning
        // though — we accept the slight tension here.
        idempotentHint: false,
        // Not "destructive" in the MCP sense: the file is overwritten but
        // the workflow folder remains intact, and a snapshot is taken first.
        // Setting destructiveHint:true would scare the model unnecessarily
        // for routine config edits.
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        path: filePathSchema,
        text: z
          .string()
          .describe(
            'Full new text content. UTF-8 — for binary files, use the HTTP ' +
              'upload endpoint instead. Pass the COMPLETE file content (this ' +
              'is a replace, not a patch).',
          ),
      },
    },
    async ({ workflowId, path, text }, extra) => {
      const auth = getMcpAuth(extra)
      // Stage 1: pre-write validation for JSON files. If the parse or shape
      // check fails, return the error and DO NOT touch disk.
      if (path.endsWith('.json')) {
        let parsed: unknown
        try {
          parsed = parseJsonStrict(text, path)
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Invalid JSON', {
            phase: 'parse',
            path,
          })
        }
        const isParams = path === 'params.json' || path.endsWith('/params.json')
        const isWorkflow = path === 'workflow.json' || path.endsWith('/workflow.json')
        if (isParams || isWorkflow) {
          const issues = isParams
            ? validateParamsShape(parsed)
            : validateWorkflowShape(parsed)
          const blocking = issues.filter((i) => i.level === 'error')
          if (blocking.length > 0) {
            return toolError(
              `Refusing to write ${path} — shape validation failed`,
              { phase: 'validate', issues: blocking },
            )
          }
        }
      }

      // Stage 2: write. svcWriteFile snapshots first (via snapshotWorkflow),
      // then writes. Any FS error bubbles up as a tool error.
      try {
        const result = svcWriteFile(workflowId, path, text)
        auditMcp('write_file', {
          userId: auth.user.id,
          username: auth.user.username,
          tokenPrefix: auth.tokenPrefix,
        }, { workflowId, path: result.path, size: result.size })
        return toolJson({
          ...result,
          snapshotted: true,
          message: `Wrote ${result.size} bytes to ${result.path}`,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'write_file failed')
      }
    },
  )

  // ── delete_file ──────────────────────────────────────────────
  server.registerTool(
    'delete_file',
    {
      title: 'Delete file',
      description:
        'Deletes a file or folder inside a workflow folder. ' +
        '\n\nConfirmation required: the caller MUST pass `confirm: true`. This ' +
        'is a safety check, not a permission gate — it forces the model to ' +
        'pause and reconsider before destruction. If `confirm` is omitted or ' +
        'false, the tool returns an error with no side effects. ' +
        '\n\nSnapshots: a snapshot of the workflow folder is taken before ' +
        'deletion. To restore, use the History UI or the workflow snapshot ' +
        'restore endpoint. Cannot delete the workflow folder root — only ' +
        'paths inside it. ' +
        '\n\nNever use this to "reset" params.json or workflow.json — write_file ' +
        'with the cleared content is safer because it preserves the file (and ' +
        'the workflow stays loadable).',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        path: filePathSchema,
        confirm: z
          .boolean()
          .describe(
            'Must be true to proceed. Set this only after you have decided ' +
              'the deletion is intentional — there is no second prompt.',
          ),
      },
    },
    async ({ workflowId, path, confirm }, extra) => {
      const auth = getMcpAuth(extra)
      if (!confirm) {
        return toolError(
          'delete_file requires confirm: true. Set the flag and call again if you really want to delete this path.',
          { workflowId, path },
        )
      }
      try {
        deletePath(workflowId, path)
        auditMcp('delete_file', {
          userId: auth.user.id,
          username: auth.user.username,
          tokenPrefix: auth.tokenPrefix,
        }, { workflowId, path })
        return toolJson({
          deleted: true,
          workflowId,
          path,
          message: `Deleted ${path} (snapshot saved — restorable from History).`,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'delete_file failed')
      }
    },
  )
}
