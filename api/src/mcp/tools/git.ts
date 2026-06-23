/**
 * Git tools for agents — the MCP face of services/git.ts. They go through the
 * exact same code paths as the app's buttons, so they inherit:
 *   - behind-lock / no-auto-merge (update is snapshot+reset+take-theirs),
 *   - validate-on-publish (no literal URLs, valid JSON),
 *   - fast-forward-only push (refused when behind → "update first").
 *
 * Agents are pinned to the work branch: switch_branch refuses anything else,
 * and publish always targets the work branch, so an agent can never push to
 * main/preprod — humans promote through the app.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config } from '../../config/index.js'
import * as git from '../../services/git.js'
import { toolJson, toolError } from '../tool-helpers.js'
import { getMcpAuth } from '../auth-ctx.js'

export function registerGitTools(server: McpServer): void {
  // ── git_status (read) ─────────────────────────────────────────
  server.registerTool(
    'git_status',
    {
      title: 'Git status',
      description:
        'Current git state of the workflow repo: enabled flag, current branch, ' +
        'ahead/behind the work branch (after a cached fetch), dirty file count, ' +
        'switchable branches, and which workflows are locked for editing. Read-only.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {},
    },
    async () => {
      try {
        return toolJson(await git.status())
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'git_status failed')
      }
    },
  )

  // ── update_workflows (pull latest, conflict-free) ─────────────
  server.registerTool(
    'update_workflows',
    {
      title: 'Update workflows',
      description:
        'Pull the latest published workflows onto this environment. Conflict-free ' +
        'and recoverable: your locally-changed workflows are snapshotted to History ' +
        'first, the tree is reset to the latest commit, then your edits to files the ' +
        'remote did not change are restored (take-theirs on overlaps). Never merges. ' +
        'No-op when already up to date. Returns what was snapshotted / restored and ' +
        'any globalEnv keys auto-created.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {},
    },
    async () => {
      try {
        return toolJson(await git.update())
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'update_workflows failed')
      }
    },
  )

  // ── publish_workflows (validate + squash + ff push) ───────────
  server.registerTool(
    'publish_workflows',
    {
      title: 'Publish workflows',
      description:
        'Publish your workflow changes to the shared work branch as one squashed ' +
        'commit (fast-forward-only push). Validates first — rejects literal server ' +
        'URLs (bind them to a globalEnv key) and invalid JSON. REFUSES if this ' +
        'environment is behind: run update_workflows first; it never merges. Always ' +
        'targets the work branch — agents cannot push to main/preprod.',
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: {},
    },
    async (_args, extra) => {
      const auth = getMcpAuth(extra)
      try {
        return toolJson(await git.publish(`${auth.user.username} (MCP)`))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'publish_workflows failed')
      }
    },
  )

  // ── switch_branch (pinned to the work branch) ─────────────────
  server.registerTool(
    'switch_branch',
    {
      title: 'Switch branch',
      description:
        `Switch the checked-out branch. Agents are pinned to the work branch ` +
        `("${config.GIT_WORK_BRANCH}") — switching to ${config.GIT_DEFAULT_BRANCH} or ` +
        `staging is refused (humans promote through the app). Refuses when there are ` +
        `unpublished changes (publish or discard first).`,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        branch: z
          .string()
          .min(1)
          .describe(`Target branch — must be the work branch ("${config.GIT_WORK_BRANCH}").`),
      },
    },
    async ({ branch }) => {
      if (branch !== config.GIT_WORK_BRANCH) {
        return toolError(
          `Agents are pinned to the work branch "${config.GIT_WORK_BRANCH}". ` +
            `Switching to "${branch}" is not allowed via MCP — a human promotes through the app.`,
        )
      }
      try {
        return toolJson(await git.switchBranch(branch))
      } catch (err) {
        return toolError(err instanceof Error ? err.message : 'switch_branch failed')
      }
    },
  )
}
