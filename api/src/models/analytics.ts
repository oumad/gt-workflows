/**
 * Wire-format types for analytics endpoints.
 *
 * Most aggregation rows are passed through from drizzle's `db.execute` and
 * keep their snake_case column names — the frontend already expects them
 * that way. The `/api/analytics` headline endpoint has a more structured
 * shape, captured here.
 */

export interface DailyTotals {
  date: string
  total: number
  completed: number
  failed: number
  other: number
}

export interface WorkflowAgg {
  workflowName: string | null
  total: number
  completed: number
  failed: number
  successRate: number
  avgDurationMs: number | null
}

export interface LoraAgg {
  baseModel: string | null
  total: number
  completed: number
  failed: number
  successRate: number
  avgDurationMs: number | null
}

export interface AnalyticsMain {
  range: { days: number }
  workflows: {
    total: number
    completed: number
    failed: number
    active: number
    waiting: number
    avgDurationMs: number | null
    totalDurationMs: number | null
  }
  training: {
    total: number
    completed: number
    failed: number
    running: number
    pending: number
    avgDurationMs: number | null
    totalDurationMs: number | null
  }
  daily: unknown[]
  byWorkflow: WorkflowAgg[]
  byLora: LoraAgg[]
  byServer: unknown[]
  byHour: unknown[]
}

export interface DurationBucket {
  label: string
  count: number
}

export interface SlowJobsResponse {
  items: Array<Record<string, unknown>>
  page: number
  totalPages: number
  total: number
}

export interface EntityResponse {
  kind: string
  id: string
  range: { days: number }
  kpis: Record<string, unknown> | null
  trend: unknown[]
  byError: unknown[]
  byServer: unknown[]
  byUser: unknown[]
  byWorkflow: unknown[]
  recent: unknown[]
}
