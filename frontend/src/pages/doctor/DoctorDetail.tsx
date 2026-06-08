import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, Download, AlertCircle } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { api } from '../../lib/api'
import {
  type Range,
  rangeToDays,
  rangeLabel,
  dayAxisFor,
  ERROR_CODE_LABEL,
  ERROR_CODE_COLOR,
  errorCodeTone,
  fmtMs,
  fmtAgo,
  fmtDate,
  downloadCSV,
} from '../analytics/analyticsHelpers'
import { JobModal, type Row } from '../jobs/shared'
import { Kpi } from '../../components/ui/Kpi'
import type { ListKind, DrillTarget } from './DoctorList'

/* ─── Response shapes from /api/analytics/entity ─────────────────── */
type EntityKpis = {
  runs: number
  fails: number
  completed: number
  avg_dur: number | null
  avg_fail_dur: number | null
  last_fail_at: string | null
}
type TrendRow = { date: string; runs: number; fails: number }
type CodeRow = { code: string; count: number }
type EntityListRow = { fails: number; runs: number } & Record<string, string | number | null>
type RecentRow = {
  type: 'wf' | 'lora'
  id: string
  name: string | null
  err_code: string
  failed_reason: string | null
  duration_ms: number | null
  server_name: string | null
  user_name: string | null
  created_at: string
  finished_at: string | null
}
type EntityResponse = {
  kind: ListKind
  id: string
  range: { days: number }
  kpis: EntityKpis | null
  trend: TrendRow[]
  byError: CodeRow[]
  byServer: Array<{ server_name: string } & EntityListRow>
  byUser: Array<{ user_name: string } & EntityListRow>
  byWorkflow: Array<{ name: string } & EntityListRow>
  recent: RecentRow[]
}

type Props = {
  target: DrillTarget
  range: Range
  excludeAborted: boolean
  onBack: () => void
  onDrill: (target: DrillTarget) => void
  onShowList: (kind: ListKind) => void
}

const KIND_LABEL: Record<ListKind, string> = {
  error: 'Error type',
  workflow: 'Workflow',
  server: 'Service',
  user: 'User',
}

const KIND_LABEL_PLURAL: Record<ListKind, string> = {
  error: 'Error types',
  workflow: 'Workflows',
  server: 'Services',
  user: 'Users',
}

function ErrChip({ code }: { code: string }) {
  return (
    <span className={`chip chip-${errorCodeTone(code)}`} style={{ fontSize: 10, marginRight: 6 }}>
      {code}
    </span>
  )
}

/* ─── Component ──────────────────────────────────────────────────── */
export function DoctorDetail({
  target,
  range: initialRange,
  excludeAborted,
  onBack,
  onDrill,
  onShowList,
}: Props) {
  // Detail has its own local range — initialized from the parent's selection
  // but free to change independently. Lets the user zoom in/out within a
  // single drilldown without affecting the overview.
  const [range, setRange] = useState<Range>(initialRange)
  const days = rangeToDays(range)

  const [data, setData] = useState<EntityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openJob, setOpenJob] = useState<Row | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = `/api/analytics/entity?kind=${encodeURIComponent(target.kind)}&id=${encodeURIComponent(target.id)}&days=${days}`
    api
      .get<EntityResponse>(url)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [target.kind, target.id, days])

  const { dates, labels } = useMemo(
    () =>
      dayAxisFor(
        days,
        (data?.trend ?? []).map((r) => r.date),
      ),
    [days, data?.trend],
  )
  const trendByDate = useMemo(() => {
    const m = new Map<string, TrendRow>()
    data?.trend.forEach((r) => m.set(r.date.slice(0, 10), r))
    return m
  }, [data?.trend])
  const trendBars = dates.map((d) => trendByDate.get(d) ?? { date: d, runs: 0, fails: 0 })
  const maxBar = Math.max(...trendBars.map((d) => d.runs), 1)

  const kpis = data?.kpis ?? null
  const failRate = kpis && kpis.runs > 0 ? (kpis.fails / kpis.runs) * 100 : 0
  const lastFail = kpis?.last_fail_at ?? null

  const title = target.label ?? target.id
  const color = target.color ?? 'var(--accent)'

  const recentShown = (data?.recent ?? []).filter(
    (r) => !excludeAborted || r.err_code !== 'ABORTED',
  )

  const onExport = () => {
    if (!data) return
    downloadCSV(
      `doctor-${target.kind}-${target.id}-${range}.csv`,
      ['type', 'id', 'name', 'err_code', 'reason', 'duration_ms', 'server', 'user', 'finished_at'],
      (data.recent ?? []).map((r) => [
        r.type,
        r.id,
        r.name ?? '',
        r.err_code,
        (r.failed_reason ?? '').slice(0, 200),
        r.duration_ms ?? '',
        r.server_name ?? '',
        r.user_name ?? '',
        r.finished_at ?? r.created_at,
      ]),
    )
  }

  return (
    <>
      <PageHead
        crumbs={[
          'Brews',
          { label: 'Doctor', onClick: onBack },
          { label: KIND_LABEL_PLURAL[target.kind], onClick: () => onShowList(target.kind) },
          title,
        ]}
        title={title}
        sub={`${KIND_LABEL[target.kind]} · ${days > 0 ? `last ${days} days` : 'all time'}`}
        actions={
          <>
            <button className="btn btn-sm" onClick={onBack}>
              <ChevronLeft size={14} /> Back
            </button>
            <div className="toggle-group">
              <button className={range === '24h' ? 'active' : ''} onClick={() => setRange('24h')}>
                24h
              </button>
              <button className={range === '7d' ? 'active' : ''} onClick={() => setRange('7d')}>
                7d
              </button>
              <button className={range === '30d' ? 'active' : ''} onClick={() => setRange('30d')}>
                30d
              </button>
              <button className={range === 'all' ? 'active' : ''} onClick={() => setRange('all')}>
                All
              </button>
            </div>
            <button className="btn btn-sm" onClick={onExport}>
              <Download size={14} /> Export
            </button>
          </>
        }
      />

      {/* Identity bar */}
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
            width: 56,
            height: 56,
            borderRadius: 12,
            background: color,
            display: 'grid',
            placeItems: 'center',
            color: 'white',
            flexShrink: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 20,
          }}
        >
          {target.initials ?? title.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: 'var(--ink-3)',
            }}
          >
            {KIND_LABEL[target.kind]}
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
            {target.kind === 'error' && (ERROR_CODE_LABEL[target.id] ?? 'No description')}
            {target.kind === 'workflow' && 'Workflow / pipeline'}
            {target.kind === 'server' && 'Cluster service'}
            {target.kind === 'user' && 'External user (gt-workflows)'}
          </div>
        </div>
        {kpis && (
          <>
            <span
              className={`chip ${failRate > 20 ? 'chip-bad' : failRate > 10 ? 'chip-warn' : 'chip'}`}
              style={{ fontSize: 12 }}
            >
              {failRate.toFixed(1)}% fail rate
            </span>
            <span className="chip" style={{ fontSize: 12 }}>
              last failure · {fmtAgo(lastFail)}
            </span>
          </>
        )}
      </div>

      <div className="body">
        {loading ? (
          <div style={{ color: 'var(--ink-3)', padding: 32, textAlign: 'center' }}>Loading…</div>
        ) : error ? (
          <div style={{ color: 'var(--bad)', padding: 32, textAlign: 'center' }}>
            <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </div>
        ) : !data || !kpis ? (
          <div style={{ color: 'var(--ink-3)', padding: 32, textAlign: 'center' }}>No data.</div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid-4" style={{ marginBottom: 16 }}>
              <Kpi
                label={`Failures · ${rangeLabel(range)}`}
                value={kpis.fails.toLocaleString()}
                valueColor={kpis.fails > 0 ? 'var(--bad)' : 'var(--good)'}
              />
              <Kpi
                label={`Runs · ${rangeLabel(range)}`}
                value={kpis.runs.toLocaleString()}
                chip={`${kpis.completed} succeeded`}
              />
              <Kpi
                label="Avg duration"
                value={fmtMs(kpis.avg_dur)}
                valueMono
                chip="across all runs"
              />
              <Kpi
                label="Avg time-to-fail"
                value={fmtMs(kpis.avg_fail_dur)}
                valueMono
                chip="failed runs only"
                chipTone="bad"
              />
            </div>

            {/* Trend */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head">
                <div className="card-title">Daily runs & failures</div>
                <span className="chip">{days > 0 ? `${days} days` : 'all time'}</span>
              </div>
              <div className="card-pad">
                <div style={{ display: 'flex', gap: 3, height: 100, alignItems: 'flex-end' }}>
                  {trendBars.map((d, i) => {
                    const okH = (d.runs / maxBar) * 100
                    const failH = (d.fails / maxBar) * 100
                    return (
                      <div
                        key={i}
                        title={`${fmtDate(d.date)} · ${d.runs} runs, ${d.fails} failed`}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          height: '100%',
                        }}
                      >
                        <div
                          style={{
                            height: failH + '%',
                            background: 'var(--bad)',
                            borderRadius: '3px 3px 0 0',
                            minHeight: d.fails > 0 ? 3 : 0,
                          }}
                        />
                        <div
                          style={{
                            height: Math.max(okH - failH, 0) + '%',
                            background: color,
                            opacity: 0.7,
                            minHeight: d.runs > d.fails ? 2 : 0,
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
                <div
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: 'var(--ink-3)',
                    marginTop: 8,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <span>{labels[0]}</span>
                  <span>{labels[Math.floor(labels.length / 2)]}</span>
                  <span>today</span>
                </div>
                <div className="row" style={{ gap: 12, marginTop: 8 }}>
                  <Legend color={color} label="Runs" opacity={0.7} />
                  <Legend color="var(--bad)" label="Failures" />
                </div>
              </div>
            </div>

            {/* Breakdowns: three columns of related entities */}
            <div className="grid-3" style={{ marginBottom: 14 }}>
              {/* Card 1: byError (always) — for error kind shows co-occurring codes */}
              <BreakdownCard
                title={target.kind === 'error' ? 'Co-occurring error codes' : 'Top error types'}
                rows={data.byError
                  .filter((e) => !excludeAborted || e.code !== 'ABORTED')
                  .map((e) => ({
                    label: ERROR_CODE_LABEL[e.code] ?? e.code,
                    sub: e.code,
                    count: e.count,
                    color: ERROR_CODE_COLOR[e.code] ?? 'var(--ink-3)',
                    onClick: () =>
                      onDrill({
                        kind: 'error',
                        id: e.code,
                        color: ERROR_CODE_COLOR[e.code],
                        label: ERROR_CODE_LABEL[e.code],
                      }),
                  }))}
              />

              {/* Card 2: byWorkflow OR byServer depending on kind */}
              {target.kind === 'server' || target.kind === 'user' || target.kind === 'error' ? (
                <BreakdownCard
                  title={
                    target.kind === 'server'
                      ? 'Workflows on this service'
                      : target.kind === 'user'
                        ? 'Workflows this user runs'
                        : 'Workflows hitting this error'
                  }
                  rows={data.byWorkflow.map((w) => ({
                    label: w.name,
                    count: w.fails,
                    runs: w.runs,
                    color: 'var(--accent)',
                    onClick: () =>
                      onDrill({ kind: 'workflow', id: w.name, color: 'var(--accent)' }),
                  }))}
                />
              ) : (
                <BreakdownCard
                  title="Services running this workflow"
                  rows={data.byServer.map((s) => ({
                    label: s.server_name,
                    mono: true,
                    count: s.fails,
                    runs: s.runs,
                    color: 'var(--info)',
                    onClick: () =>
                      onDrill({ kind: 'server', id: s.server_name, color: 'var(--info)' }),
                  }))}
                />
              )}

              {/* Card 3: byUser OR byServer */}
              {target.kind === 'user' ? (
                <BreakdownCard
                  title="Services this user has used"
                  rows={data.byServer.map((s) => ({
                    label: s.server_name,
                    mono: true,
                    count: s.fails,
                    runs: s.runs,
                    color: 'var(--info)',
                    onClick: () =>
                      onDrill({ kind: 'server', id: s.server_name, color: 'var(--info)' }),
                  }))}
                />
              ) : (
                <BreakdownCard
                  title={
                    target.kind === 'server'
                      ? 'Users with jobs on this service'
                      : target.kind === 'workflow'
                        ? 'Users running this workflow'
                        : 'Users hitting this error'
                  }
                  rows={data.byUser.map((u) => ({
                    label: u.user_name,
                    avatar: u.user_name,
                    count: u.fails,
                    runs: u.runs,
                    color: 'var(--accent)',
                    onClick: () => {
                      const initials = u.user_name
                        .split(/\s+/)
                        .map((x) => x[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()
                      onDrill({ kind: 'user', id: u.user_name, color: 'var(--accent)', initials })
                    },
                  }))}
                />
              )}
            </div>

            {/* Recent failures */}
            <div className="card">
              <div className="card-head">
                <div className="card-title">Recent failures</div>
                <span className="chip chip-bad">{recentShown.length}</span>
              </div>
              {recentShown.length === 0 ? (
                <div className="card-pad" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No failures in the selected range.
                </div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Name</th>
                      <th>Error</th>
                      <th>Service</th>
                      <th>User</th>
                      <th>Ran for</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentShown.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => setOpenJob(recentToRow(r))}
                        style={{ cursor: 'pointer' }}
                        title="View logs"
                      >
                        <td className="mono">{r.id.slice(0, 10)}</td>
                        <td>
                          <strong>{r.name ?? '—'}</strong>
                        </td>
                        <td>
                          <ErrChip code={r.err_code} />
                          <span style={{ fontSize: 12.5 }}>
                            {(r.failed_reason ?? '').slice(0, 80)}
                          </span>
                        </td>
                        <td className="mono">{r.server_name ?? '—'}</td>
                        <td>{r.user_name ?? '—'}</td>
                        <td className="mono">{fmtMs(r.duration_ms)}</td>
                        <td style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                          {fmtAgo(r.finished_at ?? r.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {openJob && <JobModal row={openJob} onClose={() => setOpenJob(null)} />}
    </>
  )
}

/* ─── RecentRow → Row adapter (just enough for JobModal display) ─── */
function recentToRow(r: RecentRow): Row {
  const isWf = r.type === 'wf'
  const statusLabel = r.err_code === 'ABORTED' ? 'Aborted' : 'Failed'
  const statusTone = r.err_code === 'ABORTED' ? 'muted' : 'bad'
  // Build a stub raw payload — JobModal fetches the full detail by id anyway.
  // We just need to satisfy the type so the header strip can render.
  const rawStub = {
    id: r.id,
    status: 'failed',
    failedReason: r.failed_reason,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    serverUrl: r.server_name,
    serverId: null,
    clientId: null,
  } as unknown as Row['raw']
  return {
    kind: isWf ? 'wf' : 'lora',
    key: `${r.type}:${r.id}`,
    id: r.id.slice(0, 10),
    rawId: r.id,
    name: r.name ?? '(unnamed)',
    arch: null,
    who: r.user_name ?? '—',
    server: r.server_name ?? null,
    status: 'failed',
    statusLabel,
    statusTone,
    elapsedSec: null,
    timeoutSec: isWf ? 600 : 7200,
    waitingSec: null,
    startedLabel: null,
    totalSec: r.duration_ms != null ? Math.floor(r.duration_ms / 1000) : null,
    genSec: null,
    waitTimeSec: null,
    completedAt: r.finished_at ? new Date(r.finished_at) : null,
    createdAt: r.created_at,
    processedAt: null,
    execAt: null,
    finishedAt: r.finished_at,
    failedReason: r.failed_reason,
    raw: rawStub,
    phase: null,
    clientId: null,
    serverId: null,
  }
}

/* ─── Helpers ────────────────────────────────────────────────────── */
function BreakdownCard({
  title,
  rows,
}: {
  title: string
  rows: Array<{
    label: string
    sub?: string
    mono?: boolean
    avatar?: string
    count: number
    runs?: number
    color: string
    onClick?: () => void
  }>
}) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title" style={{ fontSize: 13 }}>
          {title}
        </div>
        <span className="chip">{rows.length}</span>
      </div>
      <div className="card-pad col" style={{ gap: 10 }}>
        {rows.length === 0 ? (
          <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>No data.</span>
        ) : (
          rows.map((r) => {
            const initials = r.avatar
              ? r.avatar
                  .split(/\s+/)
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '?'
              : null
            return (
              <div
                key={r.label}
                onClick={r.onClick}
                style={{
                  cursor: r.onClick ? 'pointer' : 'default',
                  borderRadius: 8,
                  padding: '6px 8px',
                  margin: '-6px -8px',
                }}
                onMouseEnter={(e) => {
                  if (r.onClick)
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <div className="row" style={{ gap: 10 }}>
                  {initials != null && (
                    <div className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                      {initials}
                    </div>
                  )}
                  {!initials && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: r.color,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className={r.mono ? 'mono' : ''}
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.label}
                    </div>
                    {r.sub && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                        {r.sub}
                      </div>
                    )}
                    <div className="bar" style={{ marginTop: 4 }}>
                      <i style={{ width: (r.count / max) * 100 + '%', background: r.color }} />
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      textAlign: 'right',
                      minWidth: 60,
                    }}
                  >
                    {r.count}
                    {r.runs != null ? ` / ${r.runs}` : ''}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function Legend({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
  return (
    <span className="row" style={{ gap: 4, fontSize: 11, color: 'var(--ink-3)' }}>
      <span
        style={{
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
          display: 'inline-block',
          opacity,
        }}
      />
      {label}
    </span>
  )
}
