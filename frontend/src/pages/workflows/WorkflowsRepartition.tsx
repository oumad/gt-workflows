import { useState, useMemo, useEffect } from 'react'
import { Search, Workflow as WorkflowIcon } from 'lucide-react'
import { type CatInfo } from './workflowsHelpers'
import { api } from '../../lib/api'
import { rangeToDays, rangeLabel, type Range } from '../analytics/analyticsHelpers'

type RepRow = {
  server_name: string
  workflow_name: string
  total: number
}

/* ─── Repartition tab ───────────────────────────────────────── */
export function WorkflowsRepartition({ groups, range }: { groups: CatInfo[]; range: Range }) {
  const [mode, setMode] = useState<'workflow' | 'server'>('workflow')
  const [unit, setUnit] = useState<'pct' | 'count'>('pct')
  const [filter, setFilter] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [repData, setRepData] = useState<RepRow[]>([])

  const days = rangeToDays(range)

  useEffect(() => {
    api
      .get<RepRow[]>(`/api/analytics/repartition?days=${days}`)
      .then(setRepData)
      .catch(() => {})
  }, [days])

  const all = useMemo(
    () => groups.flatMap((c) => c.items.map((it) => ({ ...it, cat: c }))),
    [groups],
  )

  const filtered = useMemo(
    () =>
      all
        .filter((w) => catFilter === 'all' || w.cat.id === catFilter)
        .filter((w) => !filter || w.name.toLowerCase().includes(filter.toLowerCase())),
    [all, catFilter, filter],
  )

  // Build distribution from real data: map workflow (by path) → server counts
  const dist = useMemo(
    () =>
      filtered
        .map((w) => {
          const wfName = w.path?.toLowerCase() ?? w.name.toLowerCase()
          const rows = repData.filter((r) => r.workflow_name?.toLowerCase() === wfName)
          const totalRuns = rows.reduce((n, r) => n + r.total, 0)
          const parts = rows
            .filter((r) => r.total > 0)
            .map((r) => ({
              server: r.server_name,
              count: r.total,
              pct: totalRuns > 0 ? r.total / totalRuns : 0,
            }))
            .sort((a, b) => b.count - a.count)
          return { wf: w, parts, totalRuns }
        })
        .sort((a, b) => b.totalRuns - a.totalRuns),
    [filtered, repData],
  )

  const usedServers = useMemo(
    () => Array.from(new Set(dist.flatMap((d) => d.parts.map((p) => p.server)))).sort(),
    [dist],
  )

  const serverCounts: Record<string, number> = {}
  const serverPctTotals: Record<string, number> = {}
  usedServers.forEach((s) => {
    serverCounts[s] = dist.reduce(
      (n, d) => n + (d.parts.find((p) => p.server === s)?.count ?? 0),
      0,
    )
    serverPctTotals[s] = dist.reduce(
      (n, d) => n + (d.parts.find((p) => p.server === s)?.pct ?? 0),
      0,
    )
  })
  const maxServerCount = Math.max(1, ...Object.values(serverCounts))

  const cellPct = (d: (typeof dist)[0], server: string) => {
    const part = d.parts.find((p) => p.server === server)
    if (!part) return 0
    return mode === 'workflow' ? part.pct : part.pct / (serverPctTotals[server] || 1)
  }
  const cellCount = (d: (typeof dist)[0], s: string) =>
    d.parts.find((p) => p.server === s)?.count ?? 0
  const cellIntensity = (d: (typeof dist)[0], s: string) => {
    if (unit === 'pct') return cellPct(d, s)
    const c = cellCount(d, s)
    return mode === 'workflow' ? c / Math.max(1, d.totalRuns) : c / maxServerCount
  }
  const cellColor = (pct: number) => {
    if (pct === 0) return 'transparent'
    return `color-mix(in oklab, var(--accent) ${Math.round((0.08 + pct * 0.85) * 100)}%, var(--surface))`
  }

  const hasData = dist.some((d) => d.totalRuns > 0)

  return (
    <>
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
      </div>

      {!hasData && repData.length > 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40, fontSize: 13 }}>
          No matching job data for the selected workflows in the last {rangeLabel(range)}.
        </div>
      )}

      {hasData && (
        <>
          <div
            className="row"
            style={{ marginBottom: 10, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Show:</span>
            <div className="toggle-group">
              <button className={unit === 'pct' ? 'active' : ''} onClick={() => setUnit('pct')}>
                %
              </button>
              <button className={unit === 'count' ? 'active' : ''} onClick={() => setUnit('count')}>
                Runs
              </button>
            </div>
            {unit === 'pct' && (
              <>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>
                  Normalize by:
                </span>
                <div className="toggle-group">
                  <button
                    className={mode === 'workflow' ? 'active' : ''}
                    onClick={() => setMode('workflow')}
                  >
                    workflow row
                  </button>
                  <button
                    className={mode === 'server' ? 'active' : ''}
                    onClick={() => setMode('server')}
                  >
                    server column
                  </button>
                </div>
              </>
            )}
            <span className="spacer" />
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>low</span>
              <div
                style={{
                  width: 100,
                  height: 8,
                  borderRadius: 4,
                  background:
                    'linear-gradient(to right, color-mix(in oklab, var(--accent) 8%, var(--surface)), var(--accent))',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>high</span>
            </div>
          </div>

          <div className="card" style={{ overflow: 'auto' }}>
            <table className="data-table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      background: 'var(--surface-2)',
                      minWidth: 240,
                    }}
                  >
                    Workflow
                  </th>
                  {usedServers.map((s) => (
                    <th
                      key={s}
                      style={{
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono)',
                        textTransform: 'none',
                        letterSpacing: 0,
                        fontSize: 11,
                      }}
                    >
                      {s}
                    </th>
                  ))}
                  <th
                    style={{
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      fontSize: 11,
                      borderLeft: '1px solid var(--line)',
                    }}
                  >
                    Total runs
                  </th>
                </tr>
              </thead>
              <tbody>
                {dist
                  .filter((d) => d.totalRuns > 0)
                  .map((d) => (
                    <tr key={d.wf.id}>
                      <td
                        style={{
                          position: 'sticky',
                          left: 0,
                          background: 'var(--surface)',
                          zIndex: 1,
                        }}
                      >
                        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 4,
                              background: d.wf.cat.color,
                              display: 'grid',
                              placeItems: 'center',
                              color: 'white',
                            }}
                          >
                            <WorkflowIcon size={9} />
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{d.wf.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                              {d.wf.cat.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      {usedServers.map((s) => {
                        const intensity = cellIntensity(d, s)
                        const count = cellCount(d, s)
                        const pct = cellPct(d, s)
                        const label =
                          unit === 'pct' ? `${Math.round(pct * 100)}%` : count.toLocaleString()
                        return (
                          <td key={s} style={{ textAlign: 'center', padding: 4 }}>
                            {count > 0 ? (
                              <div
                                title={`${d.wf.name} on ${s}: ${count.toLocaleString()} runs`}
                                style={{
                                  padding: '8px 4px',
                                  borderRadius: 6,
                                  background: cellColor(intensity),
                                  color: intensity > 0.45 ? 'white' : 'var(--ink)',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  minWidth: 48,
                                }}
                              >
                                {label}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>—</span>
                            )}
                          </td>
                        )
                      })}
                      <td
                        style={{
                          textAlign: 'center',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          fontWeight: 600,
                          borderLeft: '1px solid var(--line)',
                        }}
                      >
                        {d.totalRuns.toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                  <td
                    style={{
                      position: 'sticky',
                      left: 0,
                      background: 'var(--surface-2)',
                      zIndex: 1,
                      fontWeight: 600,
                      fontSize: 12,
                      color: 'var(--ink-2)',
                    }}
                  >
                    Server total
                  </td>
                  {usedServers.map((s) => (
                    <td
                      key={s}
                      style={{
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--ink-2)',
                      }}
                    >
                      {serverCounts[s].toLocaleString()}
                    </td>
                  ))}
                  <td
                    style={{
                      textAlign: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      borderLeft: '1px solid var(--line)',
                    }}
                  >
                    {dist.reduce((n, d) => n + d.totalRuns, 0).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  )
}
