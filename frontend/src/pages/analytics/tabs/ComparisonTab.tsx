import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api } from '../../../lib/api'
import { LineChart, type LineSeries } from '../../../components/charts/LineChart'
import { FilterChips } from '../../../components/charts/FilterChips'
import {
  type Range,
  type AnalyticsData,
  type UserAgg,
  type TimeseriesRow,
  rangeToDays,
  dayAxisFor,
  densifyTimeseries,
  colorForName,
  fmtMs,
  downloadCSV,
} from '../analyticsHelpers'
import { Loading, ErrorView } from '../analyticsShared'

const COMP_GROUPS = {
  workflow: { label: 'Workflow' },
  lora: { label: 'LoRA' },
  server: { label: 'Service' },
  user: { label: 'User' },
} as const
type CompGroup = keyof typeof COMP_GROUPS

export function ComparisonTab({ range }: { range: Range }) {
  const days = rangeToDays(range)
  const navigate = useNavigate()
  const [groupBy, setGroupBy] = useState<CompGroup>('workflow')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [users, setUsers] = useState<UserAgg[]>([])
  const [series, setSeries] = useState<TimeseriesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<AnalyticsData>(`/api/analytics?days=${days}`),
      api.get<UserAgg[]>(`/api/analytics/by-user?days=${days}`),
      api.get<TimeseriesRow[]>(`/api/analytics/timeseries?groupBy=${groupBy}&days=${days}&top=12`),
    ])
      .then(([d, u, s]) => {
        setData(d)
        setUsers(u)
        setSeries(s)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [days, groupBy])

  // Items (with metrics) — populated from the appropriate aggregate. LoRA
  // mirrors the workflow shape but reads from data.byLora (grouped by base
  // model on the backend) so the comparison chart works the same way.
  const items = useMemo(() => {
    if (!data) return []
    if (groupBy === 'workflow') {
      return data.byWorkflow.map((w) => ({
        name: w.workflowName ?? '(unnamed)',
        color: colorForName(w.workflowName ?? 'unnamed'),
        metrics: {
          runs: w.total,
          fails: w.failed,
          failPct: w.total > 0 ? (w.failed / w.total) * 100 : 0,
          success: w.successRate,
          avgDur: w.avgDurationMs ?? 0,
        },
      }))
    }
    if (groupBy === 'lora') {
      return (data.byLora ?? []).map((l) => ({
        name: l.baseModel ?? '(unknown)',
        color: colorForName(l.baseModel ?? 'unknown'),
        metrics: {
          runs: l.total,
          fails: l.failed,
          failPct: l.total > 0 ? (l.failed / l.total) * 100 : 0,
          success: l.successRate,
          avgDur: l.avgDurationMs ?? 0,
        },
      }))
    }
    if (groupBy === 'server') {
      return data.byServer.map((s) => ({
        name: s.server_name,
        color: colorForName(s.server_name),
        metrics: {
          runs: s.total,
          fails: s.failed,
          failPct: s.total > 0 ? (s.failed / s.total) * 100 : 0,
          success: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
          avgDur: s.avg_duration_ms ?? 0,
        },
      }))
    }
    return users.map((u) => ({
      name: u.user_name,
      color: colorForName(u.user_name),
      metrics: {
        runs: u.total,
        fails: u.failed,
        failPct: u.total > 0 ? (u.failed / u.total) * 100 : 0,
        success: u.total > 0 ? Math.round((u.completed / u.total) * 100) : 0,
        avgDur: u.avg_duration_ms ?? 0,
      },
    }))
  }, [groupBy, data, users])

  // Default selection: top 3.
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    setSelected(items.slice(0, 3).map((x) => x.name))
  }, [groupBy, items.length])

  const toggle = (name: string) =>
    setSelected((s) => {
      if (s.includes(name)) return s.filter((x) => x !== name)
      if (s.length >= 4) return s
      return [...s, name]
    })

  const chosen = selected
    .map((n) => items.find((i) => i.name === n))
    .filter((x): x is (typeof items)[0] => !!x)

  const { dates, labels } = useMemo(
    () =>
      dayAxisFor(
        days,
        series.map((r) => r.date),
      ),
    [days, series],
  )
  const dense = useMemo(() => densifyTimeseries(series, dates), [series, dates])
  const chosenNames = new Set(selected)
  const chartSeries: LineSeries[] = dense
    .filter((s) => chosenNames.has(s.entity))
    .map((s) => ({ name: s.entity, color: colorForName(s.entity), data: s.data }))

  const METRICS = [
    { key: 'runs' as const, label: 'Runs', higher: true, fmt: (v: number) => v.toLocaleString() },
    { key: 'fails' as const, label: 'Failures', higher: false, fmt: (v: number) => v.toString() },
    {
      key: 'failPct' as const,
      label: 'Fail rate',
      higher: false,
      fmt: (v: number) => v.toFixed(1) + '%',
    },
    {
      key: 'success' as const,
      label: 'Success',
      higher: true,
      fmt: (v: number) => v.toFixed(0) + '%',
    },
    { key: 'avgDur' as const, label: 'Avg duration', higher: false, fmt: (v: number) => fmtMs(v) },
  ]

  const onDownloadTs = () => {
    const filtered = dense.filter((s) => chosenNames.has(s.entity))
    downloadCSV(
      `comparison-${groupBy}-runs-${range}.csv`,
      ['day', ...filtered.map((s) => s.entity)],
      labels.map((d, i) => [d, ...filtered.map((s) => s.data[i] ?? 0)]),
    )
  }
  const onDownloadMetrics = () =>
    downloadCSV(
      `comparison-${groupBy}-metrics-${range}.csv`,
      [groupBy, ...METRICS.map((m) => m.label)],
      chosen.map((c) => [c.name, ...METRICS.map((m) => c.metrics[m.key])]),
    )

  if (loading) return <Loading />
  if (error) return <ErrorView msg={error} />

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">Compare {COMP_GROUPS[groupBy].label.toLowerCase()}s</div>
          <span className="spacer" />
          <div className="toggle-group">
            {(Object.keys(COMP_GROUPS) as CompGroup[]).map((g) => (
              <button
                key={g}
                className={groupBy === g ? 'active' : ''}
                onClick={() => setGroupBy(g)}
              >
                {COMP_GROUPS[g].label}s
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            padding: '8px 14px',
            fontSize: 12,
            color: 'var(--ink-3)',
            borderBottom: '1px solid var(--line)',
            lineHeight: 1.5,
          }}
        >
          Pick up to 4 {COMP_GROUPS[groupBy].label.toLowerCase()}s to see their runs, failures,
          duration, and run-rate trend side-by-side over the selected range. The toggle above
          switches the grouping dimension.
        </div>
        <div className="card-pad">
          <FilterChips
            items={items.slice(0, 16)}
            selected={selected}
            onToggle={toggle}
            maxNote={`${selected.length} / 4 selected · max 4`}
          />
        </div>
      </div>

      {chosen.length === 0 ? (
        <div
          className="card card-pad"
          style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '60px 20px' }}
        >
          Pick up to 4 {COMP_GROUPS[groupBy].label.toLowerCase()}s above to compare.
        </div>
      ) : (
        <>
          {/* Per-entity metric cards */}
          <div
            className="grid-4"
            style={{
              marginBottom: 14,
              gridTemplateColumns: `repeat(${chosen.length}, 1fr)`,
            }}
          >
            {chosen.map((c) => (
              <div className="card" key={c.name} style={{ borderTop: '3px solid ' + c.color }}>
                <div className="card-head" style={{ paddingTop: 12 }}>
                  <div className="card-title" style={{ fontSize: 13 }}>
                    {c.name}
                  </div>
                </div>
                <div className="card-pad col" style={{ gap: 10, paddingTop: 0 }}>
                  {METRICS.map((m) => {
                    const values = chosen.map((x) => x.metrics[m.key])
                    const winner = m.higher ? Math.max(...values) : Math.min(...values)
                    const isWinner = chosen.length > 1 && c.metrics[m.key] === winner
                    return (
                      <div key={m.key} className="row" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{m.label}</span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: isWinner ? 'var(--good)' : 'var(--ink)',
                          }}
                        >
                          {m.fmt(c.metrics[m.key])}
                          {isWinner ? ' ✓' : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Timeseries overlay */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div className="card-title">Runs over time</div>
              <span className="spacer" />
              <button className="btn btn-sm" onClick={onDownloadTs}>
                <Download size={12} /> Timeseries CSV
              </button>
              <button className="btn btn-sm" onClick={onDownloadMetrics}>
                <Download size={12} /> Metrics CSV
              </button>
            </div>
            <div className="card-pad" style={{ paddingTop: 8 }}>
              <LineChart
                series={chartSeries}
                labels={labels}
                showArea={false}
                onPointClick={(label, _v, seriesName) => {
                  // Each series corresponds to the active groupBy facet, so
                  // the right `q=` term varies. Workflow/lora rows use the
                  // name verbatim; server/user rows use the same — Jobs's
                  // server-side search runs against multiple fields and will
                  // find a match in either case.
                  const params = new URLSearchParams({
                    tab: 'history',
                    q: seriesName,
                    day: label,
                  })
                  navigate(`/jobs?${params}`)
                }}
              />
              <div
                className="row"
                style={{ gap: 14, fontSize: 12, marginTop: 8, flexWrap: 'wrap' }}
              >
                {chartSeries.map((s) => (
                  <div key={s.name} className="row" style={{ gap: 6 }}>
                    <span style={{ width: 12, height: 3, background: s.color, borderRadius: 2 }} />
                    <span style={{ color: 'var(--ink-2)' }}>{s.name}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                      {s.data.reduce((a, b) => a + b, 0)} runs
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Metric comparison bars */}
          <div className="card">
            <div className="card-head">
              <div className="card-title">Metric comparison</div>
            </div>
            <div className="card-pad col" style={{ gap: 16 }}>
              {METRICS.map((m) => {
                const values = chosen.map((c) => c.metrics[m.key])
                const max = Math.max(...values, 1)
                return (
                  <div key={m.key}>
                    <div className="stat-label" style={{ marginBottom: 8 }}>
                      {m.label}
                    </div>
                    <div className="col" style={{ gap: 6 }}>
                      {chosen.map((c) => (
                        <div key={c.name} className="row" style={{ gap: 10 }}>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              background: c.color,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 12, minWidth: 140 }}>{c.name}</span>
                          <div className="bar" style={{ flex: 1 }}>
                            <i
                              style={{
                                width: (c.metrics[m.key] / max) * 100 + '%',
                                background: c.color,
                              }}
                            />
                          </div>
                          <span
                            className="mono"
                            style={{ fontSize: 12, width: 80, textAlign: 'right' }}
                          >
                            {m.fmt(c.metrics[m.key])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
