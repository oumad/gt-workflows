import { ChevronRight } from 'lucide-react'
import { DrillRow } from '../../components/ui/DrillRow'
import { type SlowJob, errorCodeTone } from '../analytics/analyticsHelpers'
import { type Row, type UnifiedJob } from '../jobs/shared'

export const ROWS_PER_PAGE = 20

export type JobKindFilter = 'all' | 'wf' | 'lora'

export type SlowJobsPage = {
  items: SlowJob[]
  page: number
  totalPages: number
  total: number
}

/** Free-text search across a Row — case-insensitive substring on the columns
 *  the user can see (id / name / user / server / failed reason). */
export function rowMatchesQuery(r: Row, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    r.id.toLowerCase().includes(needle) ||
    r.rawId.toLowerCase().includes(needle) ||
    r.name.toLowerCase().includes(needle) ||
    (r.arch ?? '').toLowerCase().includes(needle) ||
    r.who.toLowerCase().includes(needle) ||
    (r.server ?? '').toLowerCase().includes(needle) ||
    (r.failedReason ?? '').toLowerCase().includes(needle)
  )
}

/** Adapter for the /api/analytics/slow-jobs endpoint, which returns snake_case
 *  rows. Converting through UnifiedJob lets us reuse `unifiedToRow` for the
 *  same wait/duration calculations the rest of the app uses. Defensive: every
 *  field falls back to a safe default so an older API deploy (missing status,
 *  started_at, etc.) doesn't crash the page. */
export function slowJobToUnified(s: SlowJob): UnifiedJob {
  return {
    type: s.type ?? 'wf',
    id: s.id,
    name: s.name ?? null,
    arch: null,
    serverId: s.server_id ?? null,
    serverUrl: s.server_url ?? null,
    clientId: s.client_id ?? null,
    userName: s.user_name ?? null,
    // status drives the status pill — fall back to 'completed' so the row
    // still renders even if the API forgot to include it.
    status: s.status ?? 'completed',
    durationMs: s.duration_ms ?? null,
    failedReason: s.failed_reason ?? null,
    createdAt: s.created_at,
    startedAt: s.started_at ?? null,
    finishedAt: s.finished_at ?? null,
    workflowId: null,
    comfyStartedAt: s.exec_at ?? null,
    waitMs: s.wait_ms ?? null,
    comfyQueueMs: null,
    comfyRunMs: null,
  }
}

export function ErrChip({ code }: { code: string }) {
  return (
    <span className={`chip chip-${errorCodeTone(code)}`} style={{ fontSize: 10, marginRight: 6 }}>
      {code}
    </span>
  )
}

/** Reusable "top N failures" card used by the Overview tab — Workflows, LoRAs,
 *  Services, Servers all render the same shape with different inputs. */
export function FailureList({
  title,
  rows,
  onShowAll,
}: {
  title: string
  rows: {
    label: string
    mono?: boolean
    fails: number
    total: number
    color: string
    onClick?: () => void
  }[]
  onShowAll?: () => void
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{title}</div>
        {onShowAll && (
          <>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={onShowAll}>
              Show all <ChevronRight size={12} />
            </button>
          </>
        )}
      </div>
      <div className="card-pad col" style={{ gap: 10 }}>
        {rows.length === 0 ? (
          <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>No failures.</span>
        ) : (
          rows.map((r) => {
            const rate = r.total > 0 ? (r.fails / r.total) * 100 : 0
            return (
              <DrillRow key={r.label} onClick={r.onClick}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 13 }} className={r.mono ? 'mono' : ''}>
                    {r.label}
                  </strong>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {r.fails} / {r.total}
                  </span>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  <div className="bar" style={{ flex: 1 }}>
                    <i style={{ width: `${Math.max(rate, 1)}%`, background: r.color }} />
                  </div>
                  <span className="mono" style={{ fontSize: 11 }}>
                    {rate.toFixed(1)}%
                  </span>
                </div>
              </DrillRow>
            )
          })
        )}
      </div>
    </div>
  )
}
