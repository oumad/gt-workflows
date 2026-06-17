import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { db, trainingJobs, gtUsers } from '../db/index.js'
import { requireAdmin } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { notFound, httpErrorResponse } from '../lib/httpError.js'
import { getTrainingLog, getTrainingProgress } from '../services/aiToolkit.js'
import type { AppVariables } from '../types.js'

const app = new Hono<{ Variables: AppVariables }>()

// ─────────────────────────────────────────────
// LoRA-specific routes — list lives on the unified /api/jobs.
// ─────────────────────────────────────────────

// ── GET /lora-jobs/:id ────────────────────────
// Supports lookup by Postgres UUID OR by Redis processId (BullMQ job ID string).
// trainingJobs.id is UUID but processId is TEXT (BullMQ job ID). Passing a
// non-UUID string to eq(uuid_col, ...) causes a Postgres cast error, so we
// only include the uuid clause when id looks like a UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
app.get('/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const row = await db.query.trainingJobs.findFirst({
    where: UUID_RE.test(id)
      ? (t, { eq, or }) => or(eq(t.id, id), eq(t.processId, id))
      : (t, { eq }) => eq(t.processId, id),
    with: { client: true, server: true },
  })
  if (!row) return c.json({ error: 'Not found' }, 404)

  return c.json(row)
})

// ── Live training data from the AI-Toolkit box ─────────────────
// Bridge: training_jobs.remote_job_name ↔ the toolkit's job_ref. Same
// UUID-or-processId lookup as GET /:id.
async function requireAitBridge(id: string): Promise<{ url: string; ref: string }> {
  const row = await db.query.trainingJobs.findFirst({
    where: UUID_RE.test(id)
      ? (t, { eq: e, or }) => or(e(t.id, id), e(t.processId, id))
      : (t, { eq: e }) => e(t.processId, id),
    columns: { serverUrl: true, remoteJobName: true },
  })
  if (!row) throw notFound('Job not found')
  if (!row.remoteJobName) {
    throw notFound(
      'This job has no AI-Toolkit reference (remoteJobName) — training details unavailable.',
    )
  }
  if (!row.serverUrl) {
    throw notFound('This job has no server URL — training details unavailable.')
  }
  return { url: row.serverUrl, ref: row.remoteJobName }
}

// ── GET /lora-jobs/:id/training-progress — status/step/speed ──
app.get('/:id/training-progress', requireAuth, async (c) => {
  try {
    const { url, ref } = await requireAitBridge(c.req.param('id'))
    return c.json(await getTrainingProgress(url, ref))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── GET /lora-jobs/:id/training-log — tailed trainer log ──────
app.get('/:id/training-log', requireAuth, async (c) => {
  try {
    const { url, ref } = await requireAitBridge(c.req.param('id'))
    return c.json(await getTrainingLog(url, ref))
  } catch (err) {
    return httpErrorResponse(c, err)
  }
})

// ── POST /lora-jobs — ingest a process JSON ────
// Called by the seeder / migration script, or by the AI-Toolkit webhook.
const ingestSchema = z.object({
  processId: z.string().min(1),
  outputName: z.string().min(1),
  baseModel: z.string().min(1),
  triggerWord: z.string().optional(),
  totalSteps: z.number().int().optional(),
  learningRate: z.string().optional(),
  networkDim: z.number().int().optional(),
  networkAlpha: z.string().optional(),
  saveEveryNSteps: z.number().int().optional(),
  datasetName: z.string().optional(),
  imageCount: z.number().int().optional(),
  outputOptions: z.string().optional(),
  serverId: z.string().optional(),
  serverUrl: z.string().url().optional(),
  remoteJobName: z.string().optional(),
  sessionId: z.string().optional(),
  // client identity from executionContext.user
  clientExternalId: z.string().min(1), // MongoDB ObjectId
  clientEmail: z.string().email().optional(),
  clientName: z.string().optional(),
  projectPath: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  createdAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional().nullable(),
  finishedAt: z.string().datetime().optional().nullable(),
  failedReason: z.string().optional().nullable(),
  parameters: z.record(z.string(), z.unknown()).optional(),
})

app.post('/', requireAdmin, zValidator('json', ingestSchema), async (c) => {
  const body = c.req.valid('json')

  // Upsert the GT user record so we always have a row to FK against
  const [client] = await db
    .insert(gtUsers)
    .values({
      externalId: body.clientExternalId,
      email: body.clientEmail,
      name: body.clientName,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: gtUsers.externalId,
      set: {
        email: body.clientEmail,
        name: body.clientName,
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: gtUsers.id })

  const [row] = await db
    .insert(trainingJobs)
    .values({
      processId: body.processId,
      outputName: body.outputName,
      baseModel: body.baseModel,
      triggerWord: body.triggerWord,
      totalSteps: body.totalSteps,
      learningRate: body.learningRate,
      networkDim: body.networkDim,
      networkAlpha: body.networkAlpha,
      saveEveryNSteps: body.saveEveryNSteps,
      datasetName: body.datasetName,
      imageCount: body.imageCount,
      outputOptions: body.outputOptions,
      serverId: body.serverId,
      serverUrl: body.serverUrl,
      remoteJobName: body.remoteJobName,
      sessionId: body.sessionId,
      clientId: client?.id ?? null,
      clientExternalId: body.clientExternalId,
      projectPath: body.projectPath,
      status: body.status ?? 'pending',
      parameters: body.parameters,
      createdAt: body.createdAt ? new Date(body.createdAt) : new Date(),
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : null,
      failedReason: body.failedReason,
    })
    .onConflictDoUpdate({
      target: trainingJobs.processId,
      set: {
        status: body.status,
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
        failedReason: body.failedReason,
        parameters: body.parameters,
      },
    })
    .returning()

  if (!row) return c.json({ error: 'Insert failed' }, 500)
  return c.json(row, 201)
})

// ── PATCH /lora-jobs/:id/status ───────────────
// AI-Toolkit webhook: update job status
const statusSchema = z.object({
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  failedReason: z.string().optional(),
})

app.patch('/:id/status', requireAdmin, zValidator('json', statusSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [row] = await db
    .update(trainingJobs)
    .set({
      status: body.status,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
      failedReason: body.failedReason,
    })
    .where(eq(trainingJobs.id, id))
    .returning()

  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

export default app
