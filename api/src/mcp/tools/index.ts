/**
 * Tool registration entry point. Every new tool group adds one line here.
 *
 * Why a single registrar instead of importing tools individually in the
 * server file: keeps server.ts thin (it just constructs the McpServer and
 * calls `registerAllTools`), and gives us one obvious place to enumerate
 * which tools the server exposes — useful for /api/mcp/whoami to advertise
 * the tool list back to the client.
 */
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerWorkflowTools } from './workflows.js'
import { registerFileTools } from './files.js'
import { registerNodeConfigTools } from './node-config.js'
import { registerPowerflowTools } from './powerflow.js'
import { registerImagineTools } from './imagine.js'
import { registerValidationTools } from './validation.js'
import { registerWorkflowMetadataTools } from './workflow-metadata.js'

export function registerAllTools(server: McpServer): void {
  registerWorkflowTools(server)
  registerFileTools(server)
  registerNodeConfigTools(server)
  registerPowerflowTools(server)
  registerImagineTools(server)
  registerValidationTools(server)
  registerWorkflowMetadataTools(server)
}

/** Static list of registered tool names — kept in sync with the registrars
 *  above. Surfaced through GET /api/mcp/whoami so the frontend can preview
 *  what the AI client will be able to do once it connects. */
export const TOOL_NAMES = [
  // workflows.ts (read-only)
  'list_workflows',
  'read_params',
  'read_workflow',
  'get_node_info',
  'get_field_config',
  'diff_params',
  'list_files',
  // files.ts (read + write)
  'read_file',
  'write_file',
  'delete_file',
  // node-config.ts (write — read-patch-validate-write, snapshots on every write)
  'set_node_parser',
  'set_node_visibility',
  'set_node_condition',
  'set_field_condition',
  'set_subgraph',
  'set_placeholders',
  // powerflow.ts (write — params.powerflowConfig top-level)
  'set_powerflow_flags',
  'add_pf_connection',
  'remove_pf_connection',
  'set_pf_field',
  // imagine.ts (write — params.imagine + SKILL.md cross-check)
  'set_imagine_config',
  'remove_imagine_config',
  'read_skill_md',
  'write_skill_md',
  'validate_imagine',
  // validation.ts (output comparator + deep validator + snapshot history)
  'set_output_comparator',
  'validate_params',
  'list_snapshots',
  'snapshot_restore',
  // workflow-metadata.ts (top-level params.json metadata)
  'set_workflow_metadata',
  'set_workflow_tags',
  'set_workflow_servers',
  'set_icon_badge',
] as const

/** Human-readable section per tool — drives grouping in the Preferences UI's
 *  MCP tools catalog card. Keep in sync with TOOL_NAMES. */
export const TOOL_SECTIONS: Record<string, string> = {
  // Workflows (read-only)
  list_workflows: 'Workflows',
  read_params: 'Workflows',
  read_workflow: 'Workflows',
  get_node_info: 'Workflows',
  get_field_config: 'Workflows',
  diff_params: 'Workflows',
  list_files: 'Workflows',
  // Files
  read_file: 'Files',
  write_file: 'Files',
  delete_file: 'Files',
  // Node config
  set_node_parser: 'Node config',
  set_node_visibility: 'Node config',
  set_node_condition: 'Node config',
  set_field_condition: 'Node config',
  set_subgraph: 'Node config',
  set_placeholders: 'Node config',
  // Powerflow
  set_powerflow_flags: 'Powerflow',
  add_pf_connection: 'Powerflow',
  remove_pf_connection: 'Powerflow',
  set_pf_field: 'Powerflow',
  // Imagine
  set_imagine_config: 'Imagine',
  remove_imagine_config: 'Imagine',
  read_skill_md: 'Imagine',
  write_skill_md: 'Imagine',
  validate_imagine: 'Imagine',
  // Validation & history
  set_output_comparator: 'Validation & history',
  validate_params: 'Validation & history',
  list_snapshots: 'Validation & history',
  snapshot_restore: 'Validation & history',
  // Workflow metadata
  set_workflow_metadata: 'Workflow metadata',
  set_workflow_tags: 'Workflow metadata',
  set_workflow_servers: 'Workflow metadata',
  set_icon_badge: 'Workflow metadata',
}

export type ToolCatalogEntry = {
  name: string
  section: string
  title: string
  description: string
  readOnly: boolean
  destructive: boolean
  idempotent: boolean
}

/**
 * Walks `_registeredTools` on a freshly-built MCP server to surface tool
 * metadata (title, description, annotations) for the Preferences-page
 * catalog. Relies on the SDK's internal field name; if the SDK ever
 * renames it, the cast below will fail loudly and we update.
 *
 * Cheap to call — building the server is just registering function refs +
 * Zod schemas. We don't cache the result so a hot-reloaded dev session
 * picks up changes immediately.
 */
export function buildToolCatalog(server: McpServer): ToolCatalogEntry[] {
  const registered = (server as unknown as { _registeredTools?: Record<string, RegisteredTool> })
    ._registeredTools
  if (!registered) return []
  const entries: ToolCatalogEntry[] = []
  for (const [name, t] of Object.entries(registered)) {
    entries.push({
      name,
      section: TOOL_SECTIONS[name] ?? 'Other',
      title: t.title ?? name,
      description: t.description ?? '',
      readOnly: t.annotations?.readOnlyHint === true,
      destructive: t.annotations?.destructiveHint === true,
      idempotent: t.annotations?.idempotentHint === true,
    })
  }
  // Group by section, name-sorted within a section, so the UI gets a stable
  // order without doing its own sort.
  entries.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.name.localeCompare(b.name)
  })
  return entries
}
