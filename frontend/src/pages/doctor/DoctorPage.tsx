import { useState, useEffect } from 'react'
import { Filter, Download } from 'lucide-react'
import { RangeSelector } from '../../components/ui/RangeSelector'
import { useTabWithUrl } from '../../hooks/useTabWithUrl'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { api } from '../../lib/api'
import {
  type Range,
  type AnalyticsData,
  type UserAgg,
  type ErrorAgg,
  rangeToDays,
  classifyError,
  downloadCSV,
} from '../analytics/analyticsHelpers'
import { DoctorList, type ListKind, type DrillTarget } from './DoctorList'
import { DoctorDetail } from './DoctorDetail'
import { JobModal, unifiedToRow, type Row, type UnifiedJobsPage } from '../jobs/shared'
import { type JobKindFilter, type SlowJobsPage } from './doctorHelpers'
import { DoctorOverview } from './tabs/DoctorOverview'
import { DoctorFailuresTab } from './tabs/DoctorFailuresTab'
import { DoctorSlowTab } from './tabs/DoctorSlowTab'
import { DoctorErrorsTab } from './tabs/DoctorErrorsTab'

/**
 * Doctor — diagnose failures and slow jobs across workflows and LoRA training.
 *
 * Page shell owns:
 *  - the range + excludeAborted toolbar (applies to every tab)
 *  - the shared analytics fetch (used by Overview + the totalFails pill)
 *  - tab switching + sub-page routing (DoctorList for "Show all", DoctorDetail
 *    for drilldowns). kindFilter/query are kept here so they survive a tab
 *    switch between Failures and Slow.
 *
 * Per-tab components live under ./tabs/, helpers under ./doctorHelpers.tsx.
 */
export function DoctorPage() {
  const [tab, setTab] = useTabWithUrl('overview', ['overview', 'failures', 'errors', 'slow'])
  const [range, setRange] = useState<Range>('7d')
  const [excludeAborted, setExcludeAborted] = useState(true)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [users, setUsers] = useState<UserAgg[]>([])
  const [errors, setErrors] = useState<ErrorAgg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [list, setList] = useState<ListKind | null>(null)
  const [detail, setDetail] = useState<DrillTarget | null>(null)
  const [openJob, setOpenJob] = useState<Row | null>(null)
  // Shared across Failures + Slow tabs so the user's filter survives a tab
  // switch — same UX as the Jobs page. Each tab fetches its own paginated
  // data from the server so the cap-at-200/300 problem from before is gone.
  const [kindFilter, setKindFilter] = useState<JobKindFilter>('all')
  const [query, setQuery] = useState('')

  const days = rangeToDays(range)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<AnalyticsData>(`/api/analytics?days=${days}`),
      api.get<UserAgg[]>(`/api/analytics/by-user?days=${days}`),
      api.get<ErrorAgg[]>(`/api/analytics/by-error?days=${days}`),
    ])
      .then(([a, u, e]) => {
        setAnalytics(a)
        setUsers(u)
        setErrors(e)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [days])

  // Total failure count, used as the Failures tab pill — comes straight from
  // the analytics aggregate so it reflects the current range regardless of
  // which page of the failures list the user is on.
  const totalFails = analytics ? analytics.workflows.failed + analytics.training.failed : 0

  /* ── Sub-page: drilldown detail ────────────────────────────── */
  if (detail && analytics) {
    return (
      <DoctorDetail
        target={detail}
        range={range}
        excludeAborted={excludeAborted}
        onBack={() => setDetail(null)}
        onDrill={(t) => setDetail(t)}
        onShowList={(k) => {
          setDetail(null)
          setList(k)
        }}
      />
    )
  }

  /* ── Sub-page: full list for a kind ─────────────────────────── */
  if (list && analytics) {
    return (
      <DoctorList
        listKind={list}
        range={range}
        analytics={analytics}
        users={users}
        errors={errors}
        excludeAborted={excludeAborted}
        onBack={() => setList(null)}
        onDrill={(t) => {
          setList(null)
          setDetail(t)
        }}
      />
    )
  }

  /* ── Main page ──────────────────────────────────────────────── */
  // Export pulls a single large page of matching failures (up to the API's
  // MAX_LIMIT) on demand — the visible Failures tab is paginated at 20, but
  // a CSV export naturally wants the whole set, not just the visible page.
  // Pulls slow jobs from the same endpoint the Slow tab uses. Columns mirror
  // the failures CSV minus error_code/reason (slow jobs usually completed).
  const onExportSlowJobs = async () => {
    try {
      const params = new URLSearchParams({ limit: '200', page: '1' })
      if (days > 0) params.set('days', String(days))
      const res = await api.get<SlowJobsPage>(`/api/analytics/slow-jobs?${params}`)
      const toSec = (ms: number | null) => (ms != null ? Math.round(ms / 1000) : '')
      downloadCSV(
        `slow-jobs-${range}.csv`,
        ['type', 'id', 'name', 'duration_s', 'wait_s', 'status', 'user', 'server', 'finished_at'],
        (res.items ?? []).map((s) => [
          s.type,
          s.id,
          s.name ?? '',
          toSec(s.duration_ms),
          toSec(s.wait_ms),
          s.status,
          s.user_name ?? '',
          s.server_name ?? '',
          s.finished_at ?? s.created_at,
        ]),
      )
    } catch {
      /* swallow */
    }
  }

  const onExportFailures = async () => {
    try {
      const params = new URLSearchParams({
        status: 'failed',
        limit: '200', // matches /api/jobs MAX_LIMIT — enough for most exports
        page: '1',
      })
      if (days > 0) params.set('days', String(days))
      if (excludeAborted) params.set('excludeAborted', '1')
      if (kindFilter !== 'all') params.set('type', kindFilter)
      if (query.trim()) params.set('q', query.trim())
      const res = await api.get<UnifiedJobsPage>(`/api/jobs?${params}`)
      const now = Date.now()
      const rows = (res.items ?? []).map((j) => unifiedToRow(j, now))
      downloadCSV(
        `failures-${range}.csv`,
        [
          'type',
          'id',
          'name',
          'error_code',
          'reason',
          'duration_s',
          'wait_s',
          'user',
          'server',
          'failed_at',
        ],
        rows.map((r) => [
          r.kind,
          r.rawId,
          r.name,
          classifyError(r.failedReason),
          (r.failedReason ?? '').slice(0, 200),
          r.totalSec ?? '',
          r.waitTimeSec ?? '',
          r.who,
          r.server ?? '',
          r.finishedAt ?? r.createdAt,
        ]),
      )
    } catch {
      /* swallow — export failure isn't worth a notification toast here */
    }
  }

  return (
    <>
      <PageHead
        crumbs={['Brews', 'Doctor']}
        title="Doctor"
        sub="Diagnose failures and slow jobs across workflows and LoRA training"
        actions={
          <>
            <button
              className={`btn btn-sm ${excludeAborted ? 'btn-primary' : ''}`}
              onClick={() => setExcludeAborted((v) => !v)}
              title={
                excludeAborted
                  ? 'Aborted jobs are hidden.\n\nAborted = jobs the user cancelled before they finished (status: aborted / cancelled). These are not real failures, so they’re excluded from counts, error breakdowns, and the failures list. Click to include them.'
                  : 'Aborted jobs are included.\n\nAborted = jobs the user cancelled before they finished. They are mixed in with real failures right now, which can inflate failure rates. Click to hide them.'
              }
            >
              <Filter size={14} /> {excludeAborted ? 'Aborted hidden' : 'Include aborted'}
            </button>
            <RangeSelector range={range} onChange={setRange} />
            {/* Export button is tab-aware. Overview is a dashboard (multiple
                tables — no single CSV makes sense); Errors has its own export
                in the tab. So we only surface this button on Failures + Slow. */}
            {tab === 'failures' && (
              <button className="btn btn-sm" onClick={onExportFailures}>
                <Download size={14} /> Export failures
              </button>
            )}
            {tab === 'slow' && (
              <button className="btn btn-sm" onClick={onExportSlowJobs}>
                <Download size={14} /> Export slow jobs
              </button>
            )}
          </>
        }
      />
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          // The Failures pill is the analytics-derived total for the current
          // range — not the visible page size — so it stays correct as the
          // user pages through. Slow jobs has no analytics counterpart, so
          // its tab is unannotated (the count lives inside the tab itself).
          { id: 'failures', label: 'Failures', pill: loading ? undefined : totalFails },
          { id: 'errors', label: 'Errors', pill: loading ? undefined : errors.length },
          { id: 'slow', label: 'Slow jobs' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="body">
        {loading ? (
          <div style={{ color: 'var(--ink-3)', padding: 32, textAlign: 'center' }}>Loading…</div>
        ) : error ? (
          <div style={{ color: 'var(--bad)', padding: 32, textAlign: 'center' }}>{error}</div>
        ) : !analytics ? null : (
          <>
            {tab === 'overview' && (
              <DoctorOverview
                analytics={analytics}
                users={users}
                errors={errors}
                excludeAborted={excludeAborted}
                range={range}
                totalFails={totalFails}
                onShowAll={(k) => setList(k)}
                onDrill={(t) => setDetail(t)}
              />
            )}
            {tab === 'failures' && (
              <DoctorFailuresTab
                days={days}
                excludeAborted={excludeAborted}
                kindFilter={kindFilter}
                onKindFilter={setKindFilter}
                query={query}
                onQuery={setQuery}
                onDrill={(t) => setDetail(t)}
                onJobClick={(r) => setOpenJob(r)}
              />
            )}
            {tab === 'errors' && (
              <DoctorErrorsTab
                errors={errors}
                excludeAborted={excludeAborted}
                range={range}
                onDrill={(t) => setDetail(t)}
              />
            )}
            {tab === 'slow' && (
              <DoctorSlowTab
                days={days}
                kindFilter={kindFilter}
                onKindFilter={setKindFilter}
                query={query}
                onQuery={setQuery}
                onJobClick={(r) => setOpenJob(r)}
              />
            )}
          </>
        )}
      </div>

      {openJob && <JobModal row={openJob} onClose={() => setOpenJob(null)} />}
    </>
  )
}
