import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { sql, eq } from 'drizzle-orm'

import { config } from './config/index.js'
import api from './routes/index.js'
import { sync } from './services/sync.js'
import { initWorkflowsGit } from './services/git.js'
import { db, users, servers } from './db/index.js'
import { applyMigrations } from './db/migrate.js'
import { setupGlobalProxy } from './lib/proxy.js'
import { requestLog } from './lib/requestLog.js'
import { hashPassword } from './lib/password.js'

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
const app = new Hono()

app.use('*', requestLog())
app.use('*', secureHeaders())
// CORS_ORIGIN may be a single origin, a comma-separated list, or '*'. Hono's
// `cors` treats a bare non-'*' string as ONE exact origin, so a comma list
// matched nothing — split it into an array. '*' stays a string (array form
// can't express wildcard).
const corsOrigin: string | string[] = config.isDev
  ? '*'
  : config.CORS_ORIGIN.includes(',')
    ? config.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : config.CORS_ORIGIN
app.use(
  '/api/*',
  cors({
    origin: corsOrigin,
    credentials: !config.isDev,
  }),
)
// Body-limit: tight 1 MB cap on JSON-shaped routes (everything that isn't an
// explicit upload endpoint), with a wider 50 MB cap on the handful of
// multipart upload routes (workflow file upload, workflow import, icon
// upload). Two-tier gate keeps the blast radius of a misbehaving client
// small while letting legitimate uploads through. If you add a new upload
// endpoint, list it in UPLOAD_ROUTE_RE — the default 1 MB cap will 413 it
// otherwise.
const UPLOAD_ROUTE_RE =
  /^\/api\/workflows\/[^/]+\/(fs\/upload|import\/(analyze|apply))$|^\/api\/workflows\/import\/(analyze|create)$/
const DEFAULT_BODY_LIMIT = 1 * 1024 * 1024
const UPLOAD_BODY_LIMIT = 50 * 1024 * 1024
app.use('/api/*', async (c, next) => {
  const limit = UPLOAD_ROUTE_RE.test(c.req.path) ? UPLOAD_BODY_LIMIT : DEFAULT_BODY_LIMIT
  // hono's bodyLimit generics don't line up with a path-scoped Context — the
  // call is runtime-correct; the mismatch is purely in the type parameters.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return bodyLimit({ maxSize: limit })(c, next)
})

// ── Health check (no auth) ────────────────────
app.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`)
    return c.json({ ok: true, db: 'up', ts: new Date().toISOString() })
  } catch (err) {
    return c.json({ ok: false, db: 'down', error: String(err) }, 503)
  }
})

// ── API routes ────────────────────────────────
app.route('/api', api)

// ── 404 fallback ──────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// ── Error handler ─────────────────────────────
app.onError((err, c) => {
  console.error('[error]', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// ─────────────────────────────────────────────
// DB readiness probe — retries until Postgres is reachable
// ─────────────────────────────────────────────
async function waitForDb(maxAttempts = 15, delayMs = 2_000): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await db.execute(sql`SELECT 1`)
      console.log('[startup] DB ready')
      return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[startup] DB not ready (${i}/${maxAttempts}): ${msg}`)
      if (i < maxAttempts) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error('[startup] Could not connect to DB after multiple attempts — aborting')
}

// ─────────────────────────────────────────────
// Seed default admin user if none exists
// ─────────────────────────────────────────────
async function seedDefaultAdmin() {
  try {
    const existing = await db.query.users.findFirst({ where: eq(users.username, 'admin') })
    if (!existing) {
      const hash = await hashPassword('admin')
      await db.insert(users).values({
        username: 'admin',
        isAdmin: true,
        roles: [],
        passwordHash: hash,
      })
      console.log(
        '[seed] Created default admin user (username: admin, password: admin) — change this immediately',
      )
    }
  } catch (err) {
    console.warn('[seed] Could not seed admin user:', err)
  }
}

// ─────────────────────────────────────────────
// Seed the docker-compose test-server as a monitored server (alert testing).
// Gated on SEED_TEST_SERVER=true so it only runs in the dev/compose setup.
// Idempotent: skips if a server with this URL already exists.
// ─────────────────────────────────────────────
async function seedTestServer() {
  if (!config.SEED_TEST_SERVER) return
  const url = 'http://test-server'
  try {
    const existing = await db.query.servers.findFirst({ where: eq(servers.url, url) })
    if (!existing) {
      await db.insert(servers).values({
        id: 'test-server',
        name: 'Test Server',
        url,
        type: 'lora', // ping-only probe — no /system_stats check
        tags: ['test'],
      })
      console.log(
        '[seed] Created test server (http://test-server) — stop/start the test-server container to fire alerts',
      )
    }
  } catch (err) {
    console.warn('[seed] Could not seed test server:', err)
  }
}

// ─────────────────────────────────────────────
// Start — DB must be reachable before we accept requests
// ─────────────────────────────────────────────

// 0. Configure outbound HTTP proxy (must be first, before any fetch calls)
setupGlobalProxy()

// 1. Block until DB is up (handles Docker network timing)
await waitForDb()

// 2. Apply any pending Drizzle migrations (idempotent — no-op when up to date).
//    Replaces the previous drizzle-kit push approach; see src/db/migrate.ts
//    for the rationale and the new authoring workflow.
await applyMigrations()

// 3. Seed initial data
await seedDefaultAdmin()
await seedTestServer()

// 4. Start the HTTP server — DB is proven reachable.
// HOST defaults to '0.0.0.0' (every IPv4 interface, IPv4 only): accepts
// 127.0.0.1 from native clients AND the Vite proxy. Without an explicit
// hostname, @hono/node-server defaults to IPv6 only on Windows, which makes
// 127.0.0.1 connections (curl, Vite proxy with default Node DNS) fail with
// ECONNREFUSED / EADDRINUSE. Override via HOST in the env if ever needed.
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(
    `[coffee-maker-api] listening on http://127.0.0.1:${info.port} (bound ${info.address}:${info.port})`,
  )
})

// Keep-alive tuning. The frontend proxy (vite dev/preview) holds pooled
// sockets to us; Node's default keepAliveTimeout of 5s races clients that
// fire a request exactly as the server closes an idle socket (spurious
// ECONNRESET → 502 through the proxy). 65s makes idle closes rare for a UI
// that polls every few seconds; headersTimeout must stay above it.
const httpServer = server as import('node:http').Server
httpServer.keepAliveTimeout = 65_000
httpServer.headersTimeout = 66_000

// 5. Start continuous Redis → Postgres sync
sync.start()

// 6. Init the git-workflows feature: ensure stable/unique workflow ids + install
//    the repo's hooks + filter (idempotent; no-op when the feature is off or
//    WORKFLOWS_DIR isn't the workflows repo).
void initWorkflowsGit()

// Graceful shutdown — wait for the HTTP server to drain before exiting so
// in-flight requests aren't dropped on SIGTERM (B02).
const shutdown = async () => {
  console.log('[coffee-maker-api] shutting down…')
  sync.stop()
  // server.close() waits for in-flight requests, but a long-lived SSE stream
  // can hold it open indefinitely — force-exit before docker's 10s SIGKILL
  // (and so a native Ctrl+C never hangs).
  const force = setTimeout(() => process.exit(0), 8_000)
  force.unref()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  process.exit(0)
}
process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})

// Last-resort crash guards. Without these, a throw or rejection that escapes
// Hono's request scope (a stray timer callback, a background fetch in the
// health monitor, a fire-and-forget snapshot) takes the whole process down
// with NO log — and because the api is reached over keep-alive sockets, every
// open connection is RST at once (the cross-endpoint ECONNRESET burst). We log
// with a full stack and keep serving rather than exit: a single background
// rejection should not bounce the container and drop every client. If a fault
// proves genuinely unrecoverable, prefer fixing the source over exiting here.
process.on('uncaughtException', (err) => {
  console.error('[fatal:uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[fatal:unhandledRejection]', reason)
})

export default app
