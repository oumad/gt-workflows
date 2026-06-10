/**
 * Imagine integration tools. Manages the `imagine` block on params.json
 * (top-level sibling to `comfyui_config` and `powerflowConfig`) and the
 * sibling `SKILL.md` file that documents the workflow for the Imagine app.
 *
 * The imagine block carries a single pointer — `mainMediaNode` — that
 * tells Imagine which node + input field carries the workflow's primary
 * media (image, video, or 3D asset). SKILL.md's YAML frontmatter mirrors
 * the same media type plus the workflow's slug name, so Imagine can sanity-
 * check before submitting jobs.
 *
 *   params.json                          SKILL.md (frontmatter)
 *   {                                    ---
 *     "imagine": {                       name: image-edit-qwen
 *       "mainMediaNode": {               mediaType: image
 *         "id": "78",                    ---
 *         "fieldName": "image",
 *         "type": "image"                # Body...
 *       }
 *     }
 *   }
 *
 * The two have to agree. `validate_imagine` is the cross-check tool that
 * surfaces drift; `write_skill_md` refuses to persist a SKILL.md whose
 * frontmatter contradicts params.json so drift can't be introduced through
 * MCP in the first place.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { applyParamsPatch, ParamsValidationError } from '../params-patch.js'
import { resolveFolder, readParams } from '../../services/workflows.js'
import { writeFile as svcWriteFile } from '../../services/workflowFiles.js'
import {
  readSkillMdAt,
  buildSkillMdText,
  SKILL_MD_FILENAME,
  type Frontmatter,
} from '../skill-md.js'
import {
  toolJson,
  toolError,
  readWorkflowJsonForId,
  type ValidationIssue,
} from '../tool-helpers.js'
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

const mediaTypeSchema = z
  .enum(['image', 'video', '3d'])
  .describe(
    'The kind of media the workflow primarily produces / accepts. Must be ' +
      'one of: "image", "video", "3d". Must match SKILL.md frontmatter\'s ' +
      'mediaType for the workflow to be valid in Imagine.',
  )

const mainMediaNodeSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        'The ComfyUI node id (key in workflow.json) carrying the main media ' +
          'input/output. Verify it exists via read_workflow first.',
      ),
    fieldName: z
      .string()
      .min(1)
      .describe(
        'The input field on that node that holds the media (the key under ' +
          'the node\'s `inputs`). Example: "image" on a LoadImage node.',
      ),
    type: mediaTypeSchema,
  })
  .strict()

/* ─── Helpers ──────────────────────────────────────────────────── */

type ImagineCfg = { mainMediaNode?: { id: string; fieldName: string; type: string } }

function readImagineCfg(folderAbs: string): ImagineCfg {
  const params = readParams(folderAbs) as { imagine?: ImagineCfg }
  return params.imagine ?? {}
}

// (workflow.json reading is centralised in tool-helpers.readWorkflowJsonForId)

/* ─── Cross-checks shared between validate_imagine + write_skill_md ── */

/** Validate a frontmatter object against the workflow's expected name +
 *  imagine.mainMediaNode.type. Returns a list of issues (empty = OK).
 *  Used both by validate_imagine (read-only diagnostic) and write_skill_md
 *  (refuses to persist a SKILL.md that fails these checks). */
function validateFrontmatterAgainst(
  workflowSlug: string,
  imagine: ImagineCfg,
  frontmatter: Frontmatter | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!frontmatter) {
    issues.push({
      level: 'error',
      path: 'SKILL.md',
      message:
        'SKILL.md has no YAML frontmatter — add `---\\nname: ...\\nmediaType: ...\\n---` at the top.',
    })
    return issues
  }
  // name must equal the folder slug (== workflow id).
  if (typeof frontmatter.name !== 'string' || frontmatter.name !== workflowSlug) {
    issues.push({
      level: 'error',
      path: 'SKILL.md.frontmatter.name',
      message: `frontmatter.name must equal the workflow folder slug "${workflowSlug}", got ${JSON.stringify(frontmatter.name ?? null)}`,
    })
  }
  // mediaType (if imagine is configured) must match mainMediaNode.type.
  const expectedType = imagine.mainMediaNode?.type
  if (expectedType) {
    const fmType = frontmatter.mediaType
    if (typeof fmType !== 'string' || fmType.toLowerCase() !== expectedType.toLowerCase()) {
      issues.push({
        level: 'error',
        path: 'SKILL.md.frontmatter.mediaType',
        message: `frontmatter.mediaType must equal params.imagine.mainMediaNode.type ("${expectedType}"), got ${JSON.stringify(fmType ?? null)}`,
      })
    }
  } else if (frontmatter.mediaType != null) {
    issues.push({
      level: 'warning',
      path: 'SKILL.md.frontmatter.mediaType',
      message:
        'frontmatter.mediaType is set but params.imagine.mainMediaNode is not — Imagine will ' +
        'have no anchor to match against. Either run set_imagine_config to point at the media ' +
        'node, or remove mediaType from the frontmatter.',
    })
  }
  return issues
}

/* ─── Tool registrations ──────────────────────────────────────── */

export function registerImagineTools(server: McpServer): void {
  // ── set_imagine_config ───────────────────────────────────────
  server.registerTool(
    'set_imagine_config',
    {
      title: 'Set imagine config',
      description:
        'Sets/updates `params.imagine.mainMediaNode` — the single anchor ' +
        'that tells the Imagine app which ComfyUI node + input carries the ' +
        "workflow's primary media (image / video / 3d). " +
        '\n\nProduces:\n```\nimagine: {\n  mainMediaNode: { id, fieldName, type }\n}\n```\n\n' +
        'Always REPLACES mainMediaNode entirely — pass all three keys ' +
        '(id, fieldName, type). To clear the imagine block, use ' +
        'remove_imagine_config. ' +
        '\n\nDoes NOT verify the node/field actually exists in workflow.json ' +
        "— that's what validate_imagine is for. After setting, run " +
        'validate_imagine to confirm everything cross-references correctly. ' +
        'If SKILL.md exists and has a mediaType, also remember to update ' +
        'it via write_skill_md so the two agree.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        mainMediaNode: mainMediaNodeSchema,
      },
    },
    async ({ workflowId, mainMediaNode }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          const imagine = { ...((params.imagine ?? {}) as Record<string, unknown>) }
          imagine.mainMediaNode = mainMediaNode
          return { ...params, imagine }
        })
        auditMcp(
          'set_imagine_config',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, mainMediaNode },
        )
        return toolJson({
          workflowId,
          mainMediaNode,
          changes: result.changes,
          snapshotted: true,
          nextStep:
            'Run validate_imagine to confirm the node+field exist in workflow.json and SKILL.md agrees.',
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'set_imagine_config failed')
      }
    },
  )

  // ── remove_imagine_config ────────────────────────────────────
  server.registerTool(
    'remove_imagine_config',
    {
      title: 'Remove imagine block',
      description:
        'Removes the entire `imagine` block from params.json — including ' +
        'mainMediaNode and any other future imagine-related keys. ' +
        'Idempotent: a no-op if `imagine` is already absent. ' +
        "\n\nDoes NOT touch SKILL.md. After removal, SKILL.md's mediaType " +
        '(if any) is no longer anchored — consider clearing it via ' +
        'write_skill_md or leaving it for documentation.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: { workflowId: workflowIdSchema },
    },
    async ({ workflowId }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const result = applyParamsPatch(workflowId, (params) => {
          if (!('imagine' in params)) return params
          // Object-spread + property delete via Object.fromEntries to keep
          // the patch immutable (no mutation of the cloned draft).
          return Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'imagine'))
        })
        auditMcp(
          'remove_imagine_config',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, changed: result.changes.length > 0 },
        )
        return toolJson({
          workflowId,
          removed: result.changes.length > 0,
          changes: result.changes,
          snapshotted: true,
        })
      } catch (err) {
        if (err instanceof ParamsValidationError) {
          return toolError('Refused write — params validation failed', { issues: err.issues })
        }
        return toolError(err instanceof Error ? err.message : 'remove_imagine_config failed')
      }
    },
  )

  // ── read_skill_md ────────────────────────────────────────────
  server.registerTool(
    'read_skill_md',
    {
      title: 'Read SKILL.md',
      description:
        "Reads `SKILL.md` from the workflow's folder root. Returns " +
        '{ exists, raw, frontmatter, body, warnings, modifiedAt }. ' +
        '\n\nfrontmatter is the parsed YAML object from between the leading ' +
        '`---` delimiters (or null if no frontmatter block exists). body is ' +
        'the markdown body after the closing `---`. warnings flags ' +
        'indented/list-style frontmatter lines this minimal parser skipped — ' +
        'expect them empty for well-formed files. ' +
        "\n\nIf the file doesn't exist, returns `{ exists: false }` with " +
        'empty raw/body — never errors on missing file (write_skill_md ' +
        'creates it).',
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
        const { folderAbs } = resolveFolder(workflowId)
        return toolJson(readSkillMdAt(folderAbs))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'read_skill_md failed')
      }
    },
  )

  // ── write_skill_md ───────────────────────────────────────────
  server.registerTool(
    'write_skill_md',
    {
      title: 'Write SKILL.md',
      description:
        "Writes/updates the workflow's SKILL.md. Re-serialises the " +
        'provided frontmatter into the `---` block at the top, followed by ' +
        'the markdown body. ' +
        '\n\nValidation BEFORE write — refuses to persist if any check ' +
        'fails:\n' +
        '  • `frontmatter.name` MUST equal the workflow folder slug (== the ' +
        'workflow id). The slug is what other tools refer to the workflow ' +
        'as; SKILL.md must say the same.\n' +
        '  • If `params.imagine.mainMediaNode.type` is set, ' +
        '`frontmatter.mediaType` MUST equal it (case-insensitive). This ' +
        'enforces the params↔SKILL.md cross-reference at write time so the ' +
        'two never drift.\n' +
        '  • If imagine is NOT configured but frontmatter sets mediaType, ' +
        'a warning is returned (not a hard reject — useful for documenting ' +
        'a workflow before the imagine pointer is wired up).\n\n' +
        'On success the file is snapshotted (see workflow History) and the ' +
        'new contents are returned. Frontmatter values support strings, ' +
        'numbers, booleans, null — no lists or nested objects (the minimal ' +
        'YAML serialiser would lose them).',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        workflowId: workflowIdSchema,
        frontmatter: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .describe(
            'YAML frontmatter as a flat key/value object. Required keys: ' +
              '`name` (must equal the workflow slug), and `mediaType` if ' +
              'params.imagine.mainMediaNode.type is set. Example: ' +
              '{ "name": "image-edit-qwen", "mediaType": "image", ' +
              '"description": "Edits an image with a Qwen-VL prompt" }.',
          ),
        body: z
          .string()
          .describe(
            'Markdown body — everything after the closing `---`. Empty ' +
              'string is allowed but discouraged; write a short description ' +
              'so the workflow is self-documenting.',
          ),
      },
    },
    async ({ workflowId, frontmatter, body }, extra) => {
      const auth = getMcpAuth(extra)
      try {
        const { folderAbs } = resolveFolder(workflowId)
        const imagine = readImagineCfg(folderAbs)
        const issues = validateFrontmatterAgainst(workflowId, imagine, frontmatter)
        const blocking = issues.filter((i) => i.level === 'error')
        if (blocking.length > 0) {
          return toolError(
            `Refused to write ${SKILL_MD_FILENAME} — frontmatter validation failed`,
            { issues: blocking },
          )
        }
        const text = buildSkillMdText(frontmatter, body)
        const result = svcWriteFile(workflowId, SKILL_MD_FILENAME, text)
        auditMcp(
          'write_skill_md',
          { userId: auth.user.id, username: auth.user.username, tokenPrefix: auth.tokenPrefix },
          { workflowId, size: result.size, warnings: issues.length },
        )
        return toolJson({
          workflowId,
          ...result,
          warnings: issues.filter((i) => i.level === 'warning'),
          snapshotted: true,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'write_skill_md failed')
      }
    },
  )

  // ── validate_imagine ─────────────────────────────────────────
  server.registerTool(
    'validate_imagine',
    {
      title: 'Validate imagine config',
      description:
        'Cross-checks params.json, workflow.json and SKILL.md for a workflow ' +
        'to confirm the Imagine integration is complete and consistent. ' +
        'Returns { valid, checks[], issues[] } — `checks[]` enumerates every ' +
        'verification (pass/fail), `issues[]` lists only the failures. ' +
        '\n\nChecks performed:\n' +
        '  • `params.imagine.mainMediaNode` is set with id/fieldName/type.\n' +
        '  • The referenced node id exists in workflow.json.\n' +
        "  • The referenced fieldName exists on that node's `inputs`.\n" +
        '  • SKILL.md exists in the workflow folder.\n' +
        '  • SKILL.md has YAML frontmatter.\n' +
        '  • SKILL.md frontmatter.name == workflow slug.\n' +
        '  • SKILL.md frontmatter.mediaType (case-insensitive) == ' +
        'mainMediaNode.type.\n\n' +
        'No side effects — purely diagnostic. Use after set_imagine_config ' +
        'and write_skill_md to confirm everything ties up. Surface the ' +
        "`issues[]` to the user verbatim — they're written for human reading.",
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
        const { folderAbs } = resolveFolder(workflowId)
        const params = readParams(folderAbs) as { imagine?: ImagineCfg }
        const imagine = params.imagine ?? {}
        const wf = readWorkflowJsonForId(workflowId)
        const skill = readSkillMdAt(folderAbs)

        const checks: { id: string; label: string; ok: boolean; detail?: string }[] = []
        const issues: ValidationIssue[] = []

        // 1. imagine.mainMediaNode exists + structurally valid
        const mn = imagine.mainMediaNode
        const hasImagine = !!mn
        checks.push({
          id: 'has_imagine',
          label: 'params.imagine.mainMediaNode is set',
          ok: hasImagine,
        })
        if (!hasImagine) {
          issues.push({
            level: 'error',
            path: 'params.imagine.mainMediaNode',
            message:
              'Imagine block is not configured. Run set_imagine_config to point at ' +
              "the workflow's primary media node.",
          })
        }

        // The remaining checks all depend on mainMediaNode existing — short-
        // circuit cleanly so the AI sees one root-cause failure rather than
        // a cascade of "X is missing because Y wasn't set".
        if (mn) {
          const idOk = typeof mn.id === 'string' && mn.id.length > 0
          const fieldOk = typeof mn.fieldName === 'string' && mn.fieldName.length > 0
          const typeOk =
            typeof mn.type === 'string' && ['image', 'video', '3d'].includes(mn.type.toLowerCase())
          checks.push({
            id: 'mainMediaNode_shape',
            label: 'mainMediaNode has id/fieldName/type',
            ok: idOk && fieldOk && typeOk,
            detail:
              !idOk || !fieldOk || !typeOk
                ? `id=${idOk} fieldName=${fieldOk} type=${typeOk}`
                : undefined,
          })
          if (!(idOk && fieldOk && typeOk)) {
            issues.push({
              level: 'error',
              path: 'params.imagine.mainMediaNode',
              message: 'One or more of {id, fieldName, type} is missing/malformed.',
            })
          }

          // 2. workflow.json reachable + node exists + field exists
          const wfReachable = !!wf
          checks.push({
            id: 'workflow_readable',
            label: 'workflow.json is readable JSON',
            ok: wfReachable,
          })
          if (!wfReachable) {
            issues.push({
              level: 'error',
              path: 'workflow.json',
              message:
                "workflow.json is missing or unreadable. The Imagine reference can't be resolved.",
            })
          } else if (idOk) {
            const node = wf[mn.id] as { inputs?: Record<string, unknown> } | undefined
            const nodeExists = !!node
            checks.push({
              id: 'node_exists',
              label: `workflow.json contains node "${mn.id}"`,
              ok: nodeExists,
            })
            if (!nodeExists) {
              issues.push({
                level: 'error',
                path: 'params.imagine.mainMediaNode.id',
                message: `Node "${mn.id}" doesn't exist in workflow.json. Run read_workflow to see valid node ids.`,
              })
            } else if (fieldOk) {
              const inputs = node.inputs
              const fieldExists =
                inputs != null && typeof inputs === 'object' && mn.fieldName in inputs
              checks.push({
                id: 'field_exists',
                label: `Node "${mn.id}" has input "${mn.fieldName}"`,
                ok: fieldExists,
              })
              if (!fieldExists) {
                issues.push({
                  level: 'error',
                  path: 'params.imagine.mainMediaNode.fieldName',
                  message: `Field "${mn.fieldName}" is not an input on node ${mn.id}. Valid inputs: ${inputs ? Object.keys(inputs).join(', ') : '(none)'}`,
                })
              }
            }
          }
        }

        // 3. SKILL.md presence + frontmatter cross-checks
        checks.push({
          id: 'skill_md_exists',
          label: `${SKILL_MD_FILENAME} exists`,
          ok: skill.exists,
        })
        if (!skill.exists) {
          issues.push({
            level: 'error',
            path: SKILL_MD_FILENAME,
            message: `${SKILL_MD_FILENAME} is missing. Run write_skill_md to create it.`,
          })
        } else {
          const fmIssues = validateFrontmatterAgainst(workflowId, imagine, skill.frontmatter)
          const nameOk = !fmIssues.some((i) => i.path.endsWith('.name') && i.level === 'error')
          const typeOk = !fmIssues.some((i) => i.path.endsWith('.mediaType') && i.level === 'error')
          checks.push({
            id: 'skill_name_matches',
            label: `${SKILL_MD_FILENAME} frontmatter.name == "${workflowId}"`,
            ok: nameOk,
          })
          checks.push({
            id: 'skill_mediaType_matches',
            label: imagine.mainMediaNode
              ? `${SKILL_MD_FILENAME} frontmatter.mediaType == "${imagine.mainMediaNode.type}"`
              : `${SKILL_MD_FILENAME} frontmatter.mediaType absent (imagine not configured)`,
            ok: typeOk,
          })
          issues.push(...fmIssues)
        }

        const errors = issues.filter((i) => i.level === 'error')
        return toolJson({
          workflowId,
          valid: errors.length === 0,
          checks,
          issues,
        })
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'validate_imagine failed')
      }
    },
  )
}
