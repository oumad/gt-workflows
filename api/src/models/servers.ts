/**
 * Wire-format types for the servers + ComfyUI proxy endpoints.
 * The base `Server` row type comes from drizzle's schema inference;
 * everything here is the enriched/derived data layered on top for the UI.
 */
import type { Server, Workflow } from '../db/schema.js'

export type HealthStatus = 'unknown' | 'offline' | 'online' | 'comfy-down'

export interface ServerHealth {
  status: HealthStatus
  latencyMs: number | null
  lastPingAt: string
  comfyOk: boolean | null
}

export interface ServerWithCounts extends Server {
  health: ServerHealth | null
  activeJobs: number
  waitingJobs: number
}

export interface ServerWithWorkflows extends Server {
  health: ServerHealth | null
  workflows: Workflow[]
}

export interface ServerInsight {
  serverId: string
  serverName: string
  totalJobs: number
  avgSec: number
  failPct: number
  successPct: number
}

export interface IncidentAggServer {
  serverId: string | null
  serverName: string
  incidents: number
  recoveries: number
  totalDowntimeMs: number
  mttrMs: number | null
  lastAlertAt: string | null
}

export interface IncidentRow {
  id: string
  kind: string
  severity: string
  title: string
  body: string | null
  serverId: string | null
  serverName: string | null
  downtimeMs: number | null
  createdAt: string
}

export interface IncidentsResponse {
  rangeDays: number | null
  servers: IncidentAggServer[]
  recent: IncidentRow[]
}

export interface RepartitionWorkflow {
  workflowId: string | null
  workflowName: string
  jobs: number
  users: number
  avgSec: number
}

export interface RepartitionServer {
  serverId: string
  totalJobs: number
  distinctUsers: number
  avgSec: number
  avgWaitSec: number
  workflows: RepartitionWorkflow[]
}

export interface RepartitionResponse {
  rangeDays: 30
  servers: RepartitionServer[]
}

export type ServerJobsResponse =
  | { type: 'workflow'; active: unknown[]; waiting: unknown[] }
  | { type: 'lora'; active: unknown[]; waiting: unknown[] }

export interface ServerStats24h {
  total: number
  completed: number
  failed: number
  avgWaitMs: number | null
}

export interface ScrapeResult {
  servers: number
  services: number
  created: number
  found: number
  names: string[]
}

/** ComfyUI /system_stats proxied through. We keep the shape flexible because
 *  the UI just renders devices[] / system{} — anything new from ComfyUI
 *  passes through untouched. */
export type ComfyStatsResponse = {
  devices?: { name?: string }[]
  [k: string]: unknown
}

export interface ComfyLogsResponse {
  source: 'logs' | 'history'
  limit: number
  data: unknown
}
