import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Kpi } from '../../components/ui/Kpi'
import { fmtDurationMs } from '../../lib/format'
import type { UserStats, GtUser, ServerRow } from './gtUserDetailTypes'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void

/** User → services they've run on. Headline KPIs above a per-service
 *  aggregate (jobs, time spent, share of the service's traffic, the user's
 *  rank on that service). Previously this tab embedded the History component,
 *  so it showed individual job rows instead of a service breakdown — which
 *  was the wrong drill axis for a tab labelled "Services". */
export function ServersTab({
  user,
  stats,
}: {
  user: GtUser
  stats: UserStats
  // `navigate` is still passed by the parent for symmetry with the other
  // tabs; this tab doesn't need it (no job-row click-throughs anymore).
  navigate?: NavigateFn
}) {
  const [rows, setRows] = useState<ServerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    setError(null)
    api
      .get<ServerRow[]>(`/api/gt-users/${user.id}/servers`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [user.id])

  return (
    <>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Kpi label="Total jobs" value={stats.totalJobs.toLocaleString()} />
        <Kpi label="Avg per day" value={stats.avgPerDay.toFixed(1)} valueColor="var(--accent)" />
        <Kpi
          label="Cluster rank · total"
          valueMono
          valueSize={22}
          value={
            <>
              {stats.totalRank != null ? `#${stats.totalRank}` : '—'}
              {stats.totalRank != null && stats.totalUsers > 0 && (
                <span style={{ color: 'var(--ink-3)', fontSize: 13, marginLeft: 6 }}>
                  / {stats.totalUsers}
                </span>
              )}
            </>
          }
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Services used</div>
          {rows && rows.length > 0 && (
            <span className="chip" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
              {rows.length} service{rows.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {error ? (
          <div style={{ padding: 24, color: 'var(--bad)', fontSize: 13 }}>{error}</div>
        ) : rows == null ? (
          <div
            style={{ padding: 24, color: 'var(--ink-3)', fontSize: 13, textAlign: 'center' }}
          >
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{ padding: 24, color: 'var(--ink-3)', fontSize: 13, textAlign: 'center' }}
          >
            This user has not run any jobs on a tracked service.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th style={{ width: 80 }}>Type</th>
                <th style={{ textAlign: 'right', width: 90 }}>My jobs</th>
                <th style={{ textAlign: 'right', width: 110 }}>My time</th>
                <th style={{ textAlign: 'right', width: 90 }}>Share</th>
                <th style={{ textAlign: 'right', width: 120 }}>My rank</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const userMs = Number(r.userDurationMs ?? 0)
                const sharePct =
                  r.totalJobs > 0 ? Math.round((r.userJobs / r.totalJobs) * 100) : 0
                return (
                  <tr key={r.serverId ?? r.serverName}>
                    <td>
                      <strong>{r.serverName}</strong>
                    </td>
                    <td>
                      {r.serverType && (
                        <span className="chip" style={{ fontSize: 10 }}>
                          {r.serverType}
                        </span>
                      )}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                      {r.userJobs.toLocaleString()}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                      {fmtDurationMs(userMs)}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                      {sharePct}%
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                      {r.rank != null ? `#${r.rank}` : '—'}
                      {r.rank != null && r.totalUsers > 0 && (
                        <span style={{ color: 'var(--ink-3)', marginLeft: 4 }}>
                          / {r.totalUsers}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
