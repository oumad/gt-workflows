import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, Download, Filter, Search } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { SortableHeader } from '../../components/ui/SortableHeader'
import { Pagination } from '../../components/ui/Pagination'

const ROWS_PER_PAGE = 20
import {
  type AnalyticsData,
  type ErrorAgg,
  type UserAgg,
  type Range,
  ERROR_CODE_LABEL,
  ERROR_CODE_COLOR,
  errorCodeTone,
  fmtMs,
  fmtAgo,
  downloadCSV,
  rangeToDays,
} from '../analytics/analyticsHelpers'

export type ListKind = 'error' | 'workflow' | 'server' | 'user'
export type DrillTarget = {
  kind: ListKind
  id: string
  color?: string
  initials?: string
  label?: string
}

// User-facing singular/plural for each listKind. `server` reads as "service"
// in the UI even though the internal kind id stays `server`.
const KIND_NOUN: Record<ListKind, { singular: string; plural: string }> = {
  error: { singular: 'error', plural: 'errors' },
  workflow: { singular: 'workflow', plural: 'workflows' },
  server: { singular: 'service', plural: 'services' },
  user: { singular: 'user', plural: 'users' },
}

type Props = {
  listKind: ListKind
  range: Range
  analytics: AnalyticsData
  users: UserAgg[]
  errors: ErrorAgg[]
  excludeAborted: boolean
  onBack: () => void
  onDrill: (target: DrillTarget) => void
}

type ListRow = {
  key: string
  primary: string // first column display
  color: string
  total: number
  fails: number
  rate: number // 0–100
  // Optional fields, varies by kind
  meta?: string // e.g. server type, workflow category
  avgDur?: number | null
  topErr?: string | null // not always available
  last?: string | null
}

function rateChipClass(rate: number): string {
  if (rate >= 25) return 'chip-bad'
  if (rate >= 12) return 'chip-warn'
  if (rate >= 5) return 'chip'
  return 'chip-good'
}

function ErrChip({ code }: { code: string | null | undefined }) {
  if (!code || code === '—') return <span style={{ color: 'var(--ink-3)' }}>—</span>
  return (
    <span className={`chip chip-${errorCodeTone(code)}`} style={{ fontSize: 10 }}>
      {code}
    </span>
  )
}

const META: Record<
  ListKind,
  {
    title: string
    sub: string
    icon: string
    color: string
  }
> = {
  error: {
    title: 'All error types',
    sub: 'Every error code surfaced in this range',
    icon: '!',
    color: 'var(--bad)',
  },
  workflow: {
    title: 'All workflows · failures',
    sub: 'Failure profile for every workflow with traffic',
    icon: 'W',
    color: 'var(--accent)',
  },
  server: {
    title: 'All services · failures',
    sub: 'Failure profile for every cluster service',
    icon: 'S',
    color: 'var(--warn)',
  },
  user: {
    title: 'All users · failures',
    sub: 'Failure profile for every team member',
    icon: 'U',
    color: 'var(--accent)',
  },
}

/* ─── Component ──────────────────────────────────────────────────── */
export function DoctorList({
  listKind,
  range,
  analytics,
  users,
  errors,
  excludeAborted,
  onBack,
  onDrill,
}: Props) {
  const [sortKey, setSortKey] = useState<keyof ListRow>('fails')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const meta = META[listKind]

  /* Normalize into ListRow[] depending on kind */
  const rows: ListRow[] = useMemo(() => {
    if (listKind === 'error') {
      const total = errors.reduce((a, e) => a + e.count, 0)
      return (excludeAborted ? errors.filter((e) => e.code !== 'ABORTED') : errors).map((e) => ({
        key: e.code,
        primary: ERROR_CODE_LABEL[e.code] ?? e.code,
        color: ERROR_CODE_COLOR[e.code] ?? 'var(--ink-3)',
        total: total,
        fails: e.count,
        rate: total > 0 ? (e.count / total) * 100 : 0,
        meta: e.code,
        topErr: e.samples?.[0]?.slice(0, 60) ?? null,
        last: null,
      }))
    }
    if (listKind === 'workflow') {
      return analytics.byWorkflow.map((w) => {
        const rate = w.total > 0 ? (w.failed / w.total) * 100 : 0
        return {
          key: w.workflowName ?? '(unnamed)',
          primary: w.workflowName ?? '(unnamed)',
          color: 'var(--accent)',
          total: w.total,
          fails: w.failed,
          rate,
          avgDur: w.avgDurationMs,
        }
      })
    }
    if (listKind === 'server') {
      return analytics.byServer.map((s) => {
        const rate = s.total > 0 ? (s.failed / s.total) * 100 : 0
        return {
          key: s.server_id ?? s.server_name,
          primary: s.server_name,
          color: 'var(--info)',
          total: s.total,
          fails: s.failed,
          rate,
          avgDur: s.avg_duration_ms,
          meta: s.server_type ?? '—',
        }
      })
    }
    // user
    return users.map((u) => {
      const rate = u.total > 0 ? (u.failed / u.total) * 100 : 0
      return {
        key: u.user_id ?? u.user_name,
        primary: u.user_name,
        color: 'var(--accent)',
        total: u.total,
        fails: u.failed,
        rate,
        avgDur: u.avg_duration_ms,
        last: u.last_run_at,
      }
    })
  }, [listKind, analytics, users, errors, excludeAborted])

  /* Filter + sort */
  const filtered = rows.filter(
    (r) =>
      !query ||
      r.primary.toLowerCase().includes(query.toLowerCase()) ||
      (r.meta ?? '').toLowerCase().includes(query.toLowerCase()),
  )
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av
    }
    const cmp = String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  // Paginate the sorted list at ROWS_PER_PAGE / page. Sort or filter changes
  // dump the user back to page 1 — keeping them on page 5 of a list that
  // shrank to two pages would just show empty rows.
  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE))
  useEffect(() => {
    setPage(1)
  }, [query, sortKey, sortDir, listKind])
  const pageRows = sorted.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)

  const totalFails = rows.reduce((a, r) => a + r.fails, 0)
  const totalRuns = listKind === 'error' ? totalFails : rows.reduce((a, r) => a + r.total, 0)

  const onSort = (k: keyof ListRow) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const onExport = () => {
    downloadCSV(
      `doctor-${listKind}-${range}.csv`,
      ['name', 'fails', 'runs', 'rate %', 'avg duration (ms)'],
      sorted.map((r) => [r.primary, r.fails, r.total, r.rate.toFixed(1), r.avgDur ?? '']),
    )
  }

  const drillRow = (r: ListRow) =>
    onDrill({
      kind: listKind,
      id: r.key,
      color: r.color,
      label: r.primary,
    })

  return (
    <>
      <PageHead
        crumbs={['Brews', { label: 'Doctor', onClick: onBack }, meta.title]}
        title={meta.title}
        sub={meta.sub}
        actions={
          <>
            <button className="btn btn-sm" onClick={onBack}>
              <ChevronLeft size={14} /> Back to Doctor
            </button>
            <button className="btn btn-sm" onClick={onExport}>
              <Download size={14} /> Export
            </button>
          </>
        }
      />

      {/* Summary strip */}
      <div
        className="card card-pad row"
        style={{
          gap: 16,
          alignItems: 'center',
          borderRadius: 0,
          borderLeft: 0,
          borderRight: 0,
          borderTop: 0,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: meta.color,
            display: 'grid',
            placeItems: 'center',
            color: 'white',
            flexShrink: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          {meta.icon}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="chip">
              <strong className="mono">{rows.length}</strong>{' '}
              {rows.length === 1 ? KIND_NOUN[listKind].singular : KIND_NOUN[listKind].plural}
            </span>
            <span className="chip chip-bad">{totalFails} fails</span>
            {totalRuns > 0 && listKind !== 'error' && (
              <span className="chip">
                {totalRuns} runs · {((totalFails / Math.max(totalRuns, 1)) * 100).toFixed(1)}%
                overall
              </span>
            )}
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              · {rangeToDays(range) > 0 ? `last ${rangeToDays(range)} days` : 'all time'}
            </span>
          </div>
        </div>
        <div className="search-wrap" style={{ width: 220 }}>
          <span className="search-ico">
            <Search size={14} />
          </span>
          <input
            className="input search-input"
            style={{ width: '100%' }}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="body">
        <div className="card">
          <div className="card-head">
            <div className="card-title row" style={{ gap: 6 }}>
              <Filter size={12} /> Showing {pageRows.length} of {sorted.length}
              {sorted.length !== rows.length ? ` (filtered from ${rows.length})` : ''}
            </div>
            <span className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              Click any row to open details
            </span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                {listKind === 'error' && (
                  <>
                    <th style={{ width: 110 }}>Code</th>
                    <th>Error type</th>
                    <SortableHeader<keyof ListRow>
                      label="Count"
                      col="fails"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Share"
                      col="rate"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <th>Sample reason</th>
                  </>
                )}
                {listKind === 'workflow' && (
                  <>
                    <SortableHeader<keyof ListRow>
                      label="Workflow"
                      col="primary"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                    <SortableHeader<keyof ListRow>
                      label="Runs"
                      col="total"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Fails"
                      col="fails"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Rate"
                      col="rate"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Avg dur"
                      col="avgDur"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                  </>
                )}
                {listKind === 'server' && (
                  <>
                    <SortableHeader<keyof ListRow>
                      label="Service"
                      col="primary"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                    <th>Type</th>
                    <SortableHeader<keyof ListRow>
                      label="Jobs"
                      col="total"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Fails"
                      col="fails"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Rate"
                      col="rate"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Avg dur"
                      col="avgDur"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                  </>
                )}
                {listKind === 'user' && (
                  <>
                    <SortableHeader<keyof ListRow>
                      label="User"
                      col="primary"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                    <SortableHeader<keyof ListRow>
                      label="Runs"
                      col="total"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Fails"
                      col="fails"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Rate"
                      col="rate"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <SortableHeader<keyof ListRow>
                      label="Avg dur"
                      col="avgDur"
                      cur={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                      num
                    />
                    <th>Last run</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.key} onClick={() => drillRow(r)} style={{ cursor: 'pointer' }}>
                  {listKind === 'error' && (
                    <>
                      <td>
                        <ErrChip code={r.meta ?? r.key} />
                      </td>
                      <td>
                        <strong>{r.primary}</strong>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {r.fails}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <div className="bar" style={{ flex: 1, minWidth: 80 }}>
                            <i style={{ width: r.rate + '%', background: r.color }} />
                          </div>
                          <span className="mono" style={{ fontSize: 11 }}>
                            {r.rate.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td
                        style={{
                          fontSize: 12,
                          color: 'var(--ink-3)',
                          maxWidth: 280,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.topErr ?? '—'}
                      </td>
                    </>
                  )}
                  {listKind === 'workflow' && (
                    <>
                      <td>
                        <strong>{r.primary}</strong>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {r.total}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          color: r.fails > 0 ? 'var(--bad)' : 'var(--ink-3)',
                        }}
                      >
                        {r.fails}
                      </td>
                      <td>
                        <span className={`chip ${rateChipClass(r.rate)}`}>
                          {r.rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                        {fmtMs(r.avgDur)}
                      </td>
                    </>
                  )}
                  {listKind === 'server' && (
                    <>
                      <td>
                        <strong className="mono">{r.primary}</strong>
                      </td>
                      <td>
                        <span className="chip" style={{ fontSize: 10 }}>
                          {r.meta}
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {r.total}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          color: r.fails > 0 ? 'var(--bad)' : 'var(--ink-3)',
                        }}
                      >
                        {r.fails}
                      </td>
                      <td>
                        <span className={`chip ${rateChipClass(r.rate)}`}>
                          {r.rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                        {fmtMs(r.avgDur)}
                      </td>
                    </>
                  )}
                  {listKind === 'user' && (
                    <>
                      <td>
                        <strong>{r.primary}</strong>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {r.total}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: 'right',
                          color: r.fails > 0 ? 'var(--bad)' : 'var(--ink-3)',
                        }}
                      >
                        {r.fails}
                      </td>
                      <td>
                        <span className={`chip ${rateChipClass(r.rate)}`}>
                          {r.rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                        {fmtMs(r.avgDur)}
                      </td>
                      <td style={{ color: 'var(--ink-3)', fontSize: 12 }}>{fmtAgo(r.last)}</td>
                    </>
                  )}
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 32 }}
                  >
                    No {KIND_NOUN[listKind].plural} match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onChange={setPage}
            leftLabel={`${sorted.length.toLocaleString()} total`}
          />
        </div>
      </div>
    </>
  )
}
