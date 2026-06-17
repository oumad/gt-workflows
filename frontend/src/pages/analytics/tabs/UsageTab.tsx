import { useState, useEffect, useMemo } from 'react'
import { Download } from 'lucide-react'
import { api } from '../../../lib/api'
import { StackedBars, type StackSeries } from '../../../components/charts/StackedBars'
import { FilterChips } from '../../../components/charts/FilterChips'
import { Kpi } from '../../../components/ui/Kpi'
import { Pagination } from '../../../components/ui/Pagination'
import {
  type Range,
  type TimeseriesRow,
  rangeToDays,
  rangeLabel,
  dayAxisFor,
  densifyTimeseries,
  colorForName,
  downloadCSV,
} from '../analyticsHelpers'
import { Loading, ErrorView } from '../analyticsShared'

const USAGE_GROUPS = {
  user: { label: 'User', plural: 'users' },
  server: { label: 'Service', plural: 'services' },
  workflow: { label: 'Workflow', plural: 'workflows' },
  // /timeseries already accepts groupBy=lora — it groups training_jobs by
  // base_model and returns the same {date, entity, count} shape, so the
  // existing UsageTab plumbing handles it without any other change.
  lora: { label: 'LoRA', plural: 'LoRA models' },
} as const
type UsageGroup = keyof typeof USAGE_GROUPS
type UsageMetric = 'runs' | 'gpu'

export function UsageTab({ range }: { range: Range }) {
  const days = rangeToDays(range)
  const [groupBy, setGroupBy] = useState<UsageGroup>('workflow')
  const [metric, setMetric] = useState<UsageMetric>('runs')
  const [series, setSeries] = useState<TimeseriesRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .get<TimeseriesRow[]>(
        `/api/analytics/timeseries?groupBy=${groupBy}&metric=${metric}&days=${days}&top=500`,
      )
      .then(setSeries)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [days, groupBy, metric])

  const { dates, labels } = useMemo(
    () =>
      dayAxisFor(
        days,
        series.map((r) => r.date),
      ),
    [days, series],
  )
  const dense = useMemo(() => densifyTimeseries(series, dates), [series, dates])

  // For chart, only show currently-selected entities. Reset to "all" whenever
  // the SET of entities changes — keyed on the entity names (not `dense`
  // identity or a length), so a group/metric switch resets to the NEW entities
  // (the previous code reset against stale `dense` and left the chart empty),
  // while a timeframe change that keeps the same entities preserves selection.
  const [selected, setSelected] = useState<string[]>([])
  const entityKey = dense.map((s) => s.entity).join('')
  useEffect(() => {
    setSelected(dense.map((s) => s.entity))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey])

  const PAGE_SIZE = 20
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(dense.length / PAGE_SIZE))
  const pagedItems = dense.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => {
    setPage(1)
  }, [groupBy, metric, days])

  const visible = dense.filter((s) => selected.includes(s.entity))
  const total = visible.reduce((a, s) => a + s.total, 0)
  // Denominator for the ranked-list "% share": every entity (not just the
  // selected/visible ones), so the rendered rows' shares are consistent and
  // sum to 100% regardless of which chips are toggled.
  const grandTotal = dense.reduce((a, s) => a + s.total, 0)
  const grandMax = dense[0]?.total || 1
  const stackSeries: StackSeries[] = visible.map((s) => ({
    name: s.entity,
    color: colorForName(s.entity),
    data: s.data,
  }))

  const onDownload = () =>
    downloadCSV(
      `usage-${groupBy}-${metric}-${range}.csv`,
      ['day', ...dense.map((s) => s.entity)],
      labels.map((d, i) => [d, ...dense.map((s) => s.data[i] ?? 0)]),
    )

  if (loading) return <Loading />
  if (error) return <ErrorView msg={error} />

  const top1 = dense[0]
  const unit = metric === 'gpu' ? 'h' : ''

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi
          label={`${metric === 'gpu' ? 'GPU-hours' : 'Total runs'} · ${rangeLabel(range)}`}
          value={metric === 'gpu' ? `${total.toFixed(1)}h` : total.toLocaleString()}
        />
        <Kpi
          label={`Top ${USAGE_GROUPS[groupBy].label.toLowerCase()}`}
          value={top1?.entity ?? '—'}
          valueMono
          chip={
            top1 ? `${metric === 'gpu' ? top1.total.toFixed(1) : top1.total}${unit}` : undefined
          }
        />
        <Kpi
          label={`Active ${USAGE_GROUPS[groupBy].plural}`}
          value={String(visible.length)}
          chip={`of ${dense.length}`}
        />
        <Kpi
          label="Daily avg"
          value={(() => {
            const denom = days > 0 ? days : dates.length
            if (denom === 0) return metric === 'gpu' ? '—' : '0'
            return metric === 'gpu'
              ? `${(total / denom).toFixed(1)}h`
              : String(Math.round(total / denom))
          })()}
          chip="per day"
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title">{USAGE_GROUPS[groupBy].label} usage over time</div>
          <span className="spacer" />
          <div className="toggle-group">
            {(Object.keys(USAGE_GROUPS) as UsageGroup[]).map((g) => (
              <button
                key={g}
                className={groupBy === g ? 'active' : ''}
                onClick={() => setGroupBy(g)}
              >
                By {USAGE_GROUPS[g].label.toLowerCase()}
              </button>
            ))}
          </div>
          <div className="toggle-group">
            <button className={metric === 'runs' ? 'active' : ''} onClick={() => setMetric('runs')}>
              Runs
            </button>
            <button className={metric === 'gpu' ? 'active' : ''} onClick={() => setMetric('gpu')}>
              GPU-hrs
            </button>
          </div>
          <button className="btn btn-sm" onClick={onDownload}>
            <Download size={12} /> CSV
          </button>
        </div>
        <div className="card-pad" style={{ paddingTop: 8 }}>
          <div className="row" style={{ marginBottom: 12, gap: 12, alignItems: 'flex-start' }}>
            <FilterChips
              items={dense.map((s) => ({ name: s.entity, color: colorForName(s.entity) }))}
              selected={selected}
              onToggle={(n) =>
                setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))
              }
              onAll={() => setSelected(dense.map((x) => x.entity))}
              onNone={() => setSelected([])}
            />
          </div>
          <StackedBars
            series={stackSeries}
            labels={labels}
            formatY={(v) => (metric === 'gpu' ? `${v}h` : String(v))}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
            Stacked daily {metric === 'gpu' ? 'GPU-hours' : 'run counts'} · hover bars for value
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Ranked {USAGE_GROUPS[groupBy].plural}</div>
          <span className="chip">{dense.length}</span>
        </div>
        <div className="card-pad col" style={{ gap: 8 }}>
          {dense.length === 0 && (
            <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>No data.</span>
          )}
          {pagedItems.map((s, idx) => {
            const rank = (page - 1) * PAGE_SIZE + idx
            const c = colorForName(s.entity)
            return (
              <div key={s.entity} className="row" style={{ gap: 10 }}>
                <span className="mono" style={{ width: 24, color: 'var(--ink-3)', fontSize: 11 }}>
                  #{rank + 1}
                </span>
                <span
                  style={{ width: 10, height: 10, borderRadius: 2, background: c, flexShrink: 0 }}
                />
                <strong
                  style={{ fontSize: 13, minWidth: 160 }}
                  className={groupBy === 'server' ? 'mono' : ''}
                >
                  {s.entity}
                </strong>
                <div className="bar" style={{ flex: 1 }}>
                  <i style={{ width: (s.total / grandMax) * 100 + '%', background: c }} />
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 12, color: 'var(--ink-3)', width: 80, textAlign: 'right' }}
                >
                  {metric === 'gpu' ? `${s.total.toFixed(1)} hrs` : `${s.total} runs`}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--ink-3)', width: 50, textAlign: 'right' }}
                >
                  {grandTotal > 0 ? ((s.total / grandTotal) * 100).toFixed(1) : '0'}%
                </span>
              </div>
            )
          })}
        </div>
        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
      </div>
    </>
  )
}
