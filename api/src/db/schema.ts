import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  date,
  time,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'

// ─────────────────────────────────────────────
// users — internal coffee-maker staff (local auth only)
// ─────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').unique().notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    roles: text('roles')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    passwordHash: text('password_hash'),
    // (Legacy api_key_hash / api_key_created_at columns removed once MCP
    // personal tokens replaced the single weekly-rotating key. Drop them at
    // the DB level with a manual `ALTER TABLE users DROP COLUMN ...` if
    // they still exist on an older deployment — drizzle-kit push will skip
    // them since the schema no longer mentions them.)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_username_idx').on(t.username)],
)

// ─────────────────────────────────────────────
// personal_tokens — long-lived per-user bearer tokens for programmatic access
// (replaces the single weekly-rotating `users.api_key_hash` column).
//
// Each token is hashed with SHA-256 (raw bytes shown once, never persisted).
// `prefix` is the first 12 chars of the raw key — useful for the UI ("revoke
// the cm_pat_a4f..."), indexed to make the auth lookup constant-time when
// combined with the hash check.
//
// Scopes are an open string array so we can add granular permissions later
// without a schema change. V1 understands only:
//   - 'full'   → inherits the owner's full role
//   - 'read'   → read-only access (everywhere requireCapability(read-*) is satisfied)
//   - 'mcp'    → reserved; today every token can hit /api/mcp
// Empty array = same as 'full'.
//
// `revokedAt` is non-null when the token has been revoked. We keep the row
// instead of deleting it so an audit log entry stamped with the prefix can be
// resolved back to a user months later.
// ─────────────────────────────────────────────
export const personalTokens = pgTable(
  'personal_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('personal_tokens_user_id_idx').on(t.userId),
    index('personal_tokens_prefix_idx').on(t.prefix),
    uniqueIndex('personal_tokens_hash_idx').on(t.hash),
  ],
)

// ─────────────────────────────────────────────
// gt_users — external end-users scraped from job data (gt-workflows)
// ─────────────────────────────────────────────
// Never log into coffee-maker; rows are upserted lazily on job ingest.
// externalId is the MongoDB ObjectId from gt-workflows user collection.
export const gtUsers = pgTable(
  'gt_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalId: text('external_id').unique().notNull(),
    email: text('email'),
    name: text('name'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    index('gt_users_email_idx').on(t.email),
    index('gt_users_external_id_idx').on(t.externalId),
  ],
)

// ─────────────────────────────────────────────
// servers
// ─────────────────────────────────────────────
export const servers = pgTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').unique().notNull(),
  tags: text('tags')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  color: text('color'),
  description: text('description'),
  type: text('type').notNull().default('workflow'),
  gpu: text('gpu'),
  lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
  lastPingOk: boolean('last_ping_ok'),
  lastPingMs: integer('last_ping_ms'),
  isMaintenance: boolean('is_maintenance').notNull().default(false),
  // Soft cap for the saturation heatmap: tiles colour by activeJobs / maxConcurrent.
  // null means the server hasn't been calibrated yet — the UI shows a neutral tile
  // and the operator can fill it in via the Settings tab.
  maxConcurrent: integer('max_concurrent'),
  downSince: timestamp('down_since', { withTimezone: true }),
  lastAlertAt: timestamp('last_alert_at', { withTimezone: true }),
  alertCount: integer('alert_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// workflows — minimal FK anchor; full config lives in params.json on disk
// ─────────────────────────────────────────────
export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(), // slug, e.g. 'image-edit-qwen'
  name: text('name').notNull(),
  path: text('path').unique().notNull(), // folder name in WORKFLOWS_DIR
  serverIds: text('server_ids')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─────────────────────────────────────────────
// workflow_jobs — BullMQ / ComfyUI job runs
// ─────────────────────────────────────────────
export const workflowJobs = pgTable(
  'workflow_jobs',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').references(() => workflows.id, { onDelete: 'set null' }),
    workflowName: text('workflow_name').notNull(),
    serverId: text('server_id').references(() => servers.id, { onDelete: 'set null' }),
    serverUrl: text('server_url').notNull(),
    clientId: uuid('client_id').references(() => gtUsers.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms').generatedAlwaysAs(
      sql`CASE
            WHEN processed_at IS NOT NULL AND finished_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - processed_at))::INTEGER * 1000
            ELSE NULL
          END`,
    ),
    failedReason: text('failed_reason'),
    data: jsonb('data'),
    // Populated by the live tracker: when ComfyUI actually started executing
    // (detected from the "Workflow is running on comfyui" BullMQ log line).
    // Null for historical jobs and jobs not yet tracked.
    comfyStartedAt: timestamp('comfy_started_at', { withTimezone: true }),
    // CM-owned audit log — events triggered FROM coffee-maker (manual stop,
    // future manual retry, etc). Distinct from gt-workflows' Redis log list
    // which we can't write to. Each entry is
    //   { at: ISO timestamp, who: string, action: string, message: string,
    //     extra?: Record<string, unknown> }
    // and the array is append-only. Stored on workflow_jobs because every
    // CM action targets a single job; cross-job actions would go elsewhere.
    cmAuditLog: jsonb('cm_audit_log')
      .notNull()
      .default(sql`'[]'::jsonb`),

    // Timing breakdown — generated columns (see migration 0005).
    // waitMs       = time in BullMQ wait list (created_at → processed_at)
    // comfyQueueMs = time picked up but ComfyUI hadn't started (processed_at → comfy_started_at)
    // comfyRunMs   = actual ComfyUI execution (comfy_started_at → finished_at)
    // True "wait time" = waitMs + comfyQueueMs.
    waitMs: bigint('wait_ms', { mode: 'number' }).generatedAlwaysAs(
      sql`CASE WHEN processed_at IS NOT NULL AND processed_at >= created_at
          THEN GREATEST(0, EXTRACT(EPOCH FROM (processed_at - created_at))::BIGINT * 1000)
          ELSE NULL END`,
    ),
    comfyQueueMs: bigint('comfy_queue_ms', { mode: 'number' }).generatedAlwaysAs(
      sql`CASE WHEN comfy_started_at IS NOT NULL AND processed_at IS NOT NULL
               AND comfy_started_at >= processed_at
          THEN GREATEST(0, EXTRACT(EPOCH FROM (comfy_started_at - processed_at))::BIGINT * 1000)
          ELSE NULL END`,
    ),
    comfyRunMs: bigint('comfy_run_ms', { mode: 'number' }).generatedAlwaysAs(
      sql`CASE WHEN finished_at IS NOT NULL AND comfy_started_at IS NOT NULL
               AND finished_at >= comfy_started_at
          THEN GREATEST(0, EXTRACT(EPOCH FROM (finished_at - comfy_started_at))::BIGINT * 1000)
          ELSE NULL END`,
    ),
  },
  (t) => [
    index('workflow_jobs_workflow_id_idx').on(t.workflowId),
    index('workflow_jobs_server_id_idx').on(t.serverId),
    index('workflow_jobs_client_id_idx').on(t.clientId),
    index('workflow_jobs_status_idx').on(t.status),
    // Functional indexes matching COALESCE(finished_at,'1970-01-01') ORDER BY — see migration 0004
  ],
)

// ─────────────────────────────────────────────
// training_jobs — AI-Toolkit / LoRA training runs
// ─────────────────────────────────────────────
export const trainingJobs = pgTable(
  'training_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    processId: text('process_id').unique().notNull(),

    outputName: text('output_name').notNull(),
    baseModel: text('base_model').notNull(),
    triggerWord: text('trigger_word'),
    loraType: text('lora_type'),
    totalSteps: integer('total_steps'),
    learningRate: text('learning_rate'),
    networkDim: integer('network_dim'),
    networkAlpha: text('network_alpha'),
    saveEveryNSteps: integer('save_every_n_steps'),

    datasetName: text('dataset_name'),
    imageCount: integer('image_count'),
    outputOptions: text('output_options'),

    serverId: text('server_id').references(() => servers.id, { onDelete: 'set null' }),
    serverUrl: text('server_url'),
    remoteJobName: text('remote_job_name'),
    sessionId: text('session_id'),

    clientId: uuid('client_id').references(() => gtUsers.id, { onDelete: 'set null' }),
    clientExternalId: text('client_external_id').notNull(),
    projectPath: text('project_path'),

    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms').generatedAlwaysAs(
      sql`CASE
            WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (finished_at - started_at))::INTEGER * 1000
            ELSE NULL
          END`,
    ),
    failedReason: text('failed_reason'),
    parameters: jsonb('parameters'),
  },
  (t) => [
    index('training_jobs_client_id_idx').on(t.clientId),
    index('training_jobs_client_external_id_idx').on(t.clientExternalId),
    index('training_jobs_status_idx').on(t.status),
    index('training_jobs_base_model_idx').on(t.baseModel),
    index('training_jobs_cursor_idx').on(t.createdAt, t.id),
  ],
)

// ─────────────────────────────────────────────
// calendar_events — user-created events (bookings / maintenance / releases /
// meetings). Workflow runs and LoRA training are derived on-read from
// workflow_jobs / training_jobs, so they don't live here.
// ─────────────────────────────────────────────
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    eventDate: date('event_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    owner: text('owner'),
    location: text('location'),
    servers: text('servers')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    notes: text('notes'),
    // Set once a "30 min before" Discord reminder has fired for this event, so
    // it's only sent once. Cleared when the event's date/start time changes.
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('calendar_events_date_idx').on(t.eventDate),
    index('calendar_events_category_idx').on(t.category),
  ],
)

// ─────────────────────────────────────────────
// alerts — persisted automated alerts. Currently the server-health events
// (down / recovered / still-down) that also fire the Discord webhook. Kept so
// the calendar can show a timeline of past incidents. server_name / server_url
// are denormalized so an alert survives the server row being deleted.
// ─────────────────────────────────────────────
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: text('kind').notNull(), // server_down | server_recovered | server_still_down
    severity: text('severity').notNull(), // critical | warning | info
    title: text('title').notNull(),
    body: text('body'),
    serverId: text('server_id').references(() => servers.id, { onDelete: 'set null' }),
    serverName: text('server_name'),
    serverUrl: text('server_url'),
    // Downtime in ms — set on server_recovered / server_still_down events
    // (null on server_down). Drives MTTR / total-downtime analytics.
    downtimeMs: bigint('downtime_ms', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('alerts_created_at_idx').on(t.createdAt),
    index('alerts_server_id_idx').on(t.serverId),
  ],
)

// ─────────────────────────────────────────────
// credentials — Domain/user/password tuples that can be attached to one or
// more servers (RDP / Ansible / SSH / …). The password is stored encrypted
// at rest with AES-256-GCM; see api/src/lib/crypto.ts for the envelope.
// Admin-only — never returned to the client.
// ─────────────────────────────────────────────
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    domain: text('domain').notNull().default(''),
    username: text('username').notNull(),
    // Format: "v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>" — produced by
    // lib/crypto.ts:encrypt(). Decrypt only when the password is actually
    // needed (e.g. relayed to Ansible); never include it in API responses.
    passwordEnc: text('password_enc'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('credentials_name_idx').on(t.name)],
)

// Many-to-many: one credential can apply to many servers, and a server can
// have multiple credentials (RDP, Ansible, etc.). Both sides cascade on delete
// so removing either end auto-cleans the junction rows.
// createdAt records when the link was made (useful audit data); no updatedAt
// because junction rows are not mutated — they are inserted or deleted.
export const credentialServers = pgTable(
  'credential_servers',
  {
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.credentialId, t.serverId] }),
    index('credential_servers_server_idx').on(t.serverId),
  ],
)

// ─────────────────────────────────────────────
// seto_config — singleton thresholds for the "Ask Seto" assistant.
// One row, id='singleton', containing every configurable limit. The check
// endpoint reads it before evaluating; the admin page writes it. Defaults
// match the spec: 3 jobs / 10-minute wait / 100 ms latency / 2 services.
// ─────────────────────────────────────────────
export const setoConfig = pgTable('seto_config', {
  id: text('id').primaryKey(), // always 'singleton'
  maxUserJobs: integer('max_user_jobs').notNull().default(3),
  maxServiceJobs: integer('max_service_jobs').notNull().default(3),
  maxServerJobs: integer('max_server_jobs').notNull().default(3),
  maxWaitTimeSec: integer('max_wait_time_sec').notNull().default(600),
  maxLinkedWf: integer('max_linked_wf').notNull().default(3),
  maxServerLatencyMs: integer('max_server_latency_ms').notNull().default(100),
  maxServerServices: integer('max_server_services').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ─────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  personalTokens: many(personalTokens),
}))

export const personalTokensRelations = relations(personalTokens, ({ one }) => ({
  user: one(users, { fields: [personalTokens.userId], references: [users.id] }),
}))

export const gtUsersRelations = relations(gtUsers, ({ many }) => ({
  workflowJobs: many(workflowJobs),
  trainingJobs: many(trainingJobs),
}))

export const serversRelations = relations(servers, ({ many }) => ({
  workflowJobs: many(workflowJobs),
  trainingJobs: many(trainingJobs),
}))

export const workflowsRelations = relations(workflows, ({ many }) => ({
  workflowJobs: many(workflowJobs),
}))

export const workflowJobsRelations = relations(workflowJobs, ({ one }) => ({
  workflow: one(workflows, { fields: [workflowJobs.workflowId], references: [workflows.id] }),
  server: one(servers, { fields: [workflowJobs.serverId], references: [servers.id] }),
  client: one(gtUsers, { fields: [workflowJobs.clientId], references: [gtUsers.id] }),
}))

export const trainingJobsRelations = relations(trainingJobs, ({ one }) => ({
  server: one(servers, { fields: [trainingJobs.serverId], references: [servers.id] }),
  client: one(gtUsers, { fields: [trainingJobs.clientId], references: [gtUsers.id] }),
}))

// ─────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type GtUser = typeof gtUsers.$inferSelect
export type NewGtUser = typeof gtUsers.$inferInsert
export type Server = typeof servers.$inferSelect
export type NewServer = typeof servers.$inferInsert
export type Workflow = typeof workflows.$inferSelect
export type NewWorkflow = typeof workflows.$inferInsert
export type WorkflowJob = typeof workflowJobs.$inferSelect
export type NewWorkflowJob = typeof workflowJobs.$inferInsert
export type TrainingJob = typeof trainingJobs.$inferSelect
export type NewTrainingJob = typeof trainingJobs.$inferInsert
export type Alert = typeof alerts.$inferSelect
export type NewAlert = typeof alerts.$inferInsert
export type Credential = typeof credentials.$inferSelect
export type NewCredential = typeof credentials.$inferInsert
export type SetoConfig = typeof setoConfig.$inferSelect
export type NewSetoConfig = typeof setoConfig.$inferInsert
export type PersonalToken = typeof personalTokens.$inferSelect
export type NewPersonalToken = typeof personalTokens.$inferInsert
