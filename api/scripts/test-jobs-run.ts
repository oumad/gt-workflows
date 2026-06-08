/**
 * test-jobs-run.ts
 *
 * Creates a workflow job and a LoRA training job directly in the running/active
 * state — skipping the waiting step entirely.
 *
 * Timestamps are back-dated slightly so elapsed time shows realistically
 * in the Live Feed from the first poll.
 *
 * Usage:
 *   npm run test:jobs:run
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
  'portrait-gen', 'background-removal', 'image-upscale',
  'style-transfer', 'product-shot', 'inpainting-v2', 'video-frame-gen',
]
const SERVERS = [
  'http://gpu-01:8188', 'http://gpu-02:8188',
  'http://gpu-03:8188', 'http://comfy-prod:8188',
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
  const loraServer = server.replace('8188', '7860')

  // Back-date timestamps so elapsed / wait time shows a non-zero value immediately.
  // WF jobs run fast (seconds to minutes) — created 10–120s ago, started 5–60s ago.
  // LoRA jobs run slow (hours) — created 5–30 min ago, started 2–20 min ago.
  const wfCreatedAt   = now - rand(10_000,   120_000)   // 10s – 2 min ago
  const wfProcessedAt = now - rand(5_000,     60_000)   // 5s  – 1 min ago (must be ≤ createdAt gap)
  const loCreatedAt   = now - rand(300_000, 1_800_000)  // 5   – 30 min ago
  const loProcessedAt = now - rand(120_000,  1_200_000) // 2   – 20 min ago

  // ── Workflow job → active ─────────────────────────────────────────
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
    name:        wfName,
    timestamp:   String(wfCreatedAt),
    processedOn: String(wfProcessedAt),
    priority:    '0',
    attempts:    '1',
  })
  await redis.lpush(`${PREFIX}:${WF_QUEUE}:active`, WF_ID)
  console.log(`[run] WF   ${WF_ID}  name=${wfName}  server=${server}  user=${user.name}`)
  console.log(`       created ${Math.round((now - wfCreatedAt) / 1000)}s ago, running for ${Math.round((now - wfProcessedAt) / 1000)}s`)

  // ── LoRA training job → active ────────────────────────────────────
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
    name:        `lora-training-${arch}`,
    timestamp:   String(loCreatedAt),
    processedOn: String(loProcessedAt),
    priority:    '0',
    attempts:    '1',
  })
  await redis.lpush(`${PREFIX}:${LORA_QUEUE}:active`, LORA_ID)
  console.log(`[run] LoRA ${LORA_ID}  name=${loraName}  arch=${arch}  steps=${steps}  images=${imgCount}`)
  console.log(`       created ${Math.round((now - loCreatedAt) / 60_000)}m ago, running for ${Math.round((now - loProcessedAt) / 60_000)}m`)

  console.log(`\nTag: ${suffix}`)
  console.log('Run "npm run test:jobs:complete" to mark them as completed.')
  console.log('Run "npm run test:jobs:clean"    to remove them.')
  redis.disconnect()
}

main().catch(e => { console.error(e); redis.disconnect(); process.exit(1) })
