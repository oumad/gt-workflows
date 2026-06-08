/**
 * test-jobs-start.ts
 *
 * Moves all TEST-* workflow and LoRA jobs from "waiting" → "active/running"
 * by setting processedOn and shifting them from the wait list to the active list.
 *
 * Works with any number of test jobs created by test-jobs-create.ts.
 *
 * Usage:
 *   npm run test:jobs:start
 */

import 'dotenv/config'
import Redis from 'ioredis'

const WF_QUEUE   = process.env['REDIS_BULLMQ_QUEUE']  ?? 'workflow-studio-comfyui-process-queue'
const LORA_QUEUE = process.env['REDIS_LORA_QUEUE']    ?? 'lora-trainer-training-queue'
const PREFIX     = process.env['REDIS_BULLMQ_PREFIX'] ?? 'bull'

const redis = new Redis(process.env['REDIS_URL']!)

async function moveToActive(queue: string, id: string) {
  const waitKey   = `${PREFIX}:${queue}:wait`
  const activeKey = `${PREFIX}:${queue}:active`
  const hashKey   = `${PREFIX}:${queue}:${id}`

  const removed = await redis.lrem(waitKey, 0, id)
  if (removed === 0) {
    console.warn(`  [warn] ${id} not found in ${queue}:wait — skipping`)
    return
  }
  await redis.lpush(activeKey, id)
  await redis.hset(hashKey, 'processedOn', String(Date.now()))
  console.log(`[start] ${id} → ${queue}:active`)
}

async function main() {
  // Scan both wait lists for any TEST-* IDs
  const [wfWait, loraWait] = await Promise.all([
    redis.lrange(`${PREFIX}:${WF_QUEUE}:wait`,   0, -1),
    redis.lrange(`${PREFIX}:${LORA_QUEUE}:wait`, 0, -1),
  ])

  const wfIds   = wfWait.filter(id   => id.startsWith('TEST-'))
  const loraIds = loraWait.filter(id => id.startsWith('TEST-'))

  if (wfIds.length === 0 && loraIds.length === 0) {
    console.log('No TEST-* jobs found in wait queues.')
    console.log('Run "npm run test:jobs:create" first.')
    redis.disconnect()
    return
  }

  for (const id of wfIds)   await moveToActive(WF_QUEUE,   id)
  for (const id of loraIds) await moveToActive(LORA_QUEUE, id)

  console.log(`\nStarted ${wfIds.length} WF + ${loraIds.length} LoRA test jobs.`)
  console.log('Run "npm run test:jobs:complete" to mark them as completed.')
  console.log('Run "npm run test:jobs:clean"    to remove them entirely.')
  redis.disconnect()
}

main().catch(e => { console.error(e); redis.disconnect(); process.exit(1) })
