/**
 * test-jobs-log.ts
 *
 * Pushes the "Workflow is running on comfyui" log line to all active TEST-*
 * workflow jobs in Redis.
 *
 * This simulates the marker that the live tracker watches for — causing it to
 * detect a ComfyUI execution start, freeze the wait timer, and show the GEN
 * phase badge on the next poll.
 *
 * Usage:
 *   npm run test:jobs:log
 */

import 'dotenv/config'
import Redis from 'ioredis'

const WF_QUEUE = process.env['REDIS_BULLMQ_QUEUE']  ?? 'workflow-studio-comfyui-process-queue'
const PREFIX   = process.env['REDIS_BULLMQ_PREFIX'] ?? 'bull'

const COMFY_RUNNING_MARKER = 'Workflow is running on comfyui'

const redis = new Redis(process.env['REDIS_URL']!)

async function main() {
  const active  = await redis.lrange(`${PREFIX}:${WF_QUEUE}:active`, 0, -1)
  const testIds = active.filter(id => id.startsWith('TEST-'))

  if (testIds.length === 0) {
    console.log('No active TEST-* WF jobs found.')
    console.log('Run "npm run test:jobs:run" first to create active jobs.')
    redis.disconnect()
    return
  }

  for (const id of testIds) {
    const logsKey = `${PREFIX}:${WF_QUEUE}:${id}:logs`
    // Check if the marker is already in the logs list
    const existing = await redis.lrange(logsKey, 0, -1)
    if (existing.some(l => l.includes(COMFY_RUNNING_MARKER))) {
      console.log(`[log] ${id}  → marker already present, skipping`)
      continue
    }
    await redis.rpush(logsKey, COMFY_RUNNING_MARKER)
    console.log(`[log] ${id}  → pushed "${COMFY_RUNNING_MARKER}"`)
  }

  console.log(`\nDone. ${testIds.length} job(s) checked.`)
  console.log('The live tracker will detect the marker on the next /api/jobs/live poll.')
  redis.disconnect()
}

main().catch(e => { console.error(e); redis.disconnect(); process.exit(1) })
