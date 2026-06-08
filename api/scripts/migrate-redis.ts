/**
 * migrate-redis.ts
 *
 * One-time migration: reads all historical BullMQ jobs from Redis
 * and inserts summary rows into the `jobs` Postgres table.
 *
 * This is READ-ONLY against Redis — it will never write to the queue.
 * Jobs that already exist in Postgres (by id) are skipped via ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   npm run migrate:redis
 *   npm run migrate:redis -- --dry-run       # print counts without writing
 *   npm run migrate:redis -- --limit 1000    # process at most N jobs
 *
 * Expected runtime on 32k jobs: ~2–5 minutes depending on Redis latency.
 */

import 'dotenv/config'
import Redis from 'ioredis'
import { db, workflowJobs } from '../src/db/index.js'
import type { NewWorkflowJob } from '../src/db/schema.js'

// Note: historical BullMQ jobs have NO client attribution (only a ComfyUI
// WebSocket clientId, which is not a user).  client_id will be NULL for
// all migrated rows.  Future jobs ingested via webhooks will carry it.

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT   = (() => {
  const idx = process.argv.indexOf('--limit')
  return idx >= 0 ? Number(process.argv[idx + 1]) : Infinity
})()
const BATCH   = 100   // insert batch size

const QUEUE  = process.env['REDIS_BULLMQ_QUEUE']  ?? 'workflow-studio-comfyui-process-queue'
const PREFIX = process.env['REDIS_BULLMQ_PREFIX'] ?? 'bull'
const KEY    = `${PREFIX}:${QUEUE}`

// ── Helpers ───────────────────────────────────

function ts(ms: number | null): Date | null {
  return ms ? new Date(ms) : null
}

function parseStatus(h: Record<string, string>): NewWorkflowJob['status'] {
  if (h['failedReason']) return 'failed'
  if (h['finishedOn'])   return 'completed'
  if (h['processedOn'])  return 'active'
  return 'waiting'
}

function extractWorkflowName(h: Record<string, string>): string {
  // BullMQ stores the job name in the 'name' field
  if (h['name']) return h['name']
  // Fallback: try to parse data.workflowName
  try {
    const data = JSON.parse(h['data'] ?? '{}') as Record<string, unknown>
    return String(data['workflowName'] ?? data['workflow'] ?? 'Unknown')
  } catch {
    return 'Unknown'
  }
}

function extractServerUrl(h: Record<string, string>): string {
  try {
    const data = JSON.parse(h['data'] ?? '{}') as Record<string, unknown>
    return String(data['serverUrl'] ?? data['server'] ?? '')
  } catch {
    return ''
  }
}

// ── Main ──────────────────────────────────────

const redis = new Redis(process.env['REDIS_URL']!, {
  maxRetriesPerRequest: 3,
  readOnly: true,
})

console.log(`[migrate-redis] connecting to Redis…`)
await redis.ping()
console.log(`[migrate-redis] connected`)

// Collect all job IDs from the known sorted sets + lists
const sets = ['completed', 'failed', 'active', 'wait', 'delayed', 'paused']
const allIds = new Set<string>()

for (const set of sets) {
  const members = await redis.zrange(`${KEY}:${set}`, 0, -1)
  members.forEach(id => allIds.add(id))
  console.log(`  ${set}: ${members.length} jobs`)
}

const ids = [...allIds].slice(0, LIMIT === Infinity ? undefined : LIMIT)
console.log(`\n[migrate-redis] total unique job IDs: ${ids.length}`)

if (DRY_RUN) {
  console.log('[migrate-redis] dry-run mode — no writes')
  process.exit(0)
}

// Fetch job hashes in batches using pipeline
let processed = 0, skipped = 0, errors = 0

for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH)

  // Pipeline: fetch all hashes in one round-trip
  const pipeline = redis.pipeline()
  for (const id of batch) pipeline.hgetall(`${KEY}:${id}`)
  const results = await pipeline.exec()

  const rows: NewWorkflowJob[] = []
  for (let j = 0; j < batch.length; j++) {
    const id     = batch[j]!
    const result = results?.[j]
    if (!result || result[0]) { errors++; continue }

    const h = result[1] as Record<string, string>
    if (!h || Object.keys(h).length === 0) { skipped++; continue }

    const serverUrl    = extractServerUrl(h)
    const workflowName = extractWorkflowName(h)
    const timestamp    = Number(h['timestamp'] ?? 0)
    const processedOn  = h['processedOn']  ? Number(h['processedOn'])  : null
    const finishedOn   = h['finishedOn']   ? Number(h['finishedOn'])   : null

    rows.push({
      id,
      workflowId:   null,  // will be resolved in a separate pass once workflows are seeded
      workflowName,
      serverId:     null,  // resolved later
      serverUrl,
      clientId:     null,  // historical jobs have no user attribution
      status:       parseStatus(h),
      priority:     Number(h['priority'] ?? 0),
      attempts:     Number(h['attempts'] ?? 0),
      createdAt:    ts(timestamp) ?? new Date(0),
      processedAt:  ts(processedOn),
      finishedAt:   ts(finishedOn),
      failedReason: h['failedReason'] ?? null,
      data:         h['returnvalue'] ? { returnvalue: tryParse(h['returnvalue']) } : null,
    })
  }

  if (rows.length === 0) continue

  await db
    .insert(workflowJobs)
    .values(rows)
    .onConflictDoNothing()

  processed += rows.length
  if (processed % 1_000 === 0) {
    console.log(`  progress: ${processed} / ${ids.length}`)
  }
}

console.log(`\n[migrate-redis] done`)
console.log(`  inserted: ${processed}`)
console.log(`  skipped:  ${skipped}  (empty hashes)`)
console.log(`  errors:   ${errors}`)

// ── Resolve workflowId/serverId in a second pass ──
// After workflows and servers are seeded, run this to back-fill FKs.
console.log(`\n[migrate-redis] resolving workflow + server references…`)

// Pull all workflows and servers into maps for fast lookup
const wfRows = await db.query.workflows.findMany({ columns: { id: true, name: true } })
const svRows = await db.query.servers.findMany({ columns: { id: true, url: true } })

const wfByName  = new Map(wfRows.map(w => [w.name.toLowerCase(), w.id]))
const svByUrl   = new Map(svRows.map(s => [s.url, s.id]))

// Update in batches using raw SQL for efficiency
const { sql } = await import('drizzle-orm')

const allJobs = await db.query.workflowJobs.findMany({
  where: (j, { isNull, or }) => or(isNull(j.workflowId), isNull(j.serverId)),
  columns: { id: true, workflowName: true, serverUrl: true },
})

let resolved = 0
for (let i = 0; i < allJobs.length; i += BATCH) {
  const batch = allJobs.slice(i, i + BATCH)
  for (const j of batch) {
    const workflowId = wfByName.get(j.workflowName.toLowerCase()) ?? null
    const serverId   = j.serverUrl ? (svByUrl.get(j.serverUrl) ?? null) : null
    if (!workflowId && !serverId) continue

    await db
      .update(workflowJobs)
      .set({ workflowId, serverId })
      .where(sql`id = ${j.id}`)
    resolved++
  }
}

console.log(`  resolved ${resolved} rows`)

redis.disconnect()
process.exit(0)

function tryParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
