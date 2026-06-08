/**
 * Read-only MCP tool catalog — JWT-auth so the Preferences page can render
 * the tools list without needing to first mint a personal token.
 *
 * Lives at /api/mcp-catalog (NOT under /api/mcp) because /api/mcp is gated
 * behind personalTokenAuth — we don't want to relax that gate just to serve
 * a docs payload. Two endpoints, two auth modes, clean separation.
 */
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { buildRequestServer } from '../mcp/server.js'
import { buildToolCatalog, TOOL_SECTIONS } from '../mcp/tools/index.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ── GET /api/mcp-catalog ─────────────────────────────────
// Returns the full tool catalog for the in-app documentation card.
// Cached lightly via the SDK — each call builds a fresh McpServer (cheap)
// and walks its registered tools.
app.get('/', requireAuth, async (c) => {
  const { server } = await buildRequestServer()
  const tools = buildToolCatalog(server)
  // Build section summary for the UI (counts, ordered list).
  const sectionMap = new Map<string, number>()
  for (const t of tools) sectionMap.set(t.section, (sectionMap.get(t.section) ?? 0) + 1)
  const sections = Array.from(sectionMap.entries()).map(([name, count]) => ({ name, count }))
  return c.json({
    total: tools.length,
    sections,
    tools,
    knownSections: Array.from(new Set(Object.values(TOOL_SECTIONS))).sort(),
  })
})

export default app
