import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { api, isAbortError } from '../../lib/api'
import { useData } from '../../context/DataContext'
import { RefreshCw, Download, Search, X, Filter, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type UnifiedJobsPage,
  type Row,
  unifiedToRow,
  fmtSec,
  fmtCompleted,
  JobModal,
  StatusPill,
  SlowChip,
  slowLevel,
  JobKindBadge,
} from './shared'
import { JobRowMenu } from './JobsTables'
import { ExpandingToggle } from '../../components/ui/ExpandingToggle'
import { RangeSelector } from '../../components/ui/RangeSelector'
import { SortableHeader } from '../../components/ui/SortableHeader'
import { KIND_OPTIONS, REFRESH_OPTIONS } from './JobsLiveFeed'
import { type Range, rangeToDays } from '../analytics/analyticsHelpers'
import { loadPrefs } from '../preferences/PreferencesPage'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void

/* ─── History ────────────────────────────────────────────────────── */

// Status options exposed in the History toolbar. 'completed' / 'failed' use
// the same literal string on both tables, so no kind-specific mapping needed.
const HIST_STATUSES = [
  { id: 'all', label: 'All status' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
]

const PAGE_LIMIT = 20

type HistSortKey = 'name' | 'who' | 'server' | 'totalSec' | 'waitTimeSec' | 'completedAt' | 'status'

/** A cell-click filter. `uuid` is the underlying DB UUID applicable to whichever
 *  field was clicked (gt_users.id for 'who', servers.id for 'server',
 *  workflows.id for 'name' on WF rows). When absent we fall back to a q-search. */
type HistFocus = { kind: 'name' | 'who' | 'server'; value: string; uuid?: string }

/* Row context menu lives in ./JobsTables as JobRowMenu — shared with the
 * live tables; passes setoKind='history-job' here. */

/** A locked-in filter that the component always honors. Used when embedding
 *  History inside a workflow / user / server detail page — the consumer
 *  wants the full functionality (search, sort, pagination, refresh, kind /
 *  status filters, modal, etc.) scoped to a specific entity. The dimension is
 *  still surfaced to the user as a fixed badge, but can't be cleared. */
export type HistoryLock =
  | { kind: 'workflow'; id: string; label?: string }
  | { kind: 'user'; id: string; label?: string }
  | { kind: 'server'; id: string; label?: string }

/** Row background tint for the history table. Failed jobs get a subtle red
 *  wash; slow / very-slow runs a subtle orange one (a touch stronger for
 *  very-slow) so defective rows stand out at a glance. Otherwise the usual
 *  per-kind tint (LoRA vs workflow). */
function historyRowBg(r: Row, avgSec: number | undefined): string {
  if (r.statusTone === 'bad') return 'color-mix(in oklab, var(--bad) 4%, transparent)'
  const { level } = slowLevel(r, avgSec)
  if (level === 'very') return 'color-mix(in oklab, var(--warn) 7%, transparent)'
  if (level === 'slow') return 'color-mix(in oklab, var(--warn) 4%, transparent)'
  return r.kind === 'lora'
    ? 'color-mix(in oklab, var(--accent) 5%, transparent)'
    : 'color-mix(in oklab, var(--pop-purple) 3%, transparent)'
}

export function History({
  navigate,
  lock,
  jobKind,
}: {
  navigate?: NavigateFn
  /** When provided, the corresponding query param is always sent and the
   *  matching column's focus filter is disabled. */
  lock?: HistoryLock
  /** Hard-locks the wf/lora filter to a single job type and hides the kind
   *  toggle — used by the user-detail Workflows / LoRAs tabs. */
  jobKind?: 'wf' | 'lora'
} = {}) {
  const [kind, setKind] = useState<'all' | 'wf' | 'lora'>(
    // jobKind hard-locks the filter; otherwise a workflow lock implies WF rows.
    jobKind ?? (lock?.kind === 'workflow' ? 'wf' : 'all'),
  )
  const [status, setStatus] = useState('all')
  // Default 'all' preserves prior History behaviour (no days filter sent). The
  // selector lets users narrow to 24h/7d/30d when they only care about recent
  // activity — matches the same control on Doctor + Analytics.
  const [range, setRange] = useState<Range>('all')
  // Seed the search box from `?q=` on the URL, but only when running as the
  // standalone Jobs page (no lock). Lets deep links from elsewhere — e.g. the
  // Calendar's "Open run" button — land here pre-filtered.
  const initialQ = (() => {
    if (lock) return ''
    try {
      return new URLSearchParams(window.location.search).get('q') ?? ''
    } catch {
      return ''
    }
  })()
  const [query, setQuery] = useState(initialQ) // controlled input
  const qApplied = useDebouncedValue(query.trim()) // debounced value sent to API
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [openRow, setOpenRow] = useState<Row | null>(null)
  const [refresh, setRefresh] = useState<'off' | '5' | '30' | '60'>('off')
  const [sortKey, setSortKey] = useState<HistSortKey | null>(null) // server orders by finishedAt desc
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [focus, setFocus] = useState<HistFocus | null>(null)
  // Cached server-side for 5 minutes — used inline to flag slow runs against
  // each workflow's historical average. Empty {} until the request lands so
  // missing entries simply skip rendering the chip.
  const [avgDurations, setAvgDurations] = useState<Record<string, number>>({})
  // avgDurations comes from /api/wf-jobs/avg-duration — keyed by WORKFLOW name.
  // Only apply it to WF rows; a LoRA whose output name happens to match a
  // workflow name must not be judged against that unrelated workflow average.
  const wfAvg = (r: Row): number | undefined => (r.kind === 'wf' ? avgDurations[r.name] : undefined)
  // "Mine" toggle uses the linked GT user from Preferences. Skipped when a
  // user lock is already active — the lock takes precedence over Mine.
  const prefs = loadPrefs()
  const myId = prefs.myGtUserId
  const [mineOnly, setMineOnly] = useState(false)
  // Refetch when the initial Redis->Postgres sync completes (first-ever boot)
  // so history fills in without a manual refresh.
  const { firstSyncDone } = useData()

  useEffect(() => {
    api
      .get<Record<string, number>>('/api/wf-jobs/avg-duration')
      .then(setAvgDurations)
      .catch(() => {})
  }, [])

  // Track the in-flight request so a fast typist can't have a stale response
  // overwrite their latest one. We abort the previous controller before firing
  // a new request; the catch below silently swallows the resulting AbortError.
  const inflightRef = useRef<AbortController | null>(null)
  const load = useCallback(
    async (
      p: number,
      k: 'all' | 'wf' | 'lora',
      s: string,
      f: HistFocus | null,
      qStr: string,
      r: Range,
      mine: boolean,
    ) => {
      inflightRef.current?.abort()
      const ctrl = new AbortController()
      inflightRef.current = ctrl
      setLoading(true)
      try {
        const now = Date.now()
        // When focus has no UUID we send its value as `q` so the filter is
        // server-side instead of narrowing the current page. User-typed query
        // takes precedence when both are present.
        const focusFallbackQ = f && !f.uuid ? f.value : ''
        const effectiveQ = qStr || focusFallbackQ
        const days = rangeToDays(r)

        const params = new URLSearchParams({
          page: String(p),
          limit: String(PAGE_LIMIT),
        })
        if (k !== 'all') params.set('type', k)
        if (s !== 'all') params.set('status', s)
        if (days > 0) params.set('days', String(days))
        if (effectiveQ) params.set('q', effectiveQ)
        if (f?.kind === 'who' && f.uuid) params.set('userId', f.uuid)
        if (f?.kind === 'server' && f.uuid) params.set('serverId', f.uuid)
        if (f?.kind === 'name' && f.uuid) params.set('workflowId', f.uuid)
        // "Mine" overrides any other userId scope. Honored only when not
        // already locked to a user (lock wins). When a focus already targets
        // a different user, Mine still wins — clicking the toggle is an
        // explicit intent to narrow to self.
        if (mine && myId && lock?.kind !== 'user') params.set('userId', myId)
        // Locked filter — always sent, overrides any user-set focus on the same dimension.
        if (lock?.kind === 'workflow') {
          params.set('workflowId', lock.id)
          // Also pass the human-readable label as workflowName — jobs whose
          // BullMQ producer used the workflow's display name (or path) as the
          // job name, and whose workflow_id wasn't backfilled yet, would
          // otherwise be invisible. Backend OR-matches both.
          if (lock.label && lock.label !== lock.id) params.set('workflowName', lock.label)
        }
        if (lock?.kind === 'user') params.set('userId', lock.id)
        if (lock?.kind === 'server') params.set('serverId', lock.id)

        const res = await api.get<UnifiedJobsPage>(`/api/jobs?${params}`, { signal: ctrl.signal })
        // If a newer request superseded us, drop the result rather than overwriting.
        if (inflightRef.current !== ctrl) return
        setRows((res.items ?? []).map((j) => unifiedToRow(j, now)))
        setPage(res.page)
        setTotalPages(res.totalPages)
        setTotal(res.total)
      } catch (e) {
        if (!isAbortError(e)) console.error(e)
      } finally {
        if (inflightRef.current === ctrl) {
          setLoading(false)
          inflightRef.current = null
        }
      }
    },
    [lock, myId],
  )

  // Abort any in-flight request on unmount.
  useEffect(
    () => () => {
      inflightRef.current?.abort()
    },
    [],
  )

  // Initial load + reload on filter changes. Focus is reset on kind/status
  // changes because changing the scope often invalidates the focused cell.
  useEffect(() => {
    setFocus(null)
    load(1, kind, status, null, qApplied, range, mineOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status, qApplied, load])

  useEffect(() => {
    if (refresh === 'off') return
    const ms = Number(refresh) * 1000
    const id = setInterval(() => {
      load(page, kind, status, focus, qApplied, range, mineOnly)
    }, ms)
    return () => clearInterval(id)
    // range/mineOnly included so the auto-refresh interval never reloads
    // with stale filter values captured by an old closure.
  }, [refresh, page, kind, status, focus, qApplied, range, mineOnly, load])

  const goNext = () => {
    if (page < totalPages) load(page + 1, kind, status, focus, qApplied, range, mineOnly)
  }
  const goPrev = () => {
    if (page > 1) load(page - 1, kind, status, focus, qApplied, range, mineOnly)
  }
  const goPage = (p: number) => {
    if (p !== page && p >= 1 && p <= totalPages)
      load(p, kind, status, focus, qApplied, range, mineOnly)
  }

  const toggleSort = (sk: HistSortKey) => {
    if (sortKey === sk) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(sk)
      setSortDir('asc')
    }
  }

  /** Click a cell value to filter. Extracts the shared UUID from the raw row
   *  so the API can filter server-side; falls back to q-search when absent. */
  const toggleFocus = (fKind: HistFocus['kind'], value: string, r: Row) => {
    if (!value || value === '—') return
    if (focus?.kind === fKind && focus?.value === value) {
      setFocus(null)
      load(1, kind, status, null, qApplied, range, mineOnly)
      return
    }
    // The raw row carries the type-specific shape projected by unifiedToRow.
    // gt_users.id and servers.id are shared across both tables — same UUID
    // applies whether the click came from a WF or LoRA row. workflows.id only
    // exists on WF rows.
    const raw = r.raw as {
      clientId?: string | null
      serverId?: string | null
      workflowId?: string | null
      client?: { id?: string | null } | null
    }
    const uuid =
      fKind === 'who'
        ? (raw.clientId ?? raw.client?.id ?? undefined)
        : fKind === 'server'
          ? (raw.serverId ?? undefined)
          : fKind === 'name'
            ? r.kind === 'wf'
              ? (raw.workflowId ?? undefined)
              : undefined
            : undefined

    const newFocus: HistFocus = { kind: fKind, value, uuid: uuid ?? undefined }
    setFocus(newFocus)
    load(1, kind, status, newFocus, qApplied, range, mineOnly)
  }

  // Reload on range / mine-toggle change. Resets to page 1 because narrowing a
  // range or filtering to self can shrink the result set and the user would
  // otherwise land on an empty page.
  useEffect(() => {
    load(1, kind, status, focus, qApplied, range, mineOnly)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, mineOnly, firstSyncDone])

  const displayed = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'who':
          cmp = a.who.localeCompare(b.who)
          break
        case 'server':
          cmp = (a.server ?? '').localeCompare(b.server ?? '')
          break
        case 'totalSec':
          cmp = (a.totalSec ?? -1) - (b.totalSec ?? -1)
          break
        case 'waitTimeSec':
          cmp = (a.waitTimeSec ?? -1) - (b.waitTimeSec ?? -1)
          break
        case 'completedAt':
          cmp = (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0)
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
        default:
          cmp = 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const exportCsv = () => {
    const header = 'Type,Job ID,Name,User,Service,Total time,Wait time,Completed,Status'
    const body = displayed
      .map((r) =>
        [
          r.kind,
          r.id,
          r.name,
          r.who,
          r.server ?? '',
          fmtSec(r.totalSec),
          fmtSec(r.waitTimeSec),
          fmtCompleted(r.completedAt),
          r.statusLabel,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'jobs.csv'
    a.click()
  }

  return (
    <>
      {/* Toolbar. nowrap + a shrinkable search field: when the Auto toggle
       * expands on hover, the elastic spacer (then the search) absorbs the
       * growth — nothing wraps or jumps to a second line. */}
      <div className="row" style={{ marginBottom: 12, gap: 10, flexWrap: 'nowrap' }}>
        <div className="search" style={{ minWidth: 140, flex: '0 1 240px', position: 'relative' }}>
          <span className="search-icon">
            <Search size={14} />
          </span>
          <input
            className="input"
            placeholder="Search id, name, user, service…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={query ? { paddingRight: 28 } : undefined}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              title="Clear search"
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 0,
                padding: 4,
                color: 'var(--ink-3)',
                display: 'flex',
                cursor: 'pointer',
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!jobKind && <ExpandingToggle options={KIND_OPTIONS} value={kind} onChange={setKind} />}
        <ExpandingToggle
          options={HIST_STATUSES.map((s) => ({ value: s.id, label: s.label }))}
          value={status}
          onChange={setStatus}
        />
        <RangeSelector range={range} onChange={setRange} />
        {myId && !lock && (
          <button
            className={`btn btn-sm ${mineOnly ? 'btn-primary' : ''}`}
            onClick={() => setMineOnly((v) => !v)}
            title={
              mineOnly
                ? `Showing only ${prefs.myGtUserLabel ?? 'your'}'s runs — click to clear.`
                : `Filter to ${prefs.myGtUserLabel ?? 'your'}'s runs.`
            }
          >
            {mineOnly ? 'Mine only' : 'Mine'}
          </button>
        )}
        <ExpandingToggle
          options={REFRESH_OPTIONS}
          value={refresh}
          onChange={setRefresh}
          prefix={
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                padding: '0 6px 0 4px',
                fontWeight: 600,
              }}
            >
              <RefreshCw
                size={11}
                className={loading && refresh !== 'off' ? 'spin' : ''}
                style={{ marginRight: 4, verticalAlign: 'middle' }}
              />
              Auto
            </span>
          }
        />
        <span className="spacer" />
        <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {total.toLocaleString()} total · page {page} of {totalPages}
        </span>
        <button className="btn btn-sm" onClick={exportCsv} style={{ flexShrink: 0 }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Focus filter banner */}
      {focus && (
        <div
          className="row"
          style={{
            marginBottom: 12,
            gap: 8,
            padding: '7px 12px',
            background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
            border: '1px solid color-mix(in oklab, var(--accent) 30%, transparent)',
            borderRadius: 8,
          }}
        >
          <Filter size={12} />
          <span style={{ fontSize: 12 }}>
            Filtered by{' '}
            <strong>
              {focus.kind === 'who' ? 'User' : focus.kind === 'server' ? 'Service' : 'Workflow'}
            </strong>
            :&nbsp;
            <span className="mono">{focus.value}</span>
          </span>
          <span className="spacer" />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setFocus(null)
              load(1, kind, status, null, qApplied, range, mineOnly)
            }}
          >
            <X size={12} /> Clear
          </button>
        </div>
      )}

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Type</th>
              <th style={{ width: 100 }}>Job ID</th>
              <SortableHeader<HistSortKey>
                label="Name"
                col="name"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortableHeader<HistSortKey>
                label="User"
                col="who"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                style={{ width: 130 }}
              />
              <SortableHeader<HistSortKey>
                label="Service"
                col="server"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                style={{ width: 110 }}
              />
              <SortableHeader<HistSortKey>
                label="Total"
                col="totalSec"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                style={{ width: 90 }}
              />
              <SortableHeader<HistSortKey>
                label="Wait time"
                col="waitTimeSec"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                style={{ width: 100 }}
              />
              <SortableHeader<HistSortKey>
                label="Completed"
                col="completedAt"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                style={{ width: 155 }}
              />
              <SortableHeader<HistSortKey>
                label="Status"
                col="status"
                cur={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                style={{ width: 115 }}
              />
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {displayed.map((r) => (
              <tr
                key={r.key}
                style={{ background: historyRowBg(r, wfAvg(r)), cursor: 'pointer' }}
                onClick={() => setOpenRow(r)}
              >
                <td>
                  <JobKindBadge kind={r.kind} />
                </td>
                <td>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    {r.id}
                  </span>
                </td>
                {/* Name — full td click opens modal; only the text itself
                    filters. The slow / very-slow chip sits at the right edge of
                    this wider column where it has room to render cleanly. */}
                <td>
                  <div
                    className="row"
                    style={{ gap: 6, justifyContent: 'space-between', alignItems: 'baseline' }}
                  >
                    <span className="row" style={{ gap: 6, alignItems: 'baseline', minWidth: 0 }}>
                      <strong
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFocus('name', r.name, r)
                        }}
                        title="Filter by workflow"
                      >
                        {r.name}
                      </strong>
                      {r.arch && (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                          · {r.arch}
                        </span>
                      )}
                    </span>
                    <SlowChip row={r} avgSec={wfAvg(r)} />
                  </div>
                </td>
                {/* User */}
                <td style={{ color: r.who === '—' ? 'var(--ink-3)' : undefined }}>
                  {r.who !== '—' ? (
                    <span
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFocus('who', r.who, r)
                      }}
                      title="Filter by user"
                    >
                      {r.who}
                    </span>
                  ) : (
                    r.who
                  )}
                </td>
                {/* Server */}
                <td className="mono" style={{ color: !r.server ? 'var(--ink-3)' : undefined }}>
                  {r.server ? (
                    <span
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFocus('server', r.server!, r)
                      }}
                      title="Filter by service"
                    >
                      {r.server}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="mono">{fmtSec(r.totalSec)}</td>
                <td className="mono">{fmtSec(r.waitTimeSec)}</td>
                <td style={{ color: 'var(--ink-2)', fontSize: 12 }}>
                  {fmtCompleted(r.completedAt)}
                </td>
                <td>
                  <StatusPill tone={r.statusTone}>{r.statusLabel}</StatusPill>
                </td>
                <JobRowMenu r={r} navigate={navigate} setoKind="history-job" />
              </tr>
            ))}
            {displayed.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={10}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}
                >
                  {query || focus ? 'No jobs match the current filters.' : 'No jobs found.'}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={10}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}
                >
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div
          className="row"
          style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', gap: 8 }}
        >
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Page {page} of {totalPages}
          </span>
          {sortKey && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSortKey(null)}
              style={{ fontSize: 11 }}
            >
              <X size={11} /> Clear sort
            </button>
          )}
          <span className="spacer" />
          <button
            className="btn btn-sm"
            onClick={() => goPage(1)}
            disabled={page <= 1 || loading}
            title="First page"
          >
            ««
          </button>
          <button className="btn btn-sm" onClick={goPrev} disabled={page <= 1 || loading}>
            <ChevronLeft size={14} /> Prev
          </button>
          <button className="btn btn-sm" onClick={goNext} disabled={page >= totalPages || loading}>
            Next <ChevronRight size={14} />
          </button>
          <button
            className="btn btn-sm"
            onClick={() => goPage(totalPages)}
            disabled={page >= totalPages || loading}
            title="Last page"
          >
            »»
          </button>
        </div>
      </div>

      {openRow && <JobModal row={openRow} onClose={() => setOpenRow(null)} />}
    </>
  )
}
