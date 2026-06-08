/**
 * test-jobs-clean.ts
 *
 * Removes all TEST-* workflow and LoRA jobs from Redis (all lists, sorted sets,
 * hashes and log lists) and deletes any synced rows from Postgres.
 *
 * Works with any number of test jobs regardless of their suffix.
 *
 * Usage:
 *   npm run test:jobs:clean
 */

import 'dotenv/config'
import Redis from 'ioredis'
import { sql } from 'drizzle-orm'
import { db, workflowJobs, trainingJobs } from '../src/db/index.js'

const WF_QUEUE   = process.env['REDIS_BULLMQ_QUEUE']  ?? 'workflow-studio-comfyui-process-queue'
const LORA_QUEUE = process.env['REDIS_LORA_QUEUE']    ?? 'lora-trainer-training-queue'
const PREFIX     = process.env['REDIS_BULLMQ_PREFIX'] ?? 'bull'

const LISTS = ['wait', 'active', 'paused']
const ZSETS = ['completed', 'failed', 'delayed']

const redis = new Redis(process.env['REDIS_URL']!)

/** Collect all TEST-* IDs present anywhere in a queue's lists and sorted sets. */
async function collectTestIds(queue: string): Promise<string[]> {
  const key = `${PREFIX}:${queue}`
  const ids = new Set<string>()

  for (const list of LISTS) {
    const members = await redis.lrange(`${key}:${list}`, 0, -1)
    members.filter(id => id.startsWith('TEST-')).forEach(id => ids.add(id))
  }
  for (const zset of ZSETS) {
    const members = await redis.zrange(`${key}:${zset}`, 0, -1)
    members.filter(id => id.startsWith('TEST-')).forEach(id => ids.add(id))
  }
  return [...ids]
}

async function removeJob(queue: string, id: string) {
  const key = `${PREFIX}:${queue}`
  for (const list of LISTS) await redis.lrem(`${key}:${list}`, 0, id)
  for (const zset of ZSETS) await redis.zrem(`${key}:${zset}`, id)
  await redis.del(`${key}:${id}`)
  await redis.del(`${key}:${id}:logs`)
  console.log(`  [redis] removed ${id} from ${queue}`)
}

async function main() {
  console.log('── Scanning Redis for TEST-* jobs ─────────────────────')
  const [wfIds, loraIds] = await Promise.all([
    collectTestIds(WF_QUEUE),
    collectTestIds(LORA_QUEUE),
  ])

  console.log(`  Found: ${wfIds.length} WF, ${loraIds.length} LoRA`)

  if (wfIds.length === 0 && loraIds.length === 0) {
    console.log('  Nothing to remove in Redis.')
  } else {
    for (const id of wfIds)   await removeJob(WF_QUEUE,   id)
    for (const id of loraIds) await removeJob(LORA_QUEUE, id)
  }

  console.log('\n── Cleaning Postgres ─────────────────────────────────')
  try {
    const wfDel   = await db.delete(workflowJobs).where(sql`id LIKE 'TEST-%'`).returning({ id: workflowJobs.id })
    const loraDel = await db.delete(trainingJobs).where(sql`process_id LIKE 'TEST-%'`).returning({ id: trainingJobs.id })
    console.log(`  deleted ${wfDel.length} workflow_jobs rows`)
    console.log(`  deleted ${loraDel.length} training_jobs rows`)
  } catch (e) {
    console.warn('  [warn] Postgres cleanup skipped:', (e as Error).message)
  }

  console.log('\nDone.')
  redis.disconnect()
  process.exit(0)
}

main().catch(e => { console.error(e); redis.disconnect(); process.exit(1) })
