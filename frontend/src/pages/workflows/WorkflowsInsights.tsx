import { useState, useMemo, useEffect } from 'react'
import { Search, ChevronRight, Workflow as WorkflowIcon } from 'lucide-react'
import type { Workflow, Server } from '../../types'
import { fmtDur, serverLabel, type CatInfo } from './workflowsHelpers'
import { api } from '../../lib/api'
import { Kpi } from '../../components/ui/Kpi'
import { rangeToDays, rangeLabel, type Range } from '../analytics/analyticsHelpers'

type WfStat = {
  workflowName: string
  total: number
  completed: number
  failed: number
  successRate: number
  avgDurationMs: number | null
}

/* ─── Insights tab ───────────────────────────────────────────── */
export function WorkflowsInsights({
  groups,
  servers,
  onOpen,
  range,
}: {
  groups: CatInfo[]
  servers: Server[]
  onOpen: (cat: CatInfo, wf: Workflow) => void
  range: Range
}) {
  type SortKey = 'name' | 'runs' | 'success' | 'avg'
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('runs')
  const [dir, setDir] = useState<'desc' | 'asc'>('desc')
  const [catFilter, setCatFilter] = useState('all')
  const [stats, setStats] = useState<WfStat[]>([])

  const days = rangeToDays(range)

  useEffect(() => {
    api
      .get<{ byWorkflow: WfStat[] }>(`/api/analytics?days=${days}`)
      .then((d) => setStats(d.byWorkflow ?? []))
      .catch(() => {})
  }, [days])

  const statMap = useMemo(() => {
    const m: Record<string, WfStat> = {}
    for (const s of stats) m[s.workflowName.toLowerCase()] = s
    return m
  }, [stats])

  const all = useMemo(
    () =>
      groups.flatMap((c) =>
        c.items.map((it) => {
          const s = statMap[it.path?.toLowerCase() ?? ''] ?? statMap[it.name.toLowerCase()]
          return {
            ...it,
            cat: c,
            runs: s?.total ?? 0,
            success: s?.successRate ?? 0,
            avgSec: s?.avgDurationMs != null ? Math.round(s.avgDurationMs / 1000) : null,
          }
        }),
      ),
    [groups, statMap],
  )

  const visible = useMemo(
    () =>
      all
        .filter((w) => catFilter === 'all' || w.cat.id === catFilter)
        .filter(
          (w) =>
            !filter ||
            (w.name + ' ' + (w.description ?? '')).toLowerCase().includes(filter.toLowerCase()),
        )
        .sort((a, b) => {
          if (sort === 'name') {
            const cmp = a.name.localeCompare(b.name)
            return dir === 'desc' ? -cmp : cmp
          }
          const va = sort === 'runs' ? a.runs : sort === 'success' ? a.success : (a.avgSec ?? -1)
          const vb = sort === 'runs' ? b.runs : sort === 'success' ? b.success : (b.avgSec ?? -1)
          return dir === 'desc' ? vb - va : va - vb
        }),
    [all, catFilter, filter, sort, dir],
  )

  const totalRuns = all.reduce((n, w) => n + w.runs, 0)
  const avgSuccess = all.filter((w) => w.runs > 0).length
    ? (
        all.filter((w) => w.runs > 0).reduce((n, w) => n + w.success, 0) /
        all.filter((w) => w.runs > 0).length
      ).toFixed(1)
    : '0'
  const slowest = [...all]
    .filter((w) => w.avgSec != null)
    .sort((a, b) => (b.avgSec ?? 0) - (a.avgSec ?? 0))[0]
  const maxRuns = Math.max(...all.map((w) => w.runs), 1)
  const maxAvg = Math.max(...all.map((w) => w.avgSec ?? 0), 1)

  function Th({
    id,
    children,
    align,
  }: {
    id: SortKey
    children: React.ReactNode
    align?: React.CSSProperties['textAlign']
  }) {
    return (
      <th
        onClick={() => {
          if (sort === id) setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
          else {
            setSort(id)
            setDir('desc')
          }
        }}
        style={{ cursor: 'pointer', textAlign: align ?? 'left', userSelect: 'none' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {children}
          {sort === id && (
            <span style={{ fontSize: 9, color: 'var(--accent)' }}>
              {dir === 'desc' ? '▼' : '▲'}
            </span>
          )}
        </span>
      </th>
    )
  }

  function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
    return (
      <div
        className="bar"
        style={{ width: 60, display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }}
      >
        <i style={{ width: (value / max) * 100 + '%', background: color }} />
      </div>
    )
  }

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Workflows" value={all.length} chip={`${groups.length} categories`} />
        <Kpi
          label={`Total runs · ${rangeLabel(range)}`}
          value={totalRuns.toLocaleString()}
          valueColor="var(--accent)"
          chip="across all workflows"
        />
        <Kpi
          label="Avg success rate"
          value={`${avgSuccess}%`}
          valueColor={Number(avgSuccess) >= 90 ? 'var(--good)' : 'var(--warn)'}
          chip="workflows with runs"
        />
        <div className="card card-pad">
          <div className="stat-label">Slowest avg</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {slowest?.avgSec != null ? fmtDur(slowest.avgSec) : '—'}
          </div>
          {slowest && (
            <span className="chip" style={{ marginTop: 6, fontSize: 10 }}>
              {slowest.name}
            </span>
          )}
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div className="search">
          <span className="search-icon">
            <Search size={14} />
          </span>
          <input
            className="input"
            placeholder="Search workflows…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="toggle-group">
          <button
            className={catFilter === 'all' ? 'active' : ''}
            onClick={() => setCatFilter('all')}
          >
            All
          </button>
          {groups.map((c) => (
            <button
              key={c.id}
              className={catFilter === c.id ? 'active' : ''}
              onClick={() => setCatFilter(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {visible.length} workflow{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Per-workflow performance</div>
          <span className="chip" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            last {rangeLabel(range)}
          </span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <Th id="name">Workflow</Th>
              <th>Servers</th>
              <Th id="runs" align="right">
                Runs
              </Th>
              <Th id="success" align="right">
                Success
              </Th>
              <Th id="avg" align="right">
                Avg duration
              </Th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((w) => (
              <tr key={w.id} onClick={() => onOpen(w.cat, w)} style={{ cursor: 'pointer' }}>
                <td style={{ width: 32 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 5,
                      background: w.cat.color,
                      display: 'grid',
                      placeItems: 'center',
                      color: 'white',
                    }}
                  >
                    <WorkflowIcon size={11} />
                  </span>
                </td>
                <td>
                  <strong>{w.name}</strong>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{w.cat.name}</div>
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {w.serverUrls.slice(0, 3).map((url) => (
                      <span
                        key={url}
                        className="chip mono"
                        style={{ fontSize: 10, padding: '2px 6px' }}
                      >
                        {serverLabel(url, servers)}
                      </span>
                    ))}
                    {w.serverUrls.length > 3 && (
                      <span className="chip" style={{ fontSize: 10, padding: '2px 6px' }}>
                        +{w.serverUrls.length - 3}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {w.runs > 0 && <MiniBar value={w.runs} max={maxRuns} color="var(--accent)" />}
                  <span className="mono" style={{ fontSize: 12 }}>
                    {w.runs > 0 ? w.runs : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {w.runs > 0 ? (
                    <span
                      className={`chip chip-${w.success >= 95 ? 'good' : w.success >= 88 ? 'info' : w.success >= 82 ? 'warn' : 'bad'}`}
                      style={{ fontSize: 11 }}
                    >
                      {w.success}%
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {w.avgSec != null ? (
                    <>
                      <MiniBar value={w.avgSec} max={maxAvg} color="var(--info)" />
                      <span className="mono" style={{ fontSize: 12 }}>
                        {fmtDur(w.avgSec)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ width: 24, color: 'var(--ink-3)' }}>
                  <ChevronRight size={12} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
