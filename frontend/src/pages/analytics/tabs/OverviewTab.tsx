import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../../lib/api'
import { Kpi } from '../../../components/ui/Kpi'
import {
  type Range,
  type AnalyticsData,
  type UserAgg,
  type DurationBucket,
  rangeToDays,
  rangeLabel,
  colorForName,
  fmtMs,
  downloadCSV,
} from '../analyticsHelpers'
import { Loading, ErrorView } from '../analyticsShared'

export function OverviewTab({ range }: { range: Range }) {
  const days = rangeToDays(range)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [users, setUsers] = useState<UserAgg[]>([])
  const [buckets, setBuckets] = useState<DurationBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<AnalyticsData>(`/api/analytics?days=${days}`),
      api.get<UserAgg[]>(`/api/analytics/by-user?days=${days}`),
      api.get<DurationBucket[]>(`/api/analytics/duration-buckets?days=${days}`),
    ])
      .then(([d, u, b]) => {
        setData(d)
        setUsers(u)
        setBuckets(b)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <Loading />
  if (error) return <ErrorView msg={error} />
  if (!data) return null

  const recent = days > 0 ? data.daily.slice(-days) : data.daily
  const totalRuns = recent.reduce((a, d) => a + d.total, 0)
  const completed = recent.reduce((a, d) => a + d.completed, 0)
  const failed = recent.reduce((a, d) => a + d.failed, 0)
  const successPct = totalRuns > 0 ? (completed / totalRuns) * 100 : 0

  // Avg duration across all servers, weighted by total. Falls back to
  // unweighted mean of the per-server averages if total counts are 0.
  const durServers = data.byServer.filter((s) => s.avg_duration_ms != null)
  const totalRunsForDur = durServers.reduce((a, s) => a + s.total, 0)
  const avgDurMs =
    totalRunsForDur > 0
      ? Math.round(
          durServers.reduce((a, s) => a + (s.avg_duration_ms ?? 0) * s.total, 0) / totalRunsForDur,
        )
      : null

  // GPU-hours: sum(duration_ms) across all servers / 3.6M. Number() guards the
  // reducer — a string operand would make `+` concatenate digits instead of add.
  const totalDurMs = data.byServer.reduce((a, s) => a + Number(s.total_duration_ms ?? 0), 0)
  const gpuHrs = totalDurMs / 3_600_000

  // Workflow vs LoRA breakdowns for the KPI sub-lines.
  const wfTotal = data.workflows.total
  const loraTotal = data.training.total
  const wfDone = data.workflows.completed
  const loraDone = data.training.completed
  const wfPct = wfTotal > 0 ? (wfDone / wfTotal) * 100 : 0
  const loraPct = loraTotal > 0 ? (loraDone / loraTotal) * 100 : 0

  // Per-source duration/GPU breakdown comes straight from the WF-only and
  // LoRA-only aggregates the server computes. Previously we tried to partition
  // byServer rows on s.server_type — but server_type is the *server's* admin
  // label (often null), not the source job table, so the filter collapsed and
  // the WF/LoRA detail rendered as "—" / 0h even when the totals were right.
  const wfDurGpu = {
    avgMs: data.workflows.avgDurationMs,
    gpuHrs: Number(data.workflows.totalDurationMs ?? 0) / 3_600_000,
  }
  const loraDurGpu = {
    avgMs: data.training.avgDurationMs,
    gpuHrs: Number(data.training.totalDurationMs ?? 0) / 3_600_000,
  }

  const splitSub = (wf: string, lora: string) => `${wf} WF · ${lora} LoRA`

  const headline = [
    {
      label: `Total runs · ${rangeLabel(range)}`,
      value: totalRuns.toLocaleString(),
      sub: splitSub(wfTotal.toLocaleString(), loraTotal.toLocaleString()),
      chip: `${failed.toLocaleString()} failed`,
      tone: failed > 0 ? 'bad' : 'good',
    },
    {
      label: 'Success rate',
      value: `${successPct.toFixed(1)}%`,
      sub: splitSub(`${wfPct.toFixed(1)}%`, `${loraPct.toFixed(1)}%`),
      chip: `${completed.toLocaleString()} completed · ${failed.toLocaleString()} failed`,
      tone: successPct >= 90 ? 'good' : successPct >= 75 ? 'warn' : 'bad',
    },
    {
      label: 'Avg duration',
      value: fmtMs(avgDurMs),
      sub: splitSub(fmtMs(wfDurGpu.avgMs), fmtMs(loraDurGpu.avgMs)),
      chip: 'across all services',
      tone: 'info',
    },
    {
      label: 'GPU hours',
      value: gpuHrs >= 1 ? `${gpuHrs.toFixed(1)}h` : '—',
      sub: splitSub(
        wfDurGpu.gpuHrs >= 0.1 ? `${wfDurGpu.gpuHrs.toFixed(1)}h` : '—',
        loraDurGpu.gpuHrs >= 0.1 ? `${loraDurGpu.gpuHrs.toFixed(1)}h` : '—',
      ),
      chip: `${data.byServer.length} services`,
      tone: 'info',
    },
  ] as const

  const byWorkflow = data.byWorkflow.slice(0, 8).map((w) => ({
    name: w.workflowName ?? '(unnamed)',
    v: w.total,
    c: colorForName(w.workflowName ?? 'unnamed'),
  }))
  const byLora = (data.byLora ?? []).slice(0, 8).map((l) => ({
    name: l.baseModel ?? '(unknown)',
    v: l.total,
    c: colorForName(l.baseModel ?? 'unknown'),
  }))
  const maxBy = Math.max(...byWorkflow.map((b) => b.v), 1)
  const maxByLora = Math.max(...byLora.map((b) => b.v), 1)
  const maxDist = Math.max(...buckets.map((b) => b.count), 1)

  // Active users: top by total in window. Show up to 7 stacked avatars + "+N more".
  const activeUsers = users.filter((u) => u.total > 0)
  const topUsers = activeUsers.slice(0, 7)

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        {headline.map((s) => (
          <Kpi
            key={s.label}
            label={s.label}
            value={s.value}
            sub={s.sub}
            chip={s.chip}
            chipTone={s.tone}
          />
        ))}
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Runs by workflow</div>
            <span className="spacer" />
            <button
              className="btn btn-sm btn-ghost"
              disabled={byWorkflow.length === 0}
              onClick={() =>
                downloadCSV(
                  `overview-by-workflow-${range}.csv`,
                  ['workflow', 'runs'],
                  data.byWorkflow.map((w) => [w.workflowName ?? '(unnamed)', w.total]),
                )
              }
              title="Export the full workflow breakdown — not just the top 8 rendered"
            >
              <Download size={12} /> CSV
            </button>
          </div>
          <div className="card-pad col" style={{ gap: 10 }}>
            {byWorkflow.length === 0 ? (
              <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>No runs in this range.</span>
            ) : (
              byWorkflow.map((b) => (
                <div key={b.name}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13 }}>{b.name}</span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {b.v.toLocaleString()}
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: (b.v / maxBy) * 100 + '%', background: b.c }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Runs by LoRA</div>
            <span className="spacer" />
            <button
              className="btn btn-sm btn-ghost"
              disabled={byLora.length === 0}
              onClick={() =>
                downloadCSV(
                  `overview-by-lora-${range}.csv`,
                  ['base_model', 'runs'],
                  (data.byLora ?? []).map((l) => [l.baseModel ?? '(unknown)', l.total]),
                )
              }
              title="Export the full LoRA breakdown — not just the top 8 rendered"
            >
              <Download size={12} /> CSV
            </button>
          </div>
          <div className="card-pad col" style={{ gap: 10 }}>
            {byLora.length === 0 ? (
              <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                No LoRA training in this range.
              </span>
            ) : (
              byLora.map((b) => (
                <div key={b.name}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 13 }}>
                      {b.name}
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {b.v.toLocaleString()}
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: (b.v / maxByLora) * 100 + '%', background: b.c }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="card-title">Duration distribution</div>
          <span className="chip">{rangeLabel(range)}</span>
          <span className="spacer" />
          <button
            className="btn btn-sm btn-ghost"
            disabled={buckets.length === 0}
            onClick={() =>
              downloadCSV(
                `overview-duration-${range}.csv`,
                ['bucket', 'count'],
                buckets.map((b) => [b.label, b.count]),
              )
            }
            title="Export the duration histogram"
          >
            <Download size={12} /> CSV
          </button>
          <span className="spacer" />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>workflow + LoRA combined</span>
        </div>
        <div className="card-pad">
          {buckets.every((b) => b.count === 0) ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 32 }}>
              No completed jobs to distribute.
            </div>
          ) : (
            <>
              <div className="spark" style={{ height: 120, gap: 4, alignItems: 'flex-end' }}>
                {buckets.map((b, i) => (
                  <i
                    key={b.label}
                    title={`${b.label}: ${b.count}`}
                    style={{
                      flex: 1,
                      height: (b.count / maxDist) * 120,
                      background:
                        i < 2
                          ? 'var(--good)'
                          : i < 6
                            ? 'var(--accent)'
                            : i < 10
                              ? 'var(--warn)'
                              : 'var(--bad)',
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                ))}
              </div>
              <div
                className="row"
                style={{
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: 'var(--ink-3)',
                  marginTop: 6,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {buckets.map((b) => (
                  <span key={b.label} style={{ flex: 1, textAlign: 'center' }}>
                    {b.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid-3">
        <div className="card card-pad">
          <div className="stat-label">Active users</div>
          <div className="stat-value">{activeUsers.length}</div>
          {topUsers.length > 0 ? (
            <div className="row" style={{ marginTop: 10 }}>
              {topUsers.map((u, idx) => {
                const initials =
                  u.user_name
                    .split(/\s+/)
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || '?'
                return (
                  <div
                    key={u.user_id ?? u.user_name}
                    className="avatar"
                    title={`${u.user_name} · ${u.total} runs`}
                    style={{
                      width: 26,
                      height: 26,
                      fontSize: 10,
                      marginLeft: idx === 0 ? 0 : -8,
                      border: '2px solid var(--surface)',
                      background: colorForName(u.user_name),
                    }}
                  >
                    {initials}
                  </div>
                )
              })}
              {activeUsers.length > 7 && (
                <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                  +{activeUsers.length - 7} more
                </span>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)' }}>
              No user-attributed runs.
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="stat-label">Job composition</div>
          <div className="stat-value">
            {(data.workflows.total + data.training.total).toLocaleString()}
          </div>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
            {(() => {
              const wf = data.workflows.total
              const lora = data.training.total
              const sum = Math.max(wf + lora, 1)
              const rows = [
                { l: 'Workflows', v: wf, c: 'var(--info)' },
                { l: 'LoRA', v: lora, c: 'var(--pop-purple)' },
              ]
              return rows.map((r) => (
                <div key={r.l} className="row" style={{ gap: 8 }}>
                  <span style={{ width: 70, fontSize: 12 }}>{r.l}</span>
                  <div className="bar" style={{ flex: 1 }}>
                    <i style={{ width: (r.v / sum) * 100 + '%', background: r.c }} />
                  </div>
                  <span className="mono" style={{ fontSize: 11, width: 50, textAlign: 'right' }}>
                    {r.v.toLocaleString()}
                  </span>
                </div>
              ))
            })()}
          </div>
        </div>

        <div className="card card-pad">
          <div className="stat-label">Hourly load · {rangeLabel(range)}</div>
          {(() => {
            const hourly = Array.from(
              { length: 24 },
              (_, h) => data.byHour.find((r) => r.hour === h)?.count ?? 0,
            )
            const maxH = Math.max(...hourly, 1)
            const peak = hourly.indexOf(maxH)
            return (
              <>
                <div className="stat-value" style={{ fontSize: 22 }}>
                  {String(peak).padStart(2, '0')}:00
                </div>
                <div className="spark" style={{ marginTop: 10, height: 40 }}>
                  {hourly.map((v, i) => (
                    <i
                      key={i}
                      title={`${String(i).padStart(2, '0')}:00 · ${v}`}
                      style={{
                        flex: 1,
                        height: Math.max(2, (v / maxH) * 40),
                        background: i === peak ? 'var(--accent)' : 'var(--info)',
                        opacity: 0.6 + (v / maxH) * 0.4,
                      }}
                    />
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>
                  Peak hour · {maxH.toLocaleString()} jobs
                </div>
              </>
            )
          })()}
        </div>
      </div>
    </>
  )
}
