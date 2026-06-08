/**
 * test-jobs-complete.ts
 *
 * Marks all TEST-* workflow and LoRA jobs that are currently active/running
 * as completed: sets finishedOn, moves them from the active list to the
 * completed sorted set.
 *
 * Works with any number of test jobs started by test-jobs-start.ts.
 *
 * Usage:
 *   npm run test:jobs:complete
 */

import 'dotenv/config'
import Redis from 'ioredis'

const WF_QUEUE   = process.env['REDIS_BULLMQ_QUEUE']  ?? 'workflow-studio-comfyui-process-queue'
const LORA_QUEUE = process.env['REDIS_LORA_QUEUE']    ?? 'lora-trainer-training-queue'
const PREFIX     = process.env['REDIS_BULLMQ_PREFIX'] ?? 'bull'

const redis = new Redis(process.env['REDIS_URL']!)

async function markCompleted(queue: string, id: string) {
  const activeKey    = `${PREFIX}:${queue}:active`
  const completedKey = `${PREFIX}:${queue}:completed`
  const hashKey      = `${PREFIX}:${queue}:${id}`

  const removed = await redis.lrem(activeKey, 0, id)
  if (removed === 0) {
    console.warn(`  [warn] ${id} not found in ${queue}:active — skipping`)
    return
  }
  const finishedOn = Date.now()
  await redis.hset(hashKey, 'finishedOn', String(finishedOn))
  // BullMQ uses finishedOn as the sorted-set score for completed jobs
  await redis.zadd(completedKey, finishedOn, id)
  console.log(`[complete] ${id} → ${queue}:completed`)
}

async function main() {
  // Scan both active lists for any TEST-* IDs
  const [wfActive, loraActive] = await Promise.all([
    redis.lrange(`${PREFIX}:${WF_QUEUE}:active`,   0, -1),
    redis.lrange(`${PREFIX}:${LORA_QUEUE}:active`, 0, -1),
  ])

  const wfIds   = wfActive.filter(id   => id.startsWith('TEST-'))
  const loraIds = loraActive.filter(id => id.startsWith('TEST-'))

  if (wfIds.length === 0 && loraIds.length === 0) {
    console.log('No TEST-* jobs found in active queues.')
    console.log('Run "npm run test:jobs:start" first.')
    redis.disconnect()
    return
  }

  for (const id of wfIds)   await markCompleted(WF_QUEUE,   id)
  for (const id of loraIds) await markCompleted(LORA_QUEUE, id)

  console.log(`\nCompleted ${wfIds.length} WF + ${loraIds.length} LoRA test jobs.`)
  console.log('The sync service will pick them up and write to Postgres within 60s.')
  console.log('Run "npm run test:jobs:clean" to remove them from Redis + Postgres.')
  redis.disconnect()
}

main().catch(e => { console.error(e); redis.disconnect(); process.exit(1) })
