import { ChevronRight } from 'lucide-react'
import { Kpi } from '../../../components/ui/Kpi'
import { DrillRow } from '../../../components/ui/DrillRow'
import { useServers } from '../../../hooks/useServers'
import { hostnameOf } from '../../../lib/serverLinks'
import {
  type Range,
  type AnalyticsData,
  type UserAgg,
  type ErrorAgg,
  rangeToDays,
  rangeLabel,
  colorForName,
  ERROR_CODE_LABEL,
  ERROR_CODE_COLOR,
  fmtDate,
} from '../../analytics/analyticsHelpers'
import { type ListKind, type DrillTarget } from '../DoctorList'
import { ErrChip, FailureList } from '../doctorHelpers'

export function DoctorOverview({
  analytics,
  users,
  errors,
  excludeAborted,
  range,
  totalFails,
  onShowAll,
  onDrill,
}: {
  analytics: AnalyticsData
  users: UserAgg[]
  errors: ErrorAgg[]
  excludeAborted: boolean
  range: Range
  totalFails: number
  onShowAll: (k: ListKind) => void
  onDrill: (t: DrillTarget) => void
}) {
  // The Doctor's byServer rows are service-level (one entry per registered
  // Server record). To get a host-level view, we group those rows by hostname,
  // looking up each row's URL in the live servers list. A row whose server
  // isn't (yet) registered falls back to its server_name as the bucket key.
  const { servers } = useServers()
  const days = rangeToDays(range)
  const rLabel = rangeLabel(range)
  // days=0 (All time) → use the entire daily array as-returned.
  const recent = days > 0 ? analytics.daily.slice(-days) : analytics.daily
  const totalRuns = recent.reduce((n, d) => n + d.total, 0)
  const totalFailed = recent.reduce((n, d) => n + d.failed, 0)
  const failRate = totalRuns > 0 ? (totalFailed / totalRuns) * 100 : 0
  const maxFail = Math.max(...recent.map((d) => d.failed), 1)

  // For the overview list we exclude OTHER/UNKNOWN — they're noise here.
  // Users can still see them in the full DoctorList ("Show all").
  const UNCLASSIFIED = new Set(['OTHER', 'UNKNOWN'])
  const visibleErrors = errors
    .filter((e) => !excludeAborted || e.code !== 'ABORTED')
    .filter((e) => !UNCLASSIFIED.has(e.code))
  const unclassifiedCount = errors
    .filter((e) => UNCLASSIFIED.has(e.code))
    .reduce((a, e) => a + e.count, 0)
  // Percentage denominator is the classified total — so "OOM is 40%" means 40%
  // of *classified* failures, not 40% of (classified + noise).
  const classifiedTotal = visibleErrors.reduce((a, e) => a + e.count, 0)
  const topError = visibleErrors[0]

  const topWf = [...analytics.byWorkflow]
    .filter((w) => w.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5)
  // Parallel of topWf for LoRA training jobs — see analytics.byLora, grouped
  // by base_model. Each base model is a recurring training "kind", which is
  // the most actionable axis when something starts failing systematically.
  const topLora = [...(analytics.byLora ?? [])]
    .filter((l) => l.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5)
  const topSrv = [...analytics.byServer]
    .filter((s) => s.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5)

  // Aggregate service-level rows into a host-level "Servers" view.
  const serverById = new Map(servers.map((s) => [s.id, s]))
  const serverByName = new Map(servers.map((s) => [s.name, s]))
  const hostMap = new Map<
    string,
    { hostname: string; failed: number; total: number; serverId: string | null }
  >()
  for (const row of analytics.byServer) {
    const match =
      (row.server_id ? serverById.get(row.server_id) : undefined) ??
      serverByName.get(row.server_name)
    const bucket = match ? (hostnameOf(match) ?? row.server_name) : row.server_name
    const cur = hostMap.get(bucket) ?? {
      hostname: bucket,
      failed: 0,
      total: 0,
      serverId: match?.id ?? row.server_id ?? null,
    }
    cur.failed += row.failed
    cur.total += row.total
    if (!cur.serverId && row.server_id) cur.serverId = row.server_id
    hostMap.set(bucket, cur)
  }
  const topHosts = [...hostMap.values()]
    .filter((h) => h.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5)

  const topUsers = [...users]
    .filter((u) => u.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5)

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi
          label={`Total failures · ${rLabel}`}
          value={totalFailed.toLocaleString()}
          valueColor={totalFailed > 0 ? 'var(--bad)' : 'var(--good)'}
          chip={totalFails ? `${totalFails} all-time` : undefined}
        />
        <Kpi
          label="Failure rate"
          value={`${failRate.toFixed(1)}%`}
          chip="target < 8%"
          chipTone={failRate >= 8 ? 'warn' : 'good'}
        />
        <Kpi
          label="Top error"
          value={topError ? topError.code : '—'}
          valueMono
          chip={
            topError && classifiedTotal > 0
              ? `${Math.round((topError.count / classifiedTotal) * 100)}% of classified`
              : undefined
          }
          onClick={
            topError
              ? () =>
                  onDrill({
                    kind: 'error',
                    id: topError.code,
                    color: ERROR_CODE_COLOR[topError.code],
                    label: ERROR_CODE_LABEL[topError.code],
                  })
              : undefined
          }
        />
        <Kpi
          label="Workflow vs LoRA"
          value={`${analytics.workflows.failed} / ${analytics.training.failed}`}
          chip="all-time"
          valueMono
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Top error types</div>
            <span className="chip">{rLabel}</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => onShowAll('error')}>
              Show all <ChevronRight size={12} />
            </button>
          </div>
          <div className="card-pad col" style={{ gap: 10 }}>
            {visibleErrors.length === 0 ? (
              <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>No classified failures.</span>
            ) : (
              visibleErrors.slice(0, 6).map((e) => {
                const pct = classifiedTotal > 0 ? (e.count / classifiedTotal) * 100 : 0
                const color = ERROR_CODE_COLOR[e.code] ?? 'var(--ink-3)'
                return (
                  <DrillRow
                    key={e.code}
                    onClick={() =>
                      onDrill({ kind: 'error', id: e.code, color, label: ERROR_CODE_LABEL[e.code] })
                    }
                  >
                    <div
                      className="row"
                      style={{ justifyContent: 'space-between', marginBottom: 4 }}
                    >
                      <span style={{ fontSize: 13 }}>
                        <ErrChip code={e.code} />
                        {ERROR_CODE_LABEL[e.code] ?? e.code}
                      </span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {e.count} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${Math.max(pct, 1)}%`, background: color }} />
                    </div>
                  </DrillRow>
                )
              })
            )}
            {unclassifiedCount > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  paddingTop: 8,
                  borderTop: '1px dashed var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  {unclassifiedCount} unclassified failure{unclassifiedCount === 1 ? '' : 's'}{' '}
                  hidden
                </span>
                <button className="btn btn-xs btn-ghost" onClick={() => onShowAll('error')}>
                  View in list
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Failure trend</div>
            <span className="chip">{rLabel}</span>
          </div>
          <div className="card-pad">
            <div className="spark" style={{ height: 100, gap: 3 }}>
              {recent.map((d, i) => (
                <i
                  key={i}
                  title={`${fmtDate(d.date)}: ${d.failed} failed`}
                  style={{
                    flex: 1,
                    height: Math.max((d.failed / maxFail) * 100, d.failed > 0 ? 4 : 0),
                    background:
                      d.failed > maxFail * 0.7
                        ? 'var(--bad)'
                        : d.failed > maxFail * 0.4
                          ? 'var(--warn)'
                          : 'var(--accent)',
                    borderRadius: '3px 3px 0 0',
                    opacity: 0.85,
                    width: 'auto',
                  }}
                />
              ))}
            </div>
            <div
              className="row"
              style={{
                justifyContent: 'space-between',
                fontSize: 11,
                color: 'var(--ink-3)',
                marginTop: 8,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span>{recent[0] ? fmtDate(recent[0].date) : days > 0 ? `${days}d ago` : '—'}</span>
              <span>
                {recent[Math.floor(recent.length / 2)]
                  ? fmtDate(recent[Math.floor(recent.length / 2)].date)
                  : '—'}
              </span>
              <span>today</span>
            </div>
          </div>
        </div>
      </div>

      {/* Four-card grid in a 2-column layout: top row = the "what" of the
       * failures (workflow vs lora kind), bottom row = the "where" (the
       * service that ran it and the server hosting it). grid-2 wraps the
       * four cards naturally into 2×2 without a new CSS class. */}
      <div className="grid-2" style={{ marginBottom: 14 }}>
        <FailureList
          title="Workflows · most failures"
          onShowAll={() => onShowAll('workflow')}
          rows={topWf.map((w) => ({
            label: w.workflowName ?? '(unnamed)',
            fails: w.failed,
            total: w.total,
            color: colorForName(w.workflowName ?? 'unnamed'),
            onClick: () =>
              onDrill({
                kind: 'workflow',
                id: w.workflowName ?? '(unnamed)',
                color: colorForName(w.workflowName ?? 'unnamed'),
              }),
          }))}
        />
        <FailureList
          title="LoRA · most failures"
          rows={topLora.map((l) => ({
            label: l.baseModel ?? '(unknown)',
            mono: true,
            fails: l.failed,
            total: l.total,
            color: colorForName(l.baseModel ?? 'unknown'),
            // Doctor's drill kinds don't include 'lora' yet, so leave the row
            // unclickable for now — the card is informational.
          }))}
        />
        <FailureList
          title="Services · most failures"
          onShowAll={() => onShowAll('server')}
          rows={topSrv.map((s) => ({
            label: s.server_name,
            mono: true,
            fails: s.failed,
            total: s.total,
            color: colorForName(s.server_name),
            onClick: () =>
              onDrill({
                kind: 'server',
                id: s.server_id ?? s.server_name,
                color: colorForName(s.server_name),
                label: s.server_name,
              }),
          }))}
        />
        <FailureList
          title="Servers · most failures"
          rows={topHosts.map((h) => ({
            label: h.hostname,
            mono: true,
            fails: h.failed,
            total: h.total,
            color: colorForName(h.hostname),
            onClick: h.serverId
              ? () =>
                  onDrill({
                    kind: 'server',
                    id: h.serverId!,
                    color: colorForName(h.hostname),
                    label: h.hostname,
                  })
              : undefined,
          }))}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Users · most failures</div>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => onShowAll('user')}>
            Show all <ChevronRight size={12} />
          </button>
        </div>
        <div className="card-pad col" style={{ gap: 10 }}>
          {topUsers.length === 0 ? (
            <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>
              No user-attributable failures.
            </span>
          ) : (
            topUsers.map((u) => {
              const rate = u.total > 0 ? (u.failed / u.total) * 100 : 0
              const initials =
                u.user_name
                  .split(/\s+/)
                  .map((x) => x[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || '?'
              return (
                <DrillRow
                  key={u.user_id ?? u.user_name}
                  onClick={() =>
                    onDrill({
                      kind: 'user',
                      id: u.user_id ?? u.user_name,
                      color: 'var(--accent)',
                      initials,
                      label: u.user_name,
                    })
                  }
                >
                  <div className="row" style={{ gap: 10 }}>
                    <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{u.user_name}</div>
                      <div className="bar" style={{ marginTop: 4 }}>
                        <i
                          style={{
                            width: `${Math.min(rate * 3, 100)}%`,
                            background: 'var(--accent)',
                          }}
                        />
                      </div>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-3)',
                        textAlign: 'right',
                        minWidth: 64,
                      }}
                    >
                      {u.failed} / {u.total}
                      <br />
                      <span style={{ fontSize: 10 }}>{rate.toFixed(1)}%</span>
                    </div>
                  </div>
                </DrillRow>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
