import Redis from 'ioredis'
import { sql, eq, and, isNull } from 'drizzle-orm'
import { config } from '../config/index.js'
import { db, workflowJobs, trainingJobs, gtUsers } from '../db/index.js'
import type { NewWorkflowJob, NewTrainingJob } from '../db/schema.js'
import {
  parseJobData,
  str,
  deepFind,
  extractWfServerUrl,
  extractLoraServerUrl,
  extractUserName,
} from './jobDataUtils.js'
import { consumeComfyStartedAt } from './liveTracker.js'
import { detectComfyStartsForJobs } from './redis.js'
import { syncServerHealth } from './serverHealth.js'
import { checkCalendarReminders } from './calendarReminders.js'
import { serverMatchKey } from '../lib/serverUrl.js'

const WF_QUEUE = config.REDIS_BULLMQ_QUEUE
const LORA_QUEUE = config.REDIS_LORA_QUEUE
const PREFIX = config.REDIS_BULLMQ_PREFIX
const INTERVAL = config.SYNC_INTERVAL_MS
const HEALTH_INTERVAL = config.MONITOR_INTERVAL_MS
const HEALTH_STAGGER = config.MONITOR_STAGGER_MS
const BATCH = 200

// BullMQ uses sorted sets for some queues and lists for others
const ZSETS = ['completed', 'failed', 'delayed']
const LISTS = ['wait', 'active', 'paused']

// ── Status mappers ────────────────────────────

function parseWfStatus(h: Record<string, string>): NewWorkflowJob['status'] {
  if (h['failedReason']) return 'failed'
  if (h['finishedOn']) return 'completed'
  if (h['processedOn']) return 'active'
  return 'waiting'
}

function parseLoraStatus(h: Record<string, string>): string {
  if (h['failedReason']) return 'failed'
  if (h['finishedOn']) return 'completed'
  if (h['processedOn']) return 'running'
  return 'pending'
}

/** Derive a best-known creation time for a BullMQ job hash.
 *
 *  Redis is the source of truth for `timestamp` (the enqueue time). When the
 *  field is missing — partial eviction, restart with persistence off, hash
 *  rewrite — we used to fall back to `new Date()`, which placed `created_at`
 *  *after* `processedOn` / `finishedOn` for any in-flight or completed job
 *  (the bug behind job 16332). Instead, derive a value that respects the
 *  invariant `created_at <= processedOn <= finishedOn` by picking the earliest
 *  available downstream timestamp. Only as a last resort (job never ran) do we
 *  use now() — and the LEAST() guard in the upserts will heal it later. */
function pickCreatedAt(h: Record<string, string>): Date {
  if (h['timestamp']) return new Date(Number(h['timestamp']))
  const candidates = [h['processedOn'], h['finishedOn']]
    .map((v) => (v ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n)) as number[]
  if (candidates.length > 0) return new Date(Math.min(...candidates))
  return new Date()
}

// ── Observable sync state ─────────────────────
// Surfaced via GET /api/health so the frontend can show a "first sync in
// progress" indicator on cold start — before the Redis→Postgres backfill has
// run, pages like Jobs / Analytics would otherwise look empty.
export interface SyncStatus {
  firstSyncDone: boolean // has at least one full sync cycle finished?
  running: boolean // is a cycle in flight right now?
  lastSyncAt: string | null // ISO timestamp of the last completed cycle
  lastSyncOk: boolean // did every sub-sync in the last cycle succeed?
  syncCount: number // total completed cycles since boot
}

const syncState: SyncStatus = {
  firstSyncDone: false,
  running: false,
  lastSyncAt: null,
  lastSyncOk: false,
  syncCount: 0,
}

/** Snapshot of the sync service state (copy — callers can't mutate it). */
export function getSyncStatus(): SyncStatus {
  return { ...syncState }
}

// ── Sync service ──────────────────────────────

class SyncService {
  private timer: NodeJS.Timeout | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private client: Redis | null = null

  private redis(): Redis {
    if (!this.client) {
      this.client = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        enableOfflineQueue: false,
        readOnly: true,
      })
      this.client.on('error', (err) => console.error('[sync]', err.message))
    }
    return this.client
  }

  start(): void {
    setTimeout(() => this.run(), 15_000) // first job sync after 15s startup
    this.timer = setInterval(() => this.run(), INTERVAL)

    // Health probing runs on its own cadence (MONITOR_INTERVAL_MS) so it can be
    // tuned independently of the Redis→Postgres job sync. MONITOR_STAGGER_MS
    // delays the first probe so we don't hammer everything at boot.
    const runHealth = () => {
      void syncServerHealth().catch((e) =>
        console.error('[health] sync failed:', e instanceof Error ? e.message : e),
      )
    }
    setTimeout(() => {
      runHealth()
      this.healthTimer = setInterval(runHealth, HEALTH_INTERVAL)
    }, HEALTH_STAGGER)

    console.log(
      `[sync] started — job sync ${INTERVAL / 1000}s, health ${HEALTH_INTERVAL / 1000}s (stagger ${HEALTH_STAGGER / 1000}s), queues: ${WF_QUEUE}, ${LORA_QUEUE}`,
    )
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.client?.disconnect()
  }

  private async run(): Promise<void> {
    syncState.running = true
    const results = await Promise.allSettled([
      this.syncWorkflowJobs(),
      this.syncLoraJobs(),
      checkCalendarReminders(),
    ])
    syncState.running = false
    syncState.firstSyncDone = true
    syncState.lastSyncAt = new Date().toISOString()
    syncState.lastSyncOk = results.every((r) => r.status === 'fulfilled')
    syncState.syncCount += 1
  }

  // ── Workflow jobs ─────────────────────────────

  private async syncWorkflowJobs(): Promise<void> {
    const key = `${PREFIX}:${WF_QUEUE}`
    try {
      const ids = await this.scanIds(key)
      if (ids.length === 0) return

      const [wfRows, svRows] = await Promise.all([
        db.query.workflows.findMany({ columns: { id: true, name: true } }),
        db.query.servers.findMany({ columns: { id: true, url: true } }),
      ])
      const wfByName = new Map(wfRows.map((w) => [w.name.toLowerCase(), w.id]))
      // Map by normalized URL so http://x/, https://x, and x all resolve to the
      // same server. BullMQ jobs serialize the URL in various forms.
      const svByKey = new Map(svRows.map((s) => [serverMatchKey(s.url), s.id]))

      let synced = 0
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH)
        const pipeline = this.redis().pipeline()
        batch.forEach((id) => pipeline.hgetall(`${key}:${id}`))
        const results = await pipeline.exec()

        type Pending = Omit<NewWorkflowJob, 'clientId'> & {
          _extId: string
          _userName: string
          _userEmail: string
        }
        const pending: Pending[] = []
        // Ids in this batch whose Redis logs we should sweep for the
        // ComfyUI "running" marker — active jobs (likely to have the marker
        // arriving any tick now) and recently-finished jobs (job ran and
        // completed inside a single sync interval, so the previous-sync
        // "active" pass never saw it). detectComfyStartsForJobs dedups
        // against the in-memory map, so passing a candidate that's already
        // been detected is a no-op.
        const detectIds: string[] = []
        const DETECT_RECENT_MS = INTERVAL * 3
        const tickStart = Date.now()

        for (let j = 0; j < batch.length; j++) {
          const id = batch[j]!
          const res = results?.[j]
          if (!res || res[0]) continue
          const h = res[1] as Record<string, string>
          if (!h || Object.keys(h).length === 0) continue

          const data = parseJobData(h)
          const serverUrl = extractWfServerUrl(data)
          const userName = extractUserName(data)
          const userEmail = str(
            data,
            'executionContext.context.user.email',
            'executionContext.user.email',
          )
          const extId =
            str(
              data,
              'clientExternalId',
              'userId',
              'executionContext.context.user.id',
              'executionContext.user.id',
            ) || `redis:${id}`
          const workflowName =
            h['name'] || str(data, 'workflow.name', 'workflowName', 'workflow') || 'Unknown'

          // One-time structure debug (set SYNC_DEBUG=1 to enable)
          if (config.SYNC_DEBUG && synced === 0 && pending.length === 0) {
            console.log('[sync:debug] WF job data top-level keys:', Object.keys(data))
            const wf = (data as Record<string, unknown>)['workflow']
            if (wf && typeof wf === 'object') {
              console.log('[sync:debug] workflow keys:', Object.keys(wf))
              const cfg = (wf as Record<string, unknown>)['config']
              if (cfg && typeof cfg === 'object') {
                console.log('[sync:debug] workflow.config keys:', Object.keys(cfg))
                const cc = (cfg as Record<string, unknown>)['comfyui_config']
                if (cc && typeof cc === 'object')
                  console.log('[sync:debug] workflow.config.comfyui_config keys:', Object.keys(cc))
              }
            }
            console.log(
              '[sync:debug] resolved serverUrl:',
              serverUrl,
              '  userName:',
              userName,
              '  extId:',
              extId,
            )
          }

          const status = parseWfStatus(h)
          const finishedOn = h['finishedOn'] ? Number(h['finishedOn']) : null

          // Schedule comfy-start detection for this job if either:
          //   • it's currently active (the marker may have just landed)
          //   • it transitioned to a terminal state recently — could have
          //     started + finished entirely between two sync ticks, in which
          //     case the previous tick never saw it as "active" so this is
          //     our only window to catch the marker before logs age out of
          //     Redis. Wider safety window (3 × sync interval) covers
          //     consecutive missed ticks.
          if (status === 'active') {
            detectIds.push(id)
          } else if (
            (status === 'completed' || status === 'failed') &&
            finishedOn != null &&
            tickStart - finishedOn < DETECT_RECENT_MS
          ) {
            detectIds.push(id)
          }

          pending.push({
            _extId: extId,
            _userName: userName,
            _userEmail: userEmail,
            id,
            workflowId: wfByName.get(workflowName.toLowerCase()) ?? null,
            workflowName,
            serverId: serverUrl ? (svByKey.get(serverMatchKey(serverUrl)) ?? null) : null,
            serverUrl,
            status,
            priority: Number(h['priority'] ?? 0),
            attempts: Number(h['attempts'] ?? 0),
            createdAt: pickCreatedAt(h),
            processedAt: h['processedOn'] ? new Date(Number(h['processedOn'])) : null,
            finishedAt: finishedOn != null ? new Date(finishedOn) : null,
            failedReason: h['failedReason'] ?? null,
            data: userName ? { userName } : null,
          })
        }

        // Run detection BEFORE the consume-and-persist step below so any
        // marker captured here lands in the DB on the same sync tick.
        if (detectIds.length > 0) {
          await detectComfyStartsForJobs(this.redis(), detectIds)
        }

        if (pending.length === 0) continue

        // Upsert GT users for jobs that have a real external ID.
        // Sorted by externalId so concurrent syncs acquire row locks in the
        // same order, avoiding deadlocks against trainingJobs sync.
        const knownPending = [
          ...new Map(
            pending.filter((p) => !p._extId.startsWith('redis:')).map((p) => [p._extId, p]),
          ).values(),
        ].sort((a, b) => a._extId.localeCompare(b._extId))
        if (knownPending.length > 0) {
          await db
            .insert(gtUsers)
            .values(
              knownPending.map((p) => ({
                externalId: p._extId,
                lastSeenAt: new Date(),
                name: p._userName || undefined,
                email: p._userEmail || undefined,
              })),
            )
            .onConflictDoUpdate({
              target: gtUsers.externalId,
              set: {
                lastSeenAt: new Date(),
                name: sql`COALESCE(NULLIF(excluded.name, ''), gt_users.name)`,
                email: sql`COALESCE(NULLIF(excluded.email, ''), gt_users.email)`,
              },
            })
        }

        // Resolve clientId from external ID → GT user UUID
        const knownExtIds = knownPending.map((p) => p._extId)
        const clientRows =
          knownExtIds.length > 0
            ? await db.query.gtUsers.findMany({
                where: (u, { inArray }) => inArray(u.externalId, knownExtIds),
                columns: { id: true, externalId: true },
              })
            : []
        const clientIdByExt = new Map(clientRows.map((u) => [u.externalId, u.id]))

        const rows: NewWorkflowJob[] = pending.map(({ _extId, _userName, _userEmail, ...r }) => ({
          ...r,
          clientId: clientIdByExt.get(_extId) ?? null,
        }))

        await db
          .insert(workflowJobs)
          .values(rows)
          .onConflictDoUpdate({
            target: workflowJobs.id,
            set: {
              status: sql`excluded.status`,
              // Heal rows whose created_at was once written as now() because
              // Redis had lost the original 'timestamp'. LEAST() keeps the
              // earliest known value, so a later sync with better data fixes
              // the row instead of leaving created_at > processed_at.
              createdAt: sql`LEAST(workflow_jobs.created_at, excluded.created_at)`,
              processedAt: sql`excluded.processed_at`,
              finishedAt: sql`excluded.finished_at`,
              failedReason: sql`excluded.failed_reason`,
              workflowId: sql`COALESCE(workflow_jobs.workflow_id, excluded.workflow_id)`,
              serverId: sql`COALESCE(excluded.server_id, workflow_jobs.server_id)`,
              serverUrl: sql`COALESCE(NULLIF(excluded.server_url, ''), workflow_jobs.server_url)`,
              clientId: sql`COALESCE(excluded.client_id, workflow_jobs.client_id)`,
              data: sql`COALESCE(excluded.data, workflow_jobs.data)`,
            },
          })
        synced += rows.length

        // Flush any liveTracker comfyStartedAt values to Postgres for jobs
        // that have just completed or failed.  One UPDATE per job — runs at
        // most once per sync interval and only for jobs that went through the
        // live tracker, so the overhead is negligible.
        const doneIds = rows
          .filter((r) => r.status === 'completed' || r.status === 'failed')
          .map((r) => r.id)
        for (const jobId of doneIds) {
          const comfyAt = consumeComfyStartedAt(jobId)
          if (comfyAt) {
            await db
              .update(workflowJobs)
              .set({ comfyStartedAt: new Date(comfyAt) })
              .where(and(eq(workflowJobs.id, jobId), isNull(workflowJobs.comfyStartedAt)))
          }
        }
      }
      if (synced > 0)
        console.log(`[sync] workflow jobs: ${synced} upserted (${ids.length} in Redis)`)
    } catch (e) {
      console.error('[sync] workflow jobs error:', e instanceof Error ? e.message : e)
    }
  }

  // ── LoRA training jobs ────────────────────────

  private async syncLoraJobs(): Promise<void> {
    const key = `${PREFIX}:${LORA_QUEUE}`
    try {
      const ids = await this.scanIds(key)
      if (ids.length === 0) return

      const svRows = await db.query.servers.findMany({ columns: { id: true, url: true } })
      const svByKey = new Map(svRows.map((s) => [serverMatchKey(s.url), s.id]))

      let synced = 0
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH)
        const pipeline = this.redis().pipeline()
        batch.forEach((id) => pipeline.hgetall(`${key}:${id}`))
        const results = await pipeline.exec()

        type Pending = NewTrainingJob & { _extId: string; _userName: string; _userEmail: string }
        const pending: Pending[] = []

        for (let j = 0; j < batch.length; j++) {
          const id = batch[j]!
          const res = results?.[j]
          if (!res || res[0]) continue
          const h = res[1] as Record<string, string>
          if (!h || Object.keys(h).length === 0) continue

          const data = parseJobData(h)
          // Real payload shape: flat keys — aiToolkitServerUrl, modelArch, resolvedTotalSteps,
          // aiToolkitDatasetName, aiToolkitRemoteJobName, imageFileNames[], executionContext.context.user.*
          const serverUrl = extractLoraServerUrl(data)
          const userName = extractUserName(data)
          const userEmail = str(
            data,
            'executionContext.context.user.email',
            'executionContext.user.email',
          )
          const extId =
            str(
              data,
              'clientExternalId',
              'userId',
              'executionContext.context.user.id',
              'executionContext.user.id',
            ) || `redis:${id}`
          const imageFiles = Array.isArray(data['imageFileNames'])
            ? (data['imageFileNames'] as unknown[]).length
            : undefined

          pending.push({
            _extId: extId,
            _userName: userName,
            _userEmail: userEmail,
            processId: String(id),
            // 'name' is the lora name in real payload; 'outputName' in legacy
            outputName: str(data, 'name', 'outputName') || h['name'] || `lora-${id}`,
            // 'modelArch' in real payload; 'baseModel' in legacy
            baseModel: str(data, 'modelArch', 'baseModel') || 'unknown',
            triggerWord: data['triggerWord'] as string | undefined,
            loraType: data['loraType'] as string | undefined,
            // 'resolvedTotalSteps' in real payload; 'totalSteps' in legacy
            totalSteps: (data['resolvedTotalSteps'] ?? data['totalSteps']) as number | undefined,
            learningRate: data['learningRate'] as string | undefined,
            networkDim: data['networkDim'] as number | undefined,
            networkAlpha: data['networkAlpha'] as string | undefined,
            saveEveryNSteps: data['saveEveryNSteps'] as number | undefined,
            // 'aiToolkitDatasetName' in real payload; 'datasetName' in legacy
            datasetName: (data['aiToolkitDatasetName'] ?? data['datasetName']) as
              | string
              | undefined,
            // derive from imageFileNames array length when available
            imageCount: imageFiles ?? (data['imageCount'] as number | undefined),
            serverId: serverUrl ? (svByKey.get(serverMatchKey(serverUrl)) ?? null) : null,
            serverUrl,
            // 'aiToolkitRemoteJobName' in real payload; 'remoteJobName' in legacy
            remoteJobName: (data['aiToolkitRemoteJobName'] ?? data['remoteJobName']) as
              | string
              | undefined,
            sessionId: data['sessionId'] as string | undefined,
            clientId: null,
            clientExternalId: extId,
            projectPath:
              str(
                data,
                'executionContext.context.projectPath',
                'executionContext.projectPath',
                'projectPath',
              ) || undefined,
            status: parseLoraStatus(h),
            createdAt: pickCreatedAt(h),
            startedAt: h['processedOn'] ? new Date(Number(h['processedOn'])) : null,
            finishedAt: h['finishedOn'] ? new Date(Number(h['finishedOn'])) : null,
            failedReason: h['failedReason'] ?? null,
            parameters: Object.keys(data).length > 0 ? data : null,
          })
        }

        if (pending.length === 0) continue

        // Deduplicate by processId — same job can appear in multiple Redis structures
        // (e.g. active list + completed set after a restart).  Without this Postgres
        // throws "ON CONFLICT DO UPDATE command cannot affect row a second time".
        const dedupedPending = [...new Map(pending.map((p) => [p.processId, p])).values()]

        // Upsert GT users so we have client rows for FKs.
        // Sorted by externalId so concurrent syncs acquire row locks in the
        // same order, avoiding deadlocks against workflowJobs sync.
        const knownPending = [
          ...new Map(
            dedupedPending.filter((p) => !p._extId.startsWith('redis:')).map((p) => [p._extId, p]),
          ).values(),
        ].sort((a, b) => a._extId.localeCompare(b._extId))
        if (knownPending.length > 0) {
          await db
            .insert(gtUsers)
            .values(
              knownPending.map((p) => ({
                externalId: p._extId,
                lastSeenAt: new Date(),
                name: p._userName || undefined,
                email: p._userEmail || undefined,
              })),
            )
            .onConflictDoUpdate({
              target: gtUsers.externalId,
              set: {
                lastSeenAt: new Date(),
                name: sql`COALESCE(NULLIF(excluded.name, ''), gt_users.name)`,
                email: sql`COALESCE(NULLIF(excluded.email, ''), gt_users.email)`,
              },
            })
        }

        // Resolve clientId for each job
        const knownExtIds = knownPending.map((p) => p._extId)
        const clientRows =
          knownExtIds.length > 0
            ? await db.query.gtUsers.findMany({
                where: (u, { inArray }) => inArray(u.externalId, knownExtIds),
                columns: { id: true, externalId: true },
              })
            : []
        const clientIdByExt = new Map(clientRows.map((u) => [u.externalId, u.id]))

        const rows: NewTrainingJob[] = dedupedPending.map(
          ({ _extId, _userName, _userEmail, ...r }) => ({
            ...r,
            clientId: clientIdByExt.get(_extId) ?? null,
          }),
        )

        await db
          .insert(trainingJobs)
          .values(rows)
          .onConflictDoUpdate({
            target: trainingJobs.processId,
            set: {
              status: sql`excluded.status`,
              // See pickCreatedAt + the matching guard on workflow_jobs.
              createdAt: sql`LEAST(training_jobs.created_at, excluded.created_at)`,
              startedAt: sql`excluded.started_at`,
              finishedAt: sql`excluded.finished_at`,
              failedReason: sql`excluded.failed_reason`,
              serverId: sql`COALESCE(excluded.server_id, training_jobs.server_id)`,
              serverUrl: sql`COALESCE(NULLIF(excluded.server_url, ''), training_jobs.server_url)`,
              clientId: sql`COALESCE(excluded.client_id, training_jobs.client_id)`,
              // Backfill fields that were wrong in earlier syncs
              outputName: sql`COALESCE(NULLIF(excluded.output_name, ''), training_jobs.output_name)`,
              baseModel: sql`COALESCE(NULLIF(excluded.base_model, 'unknown'), training_jobs.base_model)`,
              totalSteps: sql`COALESCE(excluded.total_steps, training_jobs.total_steps)`,
              datasetName: sql`COALESCE(excluded.dataset_name, training_jobs.dataset_name)`,
              remoteJobName: sql`COALESCE(excluded.remote_job_name, training_jobs.remote_job_name)`,
              imageCount: sql`COALESCE(excluded.image_count, training_jobs.image_count)`,
            },
          })
        synced += rows.length
      }
      if (synced > 0) console.log(`[sync] lora jobs: ${synced} upserted (${ids.length} in Redis)`)
    } catch (e) {
      console.error('[sync] lora jobs error:', e instanceof Error ? e.message : e)
    }
  }

  // ── Helpers ───────────────────────────────────

  private async scanIds(key: string): Promise<string[]> {
    const r = this.redis()
    const allIds = new Set<string>()
    for (const set of ZSETS) {
      try {
        const members = await r.zrange(`${key}:${set}`, 0, -1)
        members.forEach((id) => allIds.add(id))
      } catch {}
    }
    for (const list of LISTS) {
      try {
        const members = await r.lrange(`${key}:${list}`, 0, -1)
        members.forEach((id) => allIds.add(id))
      } catch {}
    }
    return [...allIds]
  }
}

export const sync = new SyncService()
