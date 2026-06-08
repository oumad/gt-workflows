/**
 * MCP auth context — the bridge between Hono middleware and SDK tool handlers.
 *
 * The MCP SDK passes per-request auth info to tool handlers via
 * `extra.authInfo`. We stash our resolved AuthUser + token metadata under
 * `authInfo.extra` so every tool can reach the caller's user/role/token
 * without re-running the bearer-token lookup.
 *
 * Read at the boundary of every tool handler — if it's missing/malformed,
 * something is wrong with the route plumbing and the tool should throw rather
 * than silently fall through.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { AuthUser } from '../types.js'

export type McpAuthExtra = {
  user: AuthUser
  /** The personal_tokens.id used to authenticate this MCP call. Persisted in
   *  audit log rows so a leaked token's actions remain traceable even after
   *  it's revoked. */
  tokenId: string
  /** First N chars of the token, for human-readable audit display. */
  tokenPrefix: string
}

/** Build the AuthInfo blob passed via `transport.handleRequest({ authInfo })`.
 *  The `token` / `clientId` / `scopes` fields are required by the AuthInfo
 *  interface; we fill them sensibly but the meaningful data lives in `extra`. */
export function buildAuthInfo(ctx: McpAuthExtra): AuthInfo {
  return {
    // We don't pass the raw bearer here — the personal token has already
    // been resolved and verified by personalTokenAuth at the HTTP layer.
    // This string is purely informational; the SDK doesn't re-validate it.
    token: ctx.tokenPrefix,
    clientId: ctx.user.username,
    scopes: ctx.user.roles,
    extra: ctx as unknown as Record<string, unknown>,
  }
}

/** Extract our app's auth context from a tool's `extra` parameter. Throws if
 *  it isn't there — the McpServer should never invoke a tool without authInfo,
 *  so a missing context is a bug in the transport wiring. */
export function getMcpAuth(extra: { authInfo?: AuthInfo }): McpAuthExtra {
  const blob = extra.authInfo?.extra as McpAuthExtra | undefined
  if (!blob || !blob.user || !blob.tokenId) {
    throw new Error('MCP tool invoked without auth context — transport wiring bug')
  }
  return blob
}
