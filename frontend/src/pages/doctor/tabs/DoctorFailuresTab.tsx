import { useState, useEffect, useMemo } from 'react'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { api } from '../../../lib/api'
import { Pagination } from '../../../components/ui/Pagination'
import { ERROR_CODE_COLOR, ERROR_CODE_LABEL } from '../../analytics/analyticsHelpers'
import {
  FailedJobsTable,
  unifiedToRow,
  type Row,
  type UnifiedJob,
  type UnifiedJobsPage,
} from '../../jobs/shared'
import { type DrillTarget } from '../DoctorList'
import { ROWS_PER_PAGE, type JobKindFilter } from '../doctorHelpers'
import { FilterToolbar } from './FilterToolbar'

export function DoctorFailuresTab({
  days,
  excludeAborted,
  kindFilter,
  onKindFilter,
  query,
  onQuery,
  onDrill,
  onJobClick,
}: {
  days: number
  excludeAborted: boolean
  kindFilter: JobKindFilter
  onKindFilter: (k: JobKindFilter) => void
  query: string
  onQuery: (q: string) => void
  onDrill: (t: DrillTarget) => void
  onJobClick: (r: Row) => void
}) {
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<UnifiedJob[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  // Debounce the search so we don't fire a fetch on every keystroke.
  const qApplied = useDebouncedValue(query.trim())

  // Whenever any of the filters change, jump back to page 1 — leaving the
  // user on page 5 of a filter that now has only 2 pages would just dump
  // them into an empty list. The fetch effect picks the reset up via `page`.
  useEffect(() => {
    setPage(1)
  }, [days, excludeAborted, kindFilter, qApplied])

  // Paginated fetch — server filters by range, kind, query, and aborted-vs-not
  // so the page size is honest (we don't render less than 20 because of a
  // client-side filter dropping aborted rows from the page).
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status: 'failed',
      page: String(page),
      limit: String(ROWS_PER_PAGE),
    })
    if (days > 0) params.set('days', String(days))
    if (excludeAborted) params.set('excludeAborted', '1')
    if (kindFilter !== 'all') params.set('type', kindFilter)
    if (qApplied) params.set('q', qApplied)
    api
      .get<UnifiedJobsPage>(`/api/jobs?${params}`)
      .then((res) => {
        setItems(res.items ?? [])
        setTotal(res.total)
        setTotalPages(res.totalPages)
        if (res.page !== page) setPage(res.page) // server clamped past-end
      })
      .catch(() => {
        setItems([])
        setTotal(0)
        setTotalPages(1)
      })
      .finally(() => setLoading(false))
  }, [page, days, excludeAborted, kindFilter, qApplied])

  const rows = useMemo(() => {
    const now = Date.now()
    return items.map((j) => unifiedToRow(j, now))
  }, [items])

  const wfCount = rows.filter((r) => r.kind === 'wf').length
  const loraCount = rows.filter((r) => r.kind === 'lora').length

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="card-title">Failed jobs</div>
        <span className="chip chip-bad">{total.toLocaleString()}</span>
        <span className="chip">
          {wfCount} WF · {loraCount} LoRA on this page
        </span>
        <span className="spacer" />
        <FilterToolbar
          kindFilter={kindFilter}
          onKindFilter={onKindFilter}
          query={query}
          onQuery={onQuery}
        />
      </div>
      <div
        className="row"
        style={{
          padding: '6px 14px',
          borderBottom: '1px solid var(--line)',
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span>Click a row to view logs and stacktrace · {ROWS_PER_PAGE} per page</span>
      </div>
      {rows.length === 0 ? (
        <div
          className="card-pad"
          style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 32 }}
        >
          {loading
            ? 'Loading…'
            : qApplied || kindFilter !== 'all'
              ? 'No failures match the current filters.'
              : 'No failures in this range.'}
        </div>
      ) : (
        <FailedJobsTable
          rows={rows}
          onSelect={onJobClick}
          onErrClick={(code) =>
            onDrill({
              kind: 'error',
              id: code,
              color: ERROR_CODE_COLOR[code],
              label: ERROR_CODE_LABEL[code],
            })
          }
        />
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        onChange={setPage}
        disabled={loading}
        leftLabel={`${total.toLocaleString()} total`}
      />
    </div>
  )
}
