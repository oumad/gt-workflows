/**
 * test-jobs-create.ts
 *
 * Injects a fake workflow job and a fake LoRA training job into Redis
 * in the "waiting" state so they appear in the Live Feed queue.
 *
 * Each run generates a unique ID + randomised field values, so you can
 * call this multiple times to fill the queue with varied test data.
 *
 * Usage:
 *   npm run test:jobs:create
 */

import 'dotenv/config'
import Redis from 'ioredis'

const WF_QUEUE   = process.env['REDIS_BULLMQ_QUEUE']  ?? 'workflow-studio-comfyui-process-queue'
const LORA_QUEUE = process.env['REDIS_LORA_QUEUE']    ?? 'lora-trainer-training-queue'
const PREFIX     = process.env['REDIS_BULLMQ_PREFIX'] ?? 'bull'

const redis = new Redis(process.env['REDIS_URL']!)

// ── Random helpers ────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }

const WF_NAMES = [
  'Qwen Image', 'Wan Image To Video', 'Sketch To Render (SDXL)',
  'Sketch To Render', 'Render to Sketch', 'Pain Transfer | BETA', 'Material Transfer',
]
const SERVERS = [
  'http://gpu-01:8188',
  "http://10.244.163.33:8188"
]
const USERS = [
  { id: 'user-001', name: 'Alice Martin',  email: 'alice@example.com'  },
  { id: 'user-002', name: 'Bob Chen',      email: 'bob@example.com'    },
  { id: 'user-003', name: 'Sophie Leroy',  email: 'sophie@example.com' },
  { id: 'user-004', name: 'James Park',    email: 'james@example.com'  },
  { id: 'user-005', name: 'Mia Santos',    email: 'mia@example.com'    },
  { id: 'user-006', name: 'Lucas Hoffman', email: 'lucas@example.com'  },
]
const ARCHS    = ['flux-dev', 'flux-schnell', 'sdxl', 'sd15']
const DATASETS = ['portraits-001', 'products-002', 'scenes-003', 'faces-004', 'objects-005']
const TRIGGERS = ['ohwx', 'sks', 'instance', 'trigger', 'subject']
const LR_OPTS  = ['0.0001', '0.0002', '0.0004', '0.0008']
const DIM_OPTS = [8, 16, 32, 64]

async function main() {
  const now    = Date.now()
  // Short unique suffix — last 6 chars of base-36 timestamp, upper-cased
  const suffix = now.toString(36).slice(-6).toUpperCase()
  const WF_ID   = `TEST-WF-${suffix}`
  const LORA_ID = `TEST-LORA-${suffix}`

  const user      = pick(USERS)
  const wfName    = pick(WF_NAMES)
  const server    = pick(SERVERS)
  const arch      = pick(ARCHS)
  const dataset   = pick(DATASETS)
  const trigger   = pick(TRIGGERS)
  const steps     = pick([500, 1000, 1500, 2000])
  const dim       = pick(DIM_OPTS)
  const lr        = pick(LR_OPTS)
  const imgCount  = rand(20, 80)
  const loraName  = `${trigger}-${arch}-${suffix.toLowerCase()}`
  // AI Toolkit typically runs on a different port than ComfyUI
  const loraServer = server.replace('8188', '7860')

  // ── Workflow job ──────────────────────────────────────────────────
  await redis.hset(`${PREFIX}:${WF_QUEUE}:${WF_ID}`, {
    data: JSON.stringify({
      workflow: {
        name:   wfName,
        config: { comfyui_config: { serverUrl: server } },
      },
      nodes: {},
      executionContext: {
        context: { user },
      },
    }),
    name:      wfName,
    timestamp: String(now),
    priority:  '0',
    attempts:  '0',
  })
  await redis.lpush(`${PREFIX}:${WF_QUEUE}:wait`, WF_ID)
  console.log(`[create] WF   ${WF_ID}  name=${wfName}  server=${server}  user=${user.name}`)

  // ── LoRA training job ─────────────────────────────────────────────
  await redis.hset(`${PREFIX}:${LORA_QUEUE}:${LORA_ID}`, {
    data: JSON.stringify({
      name:                   loraName,
      modelArch:              arch,
      resolvedTotalSteps:     steps,
      learningRate:           lr,
      networkDim:             dim,
      networkAlpha:           String(dim),
      saveEveryNSteps:        Math.floor(steps / 5),
      aiToolkitDatasetName:   dataset,
      aiToolkitRemoteJobName: `job-${suffix.toLowerCase()}`,
      aiToolkitServerUrl:     loraServer,
      triggerWord:            trigger,
      imageFileNames:         Array.from({ length: imgCount }, (_, i) => `img_${String(i).padStart(4, '0')}.png`),
      executionContext: {
        context: { user },
      },
    }),
    name:      `lora-training-${arch}`,
    timestamp: String(now),
    priority:  '0',
    attempts:  '0',
  })
  await redis.lpush(`${PREFIX}:${LORA_QUEUE}:wait`, LORA_ID)
  console.log(`[create] LoRA ${LORA_ID}  name=${loraName}  arch=${arch}  steps=${steps}  images=${imgCount}`)

  console.log(`\nTag: ${suffix}`)
  console.log('Run "npm run test:jobs:start"    to move all waiting test jobs to running.')
  console.log('Run "npm run test:jobs:complete" to mark all running test jobs as completed.')
  console.log('Run "npm run test:jobs:clean"    to remove all test jobs from Redis + Postgres.')
  redis.disconnect()
}

main().catch(e => { console.error(e); redis.disconnect(); process.exit(1) })
