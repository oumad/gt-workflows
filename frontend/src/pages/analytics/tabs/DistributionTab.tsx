import { useState, useEffect, useMemo } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../../lib/api'
import { StackedBars, type StackSeries } from '../../../components/charts/StackedBars'
import { DonutChart } from '../../../components/charts/DonutChart'
import { Kpi } from '../../../components/ui/Kpi'
import {
  type Range,
  type TimeseriesRow,
  type DistributionRow,
  rangeToDays,
  rangeLabel,
  dayAxisFor,
  densifyTimeseries,
  colorForName,
  downloadCSV,
} from '../analyticsHelpers'
import { Loading, ErrorView } from '../analyticsShared'

const DIST_GROUPS = {
  server: { label: 'Service', singular: 'service', secondary: 'pool' },
  workflow: { label: 'Workflow', singular: 'workflow', secondary: null },
  lora: { label: 'LoRA', singular: 'LoRA', secondary: 'baseModel' },
} as const
type DistGroup = keyof typeof DIST_GROUPS

export function DistributionTab({ range }: { range: Range }) {
  const days = rangeToDays(range)
  const [groupBy, setGroupBy] = useState<DistGroup>('server')
  const [rows, setRows] = useState<DistributionRow[]>([])
  const [tsRows, setTsRows] = useState<TimeseriesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<DistributionRow[]>(`/api/analytics/distribution?groupBy=${groupBy}&days=${days}`),
      api.get<TimeseriesRow[]>(`/api/analytics/timeseries?groupBy=${groupBy}&days=${days}&top=500`),
    ])
      .then(([r, t]) => {
        setRows(r)
        setTsRows(t)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [days, groupBy])

  const { dates, labels } = useMemo(
    () =>
      dayAxisFor(
        days,
        tsRows.map((r) => r.date),
      ),
    [days, tsRows],
  )
  const stack = useMemo(() => densifyTimeseries(tsRows, dates), [tsRows, dates])

  if (loading) return <Loading />
  if (error) return <ErrorView msg={error} />

  const slices = rows.map((r) => ({
    name: r.name,
    value: r.value,
    color: colorForName(r.name),
    secondary: r.secondary,
    gpu: r.gpu,
  }))
  const total = slices.reduce((a, s) => a + s.value, 0)
  const top3 = slices.slice(0, 3).reduce((a, s) => a + s.value, 0)
  const top3Pct = total > 0 ? (top3 / total) * 100 : 0

  const meta = DIST_GROUPS[groupBy]
  const bySec = (() => {
    if (!meta.secondary) return null
    const m = new Map<string, number>()
    for (const s of slices) {
      const k = s.secondary ?? '—'
      m.set(k, (m.get(k) ?? 0) + s.value)
    }
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  })()
  const bySecMax = bySec ? Math.max(...bySec.map((b) => b.value), 1) : 1

  const onDownload = () =>
    downloadCSV(
      `distribution-${groupBy}-${range}.csv`,
      [meta.label, 'Runs', 'Share %', meta.secondary ?? ''].filter(Boolean) as string[],
      slices.map((s) =>
        total > 0
          ? [s.name, s.value, ((s.value / total) * 100).toFixed(2), s.secondary ?? '']
          : [s.name, s.value, '0', s.secondary ?? ''],
      ),
    )

  const stackSeries: StackSeries[] = stack.map((s) => ({
    name: s.entity,
    color: colorForName(s.entity),
    data: s.data,
  }))

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi
          label={`Total runs · ${rangeLabel(range)}`}
          value={total.toLocaleString()}
          chip={`across ${slices.length} ${meta.singular}s`}
        />
        <Kpi
          label={`Most used ${meta.singular}`}
          value={slices[0]?.name ?? '—'}
          valueMono
          chip={
            total > 0 && slices[0] ? `${((slices[0].value / total) * 100).toFixed(1)}% share` : '—'
          }
        />
        <Kpi
          label="Top 3 concentration"
          value={`${top3Pct.toFixed(0)}%`}
          chip={top3Pct > 70 ? 'concentrated' : 'balanced'}
          chipTone={top3Pct > 70 ? 'warn' : 'good'}
        />
        <Kpi
          label="Least used"
          value={slices[slices.length - 1]?.name ?? '—'}
          valueMono
          chip={slices[slices.length - 1] ? `${slices[slices.length - 1].value} runs` : '—'}
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">{meta.label} distribution</div>
          <span className="spacer" />
          <div className="toggle-group">
            {(Object.keys(DIST_GROUPS) as DistGroup[]).map((g) => (
              <button
                key={g}
                className={groupBy === g ? 'active' : ''}
                onClick={() => setGroupBy(g)}
              >
                {DIST_GROUPS[g].label}s
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={onDownload}>
            <Download size={12} /> CSV
          </button>
        </div>
        <div className="card-pad row" style={{ gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0 }}>
            <DonutChart slices={slices} />
          </div>
          <div className="col" style={{ flex: 1, gap: 8, minWidth: 0 }}>
            {slices.length === 0 && (
              <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>No data for this range.</span>
            )}
            {slices.map((s) => (
              <div key={s.name} className="row" style={{ gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: s.color,
                    flexShrink: 0,
                  }}
                />
                <strong
                  style={{ fontSize: 13, minWidth: 180 }}
                  className={groupBy === 'server' ? 'mono' : ''}
                >
                  {s.name}
                </strong>
                {s.gpu && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {s.gpu}
                  </span>
                )}
                {s.secondary && !s.gpu && (
                  <span className="chip" style={{ fontSize: 10 }}>
                    {s.secondary}
                  </span>
                )}
                <div className="bar" style={{ flex: 1, minWidth: 80 }}>
                  <i
                    style={{
                      width: (s.value / Math.max(slices[0]?.value, 1)) * 100 + '%',
                      background: s.color,
                    }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 12, width: 56, textAlign: 'right' }}>
                  {s.value}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-3)', width: 56, textAlign: 'right' }}
                >
                  {total > 0 ? ((s.value / total) * 100).toFixed(1) : '0'}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: bySec ? '1.6fr 1fr' : '1fr' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Share over time</div>
          </div>
          <div className="card-pad" style={{ paddingTop: 8 }}>
            <StackedBars series={stackSeries} labels={labels} />
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
              Daily run counts stacked per {meta.singular} (top 8)
            </div>
          </div>
        </div>
        {bySec && (
          <div className="card">
            <div className="card-head">
              <div className="card-title">By {meta.secondary}</div>
            </div>
            <div className="card-pad col" style={{ gap: 10 }}>
              {bySec.map((b) => (
                <div key={b.name}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, textTransform: 'capitalize' }}>{b.name}</span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {b.value} · {total > 0 ? ((b.value / total) * 100).toFixed(1) : '0'}%
                    </span>
                  </div>
                  <div className="bar">
                    <i
                      style={{
                        width: (b.value / bySecMax) * 100 + '%',
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
