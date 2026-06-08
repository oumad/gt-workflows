/**
 * Per-request McpServer + transport builder.
 *
 * IMPORTANT: in stateless mode (`sessionIdGenerator: undefined`) the SDK's
 * WebStandardStreamableHTTPServerTransport throws
 *   "Stateless transport cannot be reused across requests."
 * on the second `handleRequest` call. We therefore construct a fresh
 * McpServer + transport for every MCP request and let the GC collect them
 * once the response is flushed. Tool registration is cheap (function refs +
 * Zod schemas) so the per-request cost is negligible — see registerAllTools.
 *
 * If we ever need session affinity (long-running tool calls, server→client
 * notifications, resource subscriptions), switch the transport to stateful
 * mode (provide a `sessionIdGenerator`) and stash transports per session-id
 * here. The current stateless+JSON design fits every tool we have today —
 * each tool returns synchronously from the AI's perspective.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { registerAllTools } from './tools/index.js'

const SERVER_INFO = {
  name: 'coffee-maker',
  version: '1.0.0',
} as const

export async function buildRequestServer(): Promise<{
  server: McpServer
  transport: WebStandardStreamableHTTPServerTransport
}> {
  const server = new McpServer(SERVER_INFO)
  registerAllTools(server)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // JSON responses, no SSE
  })
  await server.connect(transport)
  return { server, transport }
}

export { SERVER_INFO }
