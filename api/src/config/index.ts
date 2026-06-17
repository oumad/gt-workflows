/**
 * Single source of truth for environment configuration.
 *
 * - Every required var is checked at boot; missing/invalid values fail loud.
 * - Production-only guardrails: refuses to start with the known dev JWT
 *   fallback or with AUTH_BYPASS enabled.
 * - Consumers MUST import { config } from this module; never read process.env
 *   directly. Exception: db/push.ts forwards process.env to a subprocess,
 *   which is fine because drizzle-kit needs the unfiltered env.
 */
import 'dotenv/config'
import { z } from 'zod'

const DEV_JWT_FALLBACK = 'dev-secret-change-in-production'

// zod 4: defaults apply post-transform, so this is a boolean default. To set
// a STRING input default that flows through the transform, use `.prefault()`.
const bool = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  // ── Required ──────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z
    .string()
    .min(
      16,
      "JWT_SECRET must be at least 16 characters — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    ),

  // ── Standard ──────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  // Bind address. 0.0.0.0 = every IPv4 interface, IPv4 ONLY — without an
  // explicit hostname @hono/node-server binds IPv6-only on Windows and
  // 127.0.0.1 connections fail with ECONNREFUSED. Set HOST=:: only if you
  // genuinely need dual-stack.
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── CORS / dev bypass ─────────────────────────
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_BYPASS: bool.default(false),

  // ── Sync service ──────────────────────────────
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SYNC_DEBUG: bool.default(false),
  SEED_TEST_SERVER: bool.default(false),

  // ── Redis queues ──────────────────────────────
  REDIS_BULLMQ_PREFIX: z.string().default('bull'),
  REDIS_BULLMQ_QUEUE: z.string().default('workflow-studio-comfyui-process-queue'),
  REDIS_LORA_QUEUE: z.string().default('lora-trainer-training-queue'),

  // ── Files ─────────────────────────────────────
  WORKFLOWS_DIR: z.string().default('../workflows'),

  // ── Optional integrations ─────────────────────
  DISCORD_WEBHOOK_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  CREDENTIALS_MASTER_KEY: z.string().optional(),

  // ── Outbound HTTP proxy (optional) ────────────
  HTTP_PROXY: z.string().optional(),
  HTTPS_PROXY: z.string().optional(),
  NO_PROXY: z.string().optional(),
  http_proxy: z.string().optional(),
  https_proxy: z.string().optional(),
  no_proxy: z.string().optional(),

  // ── Internal HTTP (ComfyUI / AI-Toolkit) ──────
  // Timeout for non-probe calls to GPU servers: stats, logs, actions, job
  // control. Health probes use MONITOR_TIMEOUT_MS instead.
  COMFY_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  // ── Server health monitor ─────────────────────
  MONITOR_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  MONITOR_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  MONITOR_STAGGER_MS: z.coerce.number().int().nonnegative().default(600_000),
  // Extra probe attempts before a record is recorded as down. A transient
  // timeout (probe storm, brief blip) shouldn't flip a healthy record to
  // "down" and back — retries happen within the same round, so the cost is
  // paid only for records that fail at least once. 0 disables.
  MONITOR_RETRIES: z.coerce.number().int().nonnegative().default(1),
  // Max probes in flight at once. The monitor used to fire every record
  // simultaneously — dozens of ping spawns + fetches at once is itself a load
  // spike that makes probes time out (the flicker). Cap keeps the round calm.
  MONITOR_CONCURRENCY: z.coerce.number().int().positive().default(8),
  // Round-level hysteresis: an UP record must fail this many CONSECUTIVE
  // rounds before it shows (and alerts) as down — so one bad round can't flip
  // the UI to "down" and back. Recovery is immediate on the first success.
  // Pairs with MONITOR_RETRIES (within-round). Raise toward 3 on a flaky box.
  MONITOR_DOWN_AFTER: z.coerce.number().int().positive().default(2),
  // When true, ALL ComfyUI / AI-Toolkit traffic (health probes, log fetching,
  // ComfyUI actions, workflow tests — everything going through internalFetch)
  // uses the global HTTP_PROXY (if configured). When false (default) it goes
  // direct — most operator NO_PROXY lists don't cover bare hostnames / IPs
  // used for GPU servers, which then erroneously route through the corporate
  // proxy and fail. Flip to true only if your GPU hosts genuinely live behind
  // the corporate proxy.
  MONITOR_USE_PROXY: bool.default(false),
  // When true, every probe (host + service) logs its target, duration, and
  // pass/fail reason. Heavy when monitoring many records — enable only while
  // debugging "server shows down but I can reach it" mysteries.
  MONITOR_VERBOSE: bool.default(false),

  // ── RDP credential probe (services/rdp.ts) ────
  // Extra xfreerdp args appended to the probe — an operator escape hatch for
  // unusual hosts, applied WITHOUT rebuilding the image (change the env,
  // restart). Space-separated, passed as separate argv tokens (no shell — no
  // injection). Empty by default: the FreeRDP 2 image negotiates and
  // authenticates (NTLM) out of the box, so no flags are needed. Use FreeRDP-2
  // arg syntax if you add any (e.g. "/tls-seclevel:0", not the v3 "/tls:...").
  RDP_EXTRA_ARGS: z.string().default(''),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('[config] Invalid environment variables:')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  process.exit(1)
}

const env = parsed.data

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === DEV_JWT_FALLBACK) {
    console.error(
      '[config] JWT_SECRET is set to the dev fallback in production. Refusing to start.',
    )
    process.exit(1)
  }
  if (env.AUTH_BYPASS) {
    console.error('[config] AUTH_BYPASS is enabled in production. Refusing to start.')
    process.exit(1)
  }
  // The .env.example placeholders are long enough to pass the length check —
  // refuse them so a copy-paste deploy can't run with publicly-known secrets.
  if (env.JWT_SECRET.startsWith('replace-with')) {
    console.error(
      '[config] JWT_SECRET is still the .env.example placeholder in production. Refusing to start.',
    )
    process.exit(1)
  }
  if (env.CREDENTIALS_MASTER_KEY?.startsWith('replace-with')) {
    console.error(
      '[config] CREDENTIALS_MASTER_KEY is still the .env.example placeholder in production. Refusing to start.',
    )
    process.exit(1)
  }
}

export const config = Object.freeze({
  ...env,
  proxyUrl: env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '',
  noProxy: env.NO_PROXY || env.no_proxy || '',
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
})

export type Config = typeof config
