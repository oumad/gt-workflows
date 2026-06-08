/**
 * MCP (Model Context Protocol) endpoint — entry point for AI clients
 * (Claude Desktop, Claude Code, etc.) that drive coffee-maker via tool calls.
 *
 * V2 of this file: tools land here. The Web-Standard Streamable HTTP
 * transport from @modelcontextprotocol/sdk handles JSON-RPC framing; our
 * job is to authenticate the bearer token, build the auth context blob,
 * hand the Hono Request to the transport, and return the Response it
 * produces verbatim.
 *
 * Auth context: the resolved AuthUser + the token id/prefix are pushed
 * through `HandleRequestOptions.authInfo.extra` so individual tool handlers
 * can attribute writes back to a real user without re-validating the bearer.
 *
 * Bearer resolution: personalTokenAuth (middleware/auth.ts) sets `c.var.user`
 * for us, but it does NOT expose the resolved personal_tokens row. We need
 * the token id/prefix for audit-log attribution, so we re-resolve the
 * bearer here. That's a second DB hit per MCP request — fine for V1, can be
 * optimised by stashing the resolved token on the Hono context if it ever
 * shows up in profiles.
 */
import { Hono } from 'hono'
import { personalTokenAuth } from '../middleware/auth.js'
import { resolveBearerToken } from '../services/personalTokens.js'
import { buildRequestServer } from '../mcp/server.js'
import { TOOL_NAMES } from '../mcp/tools/index.js'
import { buildAuthInfo } from '../mcp/auth-ctx.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

app.use('*', personalTokenAuth)

// ── GET /api/mcp/whoami ──────────────────────────────────
// Smoke test for a freshly-pasted token. Returns the resolved user + the
// list of tools registered on the server. No protocol framing — plain JSON.
app.get('/whoami', (c) => {
  const me = c.var.user
  return c.json({
    user: {
      id: me.id,
      username: me.username,
      role: me.role,
      isAdmin: me.isAdmin,
    },
    via: 'personal-token',
    tools: TOOL_NAMES,
    protocol: { version: '2025-03-26', transport: 'streamable-http', mode: 'stateless-json' },
  })
})

// ── ALL /api/mcp — Streamable HTTP transport ─────────────
// Matches the protocol's POST (client → server) and GET (server → client for
// SSE streams; in JSON-response mode this is rarely used but the SDK accepts
// it). DELETE is for explicit session termination — not used in stateless mode
// but we still hand it to the transport to get a correct protocol-level
// response.
app.all('/', async (c) => {
  // Re-resolve the bearer to fish out the token row id + prefix. The token
  // itself was already validated by personalTokenAuth; this is just to get
  // the row metadata for the audit blob.
  const authHeader = c.req.header('Authorization') ?? ''
  const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const resolved = await resolveBearerToken(rawToken)
  // personalTokenAuth would have already 401'd if this failed; the only way
  // we get here without `resolved` is a tiny race against a token revoke
  // happening between middleware and handler. Treat that the same as 401.
  if (!resolved) {
    return c.json({ error: 'Personal token no longer valid' }, 401)
  }

  const authInfo = buildAuthInfo({
    user: c.var.user,
    tokenId: resolved.token.id,
    tokenPrefix: resolved.token.prefix,
  })

  // Fresh server+transport per request — SDK's stateless transport explicitly
  // refuses to handle a second request on the same instance. server and
  // transport are GC'd once the response is flushed.
  const { transport } = await buildRequestServer()
  // The transport returns a Web-standard Response — pass it back as-is so
  // headers (content-type, mcp-session-id, etc.) reach the client untouched.
  return transport.handleRequest(c.req.raw, { authInfo })
})

export default app
