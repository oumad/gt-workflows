import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api } from '../../../lib/api'
import { LineChart, type LineSeries } from '../../../components/charts/LineChart'
import { FilterChips } from '../../../components/charts/FilterChips'
import { Kpi } from '../../../components/ui/Kpi'
import {
  type Range,
  type AnalyticsData,
  type PerfDailyRow,
  rangeToDays,
  rangeLabel,
  dayAxisFor,
  densifyTimeseries,
  colorForName,
  fmtMs,
  downloadCSV,
} from '../analyticsHelpers'
import { Loading, ErrorView } from '../analyticsShared'

const PERF_METRICS = {
  runs: { label: 'Throughput', fmt: (v: number) => v.toLocaleString() },
  dur: { label: 'Avg duration', fmt: (v: number) => fmtMs(v) },
  p95: { label: 'p95 duration', fmt: (v: number) => fmtMs(v) },
  fail: { label: 'Fail rate', fmt: (v: number) => `${v}%` },
} as const
type PerfMetric = keyof typeof PERF_METRICS

/* The breakdown table can be rolled up along three axes:
 *   - services: one row per Server record (the existing behaviour).
 *   - servers:  one row per hostname — many services on a host get merged.
 *   - type:     one row per kind of service (workflow / lora) — a 2-row
 *               summary of the cluster's two workloads. */
type PerfGroup = 'services' | 'servers' | 'type'
const PERF_GROUPS: Record<PerfGroup, { label: string; count: string }> = {
  services: { label: 'Services', count: 'services' },
  servers: { label: 'Servers', count: 'servers' },
  type: { label: 'Type', count: 'kinds' },
}

/** Hostname from a possibly-bare URL. */
function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname
  } catch {
    return null
  }
}

/** Aggregate per-service byServer rows by a key (hostname or type). p50/p99
 *  can't be reconstructed from per-service percentiles, so we surface them as
 *  null in the rolled-up rows; p95 falls back to the max within the group as
 *  a "worst case here" proxy. */
type PerfRow = AnalyticsData['byServer'][number]
function aggregateBy(
  rows: PerfRow[],
  keyFn: (r: PerfRow) => string | null,
  labelFn: (r: PerfRow) => string,
): PerfRow[] {
  type Acc = {
    name: string
    gpu: string | null
    total: number
    completed: number
    failed: number
    durSum: number
    durCount: number
    p95max: number | null
    totalDurMs: number
  }
  const groups = new Map<string, Acc>()
  for (const r of rows) {
    const k = keyFn(r)
    if (!k) continue
    let g = groups.get(k)
    if (!g) {
      g = {
        name: labelFn(r),
        gpu: r.gpu ?? null,
        total: 0,
        completed: 0,
        failed: 0,
        durSum: 0,
        durCount: 0,
        p95max: null,
        totalDurMs: 0,
      }
      groups.set(k, g)
    }
    g.total += r.total
    g.completed += r.completed
    g.failed += r.failed
    if (r.avg_duration_ms != null && r.total > 0) {
      g.durSum += r.avg_duration_ms * r.total
      g.durCount += r.total
    }
    g.totalDurMs += Number(r.total_duration_ms ?? 0)
    if (r.p95_ms != null && (g.p95max == null || r.p95_ms > g.p95max)) g.p95max = r.p95_ms
    if (!g.gpu && r.gpu) g.gpu = r.gpu
  }
  return [...groups.values()].map((g) => ({
    server_name: g.name,
    server_id: null,
    server_url: null,
    server_type: null,
    gpu: g.gpu,
    total: g.total,
    completed: g.completed,
    failed: g.failed,
    avg_duration_ms: g.durCount > 0 ? Math.round(g.durSum / g.durCount) : null,
    p50_ms: null,
    p95_ms: g.p95max,
    p99_ms: null,
    avg_wait_ms: null,
    total_duration_ms: g.totalDurMs,
  }))
}

export function PerformanceTab({ range }: { range: Range }) {
  const days = rangeToDays(range)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [metric, setMetric] = useState<PerfMetric>('runs')
  const [series, setSeries] = useState<PerfDailyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [perfGroupBy, setPerfGroupBy] = useState<PerfGroup>('services')
  const navigate = useNavigate()

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<AnalyticsData>(`/api/analytics?days=${days}`),
      api.get<PerfDailyRow[]>(`/api/analytics/perf-daily?days=${days}&metric=${metric}&top=500`),
    ])
      .then(([d, s]) => {
        setData(d)
        setSeries(s)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [days, metric])

  // Selection of which servers appear in the chart. Default: all visible.
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    setSelected(Array.from(new Set(series.map((r) => r.entity))))
  }, [series])

  const { dates, labels } = useMemo(
    () =>
      dayAxisFor(
        days,
        series.map((r) => r.date),
      ),
    [days, series],
  )

  const seriesByEntity = useMemo(
    () =>
      densifyTimeseries(
        series.map((r) => ({ ...r, count: r.value })),
        dates,
      ),
    [series, dates],
  )
  const chartItems = seriesByEntity.map((s) => ({ name: s.entity, color: colorForName(s.entity) }))
  const chartSeries: LineSeries[] = seriesByEntity.map((s) => ({
    name: s.entity,
    color: colorForName(s.entity),
    data: s.data,
    dim: !selected.includes(s.entity),
  }))

  if (loading) return <Loading />
  if (error) return <ErrorView msg={error} />
  if (!data) return null

  // Pick the rollup source based on the Group-by toggle.
  const aggregatedRows =
    perfGroupBy === 'services'
      ? data.byServer
      : perfGroupBy === 'servers'
        ? aggregateBy(
            data.byServer,
            (r) => hostnameFromUrl(r.server_url) ?? r.server_name ?? null,
            (r) => hostnameFromUrl(r.server_url) ?? r.server_name,
          )
        : aggregateBy(
            data.byServer,
            (r) => r.server_type ?? 'unknown',
            (r) =>
              r.server_type === 'workflow'
                ? 'Workflow'
                : r.server_type === 'lora'
                  ? 'LoRA'
                  : 'Unknown',
          )

  const tableRows = [...aggregatedRows]
    .sort((a, b) => b.total - a.total)
    .map((s) => ({
      ...s,
      successRate: s.total > 0 ? (s.completed / s.total) * 100 : 0,
      gpuHrs: (s.total_duration_ms ?? 0) / 3_600_000,
      color: colorForName(s.server_name),
    }))

  // KPI strip
  const clusterAvg = (() => {
    const valid = data.byServer.filter((s) => s.avg_duration_ms != null && s.total > 0)
    const n = valid.reduce((a, s) => a + s.total, 0)
    return n > 0
      ? Math.round(valid.reduce((a, s) => a + (s.avg_duration_ms ?? 0) * s.total, 0) / n)
      : null
  })()
  const clusterP95 = Math.max(...data.byServer.map((s) => s.p95_ms ?? 0), 0) || null
  const totalRuns = data.byServer.reduce((a, s) => a + s.total, 0)
  const fastest = data.byServer
    .filter((s) => s.avg_duration_ms != null && s.total >= 5)
    .sort((a, b) => (a.avg_duration_ms ?? 0) - (b.avg_duration_ms ?? 0))[0]
  const slowest = data.byServer
    .filter((s) => s.p95_ms != null && s.total >= 5)
    .sort((a, b) => (b.p95_ms ?? 0) - (a.p95_ms ?? 0))[0]

  const onDownload = () => {
    const visible = seriesByEntity.filter((s) => selected.includes(s.entity))
    downloadCSV(
      `performance-${metric}-${range}.csv`,
      ['day', ...visible.map((s) => s.entity)],
      labels.map((d, i) => [d, ...visible.map((s) => s.data[i] ?? 0)]),
    )
  }

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label={`Cluster avg · ${rangeLabel(range)}`} value={fmtMs(clusterAvg)} />
        <Kpi
          label="Cluster p95"
          value={fmtMs(clusterP95)}
          valueColor="var(--warn)"
          chip={slowest ? slowest.server_name : '—'}
          chipTone="warn"
        />
        <Kpi
          label={`Throughput · ${rangeLabel(range)}`}
          value={totalRuns.toLocaleString()}
          chip={days > 0 ? `${Math.round(totalRuns / Math.max(days * 24, 1))} runs/hr` : undefined}
        />
        <Kpi
          label="Fastest service"
          value={fastest ? fastest.server_name : '—'}
          valueMono
          chip={fastest?.avg_duration_ms != null ? `${fmtMs(fastest.avg_duration_ms)} avg` : '—'}
          chipTone="good"
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">
            Per-service {PERF_METRICS[metric].label.toLowerCase()} over time
          </div>
          <span className="spacer" />
          <div className="toggle-group">
            {(Object.keys(PERF_METRICS) as PerfMetric[]).map((m) => (
              <button key={m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>
                {PERF_METRICS[m].label}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={onDownload}>
            <Download size={12} /> CSV
          </button>
        </div>
        <div className="card-pad" style={{ paddingTop: 8 }}>
          <div className="row" style={{ marginBottom: 12, gap: 12, alignItems: 'flex-start' }}>
            <FilterChips
              items={chartItems}
              selected={selected}
              onToggle={(n) =>
                setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))
              }
              onAll={() => setSelected(chartItems.map((x) => x.name))}
              onNone={() => setSelected([])}
            />
          </div>
          <LineChart
            series={chartSeries}
            labels={labels}
            formatY={PERF_METRICS[metric].fmt}
            onPointClick={(label, _v, seriesName) => {
              // Drill into Jobs filtered by the clicked series (server name) and
              // a tight range around the clicked day. The day label is the
              // axis text we control via dayAxisFor, e.g. "Mar 14" — Jobs reads
              // ?q= and the range comes from the user; we send both anyway so
              // a future server-side date filter can pick it up.
              const params = new URLSearchParams({ tab: 'history', q: seriesName, day: label })
              navigate(`/jobs?${params}`)
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
            Daily {PERF_METRICS[metric].label.toLowerCase()} per service · click chips to filter ·
            click a chart point to drill into Jobs for that service
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">{`Per-${PERF_GROUPS[perfGroupBy].label.slice(0, -1).toLowerCase()} breakdown`}</div>
          <span className="chip">
            {tableRows.length} {PERF_GROUPS[perfGroupBy].count}
          </span>
          <span className="spacer" />
          <div className="toggle-group">
            {(Object.keys(PERF_GROUPS) as PerfGroup[]).map((g) => (
              <button
                key={g}
                className={perfGroupBy === g ? 'active' : ''}
                onClick={() => setPerfGroupBy(g)}
              >
                {PERF_GROUPS[g].label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {tableRows.reduce((a, r) => a + r.gpuHrs, 0).toFixed(1)} GPU-hours · {rangeLabel(range)}
          </span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>{PERF_GROUPS[perfGroupBy].label.slice(0, -1)}</th>
              <th>GPU</th>
              <th style={{ textAlign: 'right' }}>Runs</th>
              <th style={{ textAlign: 'right' }}>Avg</th>
              <th style={{ textAlign: 'right' }}>p50</th>
              <th style={{ textAlign: 'right' }}>p95</th>
              <th style={{ textAlign: 'right' }}>p99</th>
              <th style={{ textAlign: 'right' }}>Fails</th>
              <th>Success</th>
              <th style={{ textAlign: 'right' }}>GPU-hrs</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.server_id ?? r.server_name}>
                <td>
                  <div className="row" style={{ gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />
                    <strong className="mono">{r.server_name}</strong>
                    {r.server_type && (
                      <span className="chip" style={{ fontSize: 10 }}>
                        {r.server_type}
                      </span>
                    )}
                  </div>
                </td>
                <td
                  className="mono"
                  style={{ fontSize: 11, color: r.gpu ? undefined : 'var(--ink-3)' }}
                >
                  {r.gpu ?? '—'}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {r.total.toLocaleString()}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {fmtMs(r.avg_duration_ms)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {fmtMs(r.p50_ms)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {fmtMs(r.p95_ms)}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {fmtMs(r.p99_ms)}
                </td>
                <td
                  className="mono"
                  style={{
                    textAlign: 'right',
                    color: r.failed > 0 ? 'var(--bad)' : 'var(--ink-3)',
                  }}
                >
                  {r.failed}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <div className="bar" style={{ width: 70 }}>
                      <i
                        style={{
                          width: r.successRate + '%',
                          background:
                            r.successRate >= 90
                              ? 'var(--good)'
                              : r.successRate >= 80
                                ? 'var(--warn)'
                                : 'var(--bad)',
                        }}
                      />
                    </div>
                    <span className="mono" style={{ fontSize: 11 }}>
                      {r.successRate.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {r.gpuHrs.toFixed(1)}
                </td>
              </tr>
            ))}
            {tableRows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}
                >
                  No service data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
