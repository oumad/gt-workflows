import { useState, useEffect, useMemo } from 'react'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { api } from '../../../lib/api'
import { Pagination } from '../../../components/ui/Pagination'
import { type SlowJob } from '../../analytics/analyticsHelpers'
import { SlowJobsTable, unifiedToRow, type Row } from '../../jobs/shared'
import {
  ROWS_PER_PAGE,
  rowMatchesQuery,
  slowJobToUnified,
  type JobKindFilter,
  type SlowJobsPage,
} from '../doctorHelpers'
import { FilterToolbar } from './FilterToolbar'

export function DoctorSlowTab({
  days,
  kindFilter,
  onKindFilter,
  query,
  onQuery,
  onJobClick,
}: {
  days: number
  kindFilter: JobKindFilter
  onKindFilter: (k: JobKindFilter) => void
  query: string
  onQuery: (q: string) => void
  onJobClick: (r: Row) => void
}) {
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<SlowJob[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)

  // Slow-jobs server-side filtering is range-only (kind + query are still
  // applied client-side here, since the endpoint is bespoke and doesn't
  // accept those filters yet). Reset to page 1 when range changes; keep the
  // current page when kind/query change client-side.
  useEffect(() => {
    setPage(1)
  }, [days])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      limit: String(ROWS_PER_PAGE),
    })
    if (days > 0) params.set('days', String(days))
    api
      .get<SlowJobsPage>(`/api/analytics/slow-jobs?${params}`)
      .then((res) => {
        setItems(res.items ?? [])
        setTotal(res.total)
        setTotalPages(res.totalPages)
        if (res.page !== page) setPage(res.page)
      })
      .catch(() => {
        setItems([])
        setTotal(0)
        setTotalPages(1)
      })
      .finally(() => setLoading(false))
  }, [page, days])

  // Client-side kind + query filter on the page's slice. Server doesn't yet
  // know about these, so a 20-row page may shrink after filtering. (The
  // pagination total still reflects the server's pre-filter count.)
  const qApplied = useDebouncedValue(query.trim())

  const rows = useMemo(() => {
    const now = Date.now()
    const all = items.map((s) => unifiedToRow(slowJobToUnified(s), now))
    return all
      .filter((r) => kindFilter === 'all' || r.kind === kindFilter)
      .filter((r) => rowMatchesQuery(r, qApplied))
  }, [items, kindFilter, qApplied])

  const wfCount = rows.filter((r) => r.kind === 'wf').length
  const loraCount = rows.filter((r) => r.kind === 'lora').length

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="card-title">Slow jobs</div>
        <span className="chip chip-warn">{total.toLocaleString()}</span>
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
        <span>wait &gt; 30s or duration &gt; timeout · sortable · {ROWS_PER_PAGE} per page</span>
      </div>
      {rows.length === 0 ? (
        <div
          className="card-pad"
          style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 32 }}
        >
          {loading
            ? 'Loading…'
            : qApplied || kindFilter !== 'all'
              ? 'No slow jobs match the current filters.'
              : 'No slow jobs in this range.'}
        </div>
      ) : (
        <SlowJobsTable rows={rows} onSelect={onJobClick} />
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
