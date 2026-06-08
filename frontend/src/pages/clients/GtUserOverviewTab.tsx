import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import type { GtUser, UserStats, ActivityRow } from './gtUserDetailTypes'
import { RankChip, fmtDate } from './gtUserDetailHelpers'
import { History } from '../jobs/shared'

type Period = 'week' | 'month' | 'year' | 'all'

export function OverviewTab({ user, stats }: { user: GtUser; stats: UserStats }) {
  const [period, setPeriod] = useState<Period>('month')
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [actLoad, setActLoad] = useState(true)

  useEffect(() => {
    setActLoad(true)
    api
      .get<ActivityRow[]>(`/api/gt-users/${user.id}/activity?period=${period}`)
      .then(setActivity)
      .catch(() => setActivity([]))
      .finally(() => setActLoad(false))
  }, [user.id, period])

  const maxAct = Math.max(...activity.map((d) => d.total), 1)

  return (
    <>
      {/* Breakdown + Activity */}
      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr', marginBottom: 16 }}>
        {/* Activity chart */}
        <div className="card card-pad col" style={{ gap: 12 }}>
          <div className="row">
            <div className="card-title">Activity</div>
            <span className="spacer" />
            {(['week', 'month', 'year', 'all'] as Period[]).map((p) => (
              <button
                key={p}
                className={`btn btn-xs${period === p ? ' btn-active' : ' btn-ghost'}`}
                style={{ fontSize: 10, padding: '2px 6px' }}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {actLoad ? (
            <div
              style={{
                height: 80,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--ink-3)',
                fontSize: 12,
              }}
            >
              Loading…
            </div>
          ) : activity.length === 0 ? (
            <div
              style={{
                height: 80,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--ink-3)',
                fontSize: 12,
              }}
            >
              No activity
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 3, height: 80, alignItems: 'flex-end' }}>
                {activity.map((d, i) => {
                  const totalH = Math.round((d.total / maxAct) * 80)
                  const wfH = d.total > 0 ? Math.round((d.wf / d.total) * totalH) : 0
                  const lorH = totalH - wfH
                  return (
                    <div
                      key={i}
                      title={`${fmtDate(d.date)}: ${d.wf} WF, ${d.lora} LoRA`}
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
                          height: totalH,
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{ height: lorH, background: 'var(--pop-purple)', opacity: 0.8 }}
                        />
                        <div style={{ height: wfH, background: 'var(--info)' }} />
                      </div>
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
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>{fmtDate(activity[0].date)}</span>
                {activity.length > 2 && (
                  <span>{fmtDate(activity[Math.floor(activity.length / 2)].date)}</span>
                )}
                <span>{fmtDate(activity[activity.length - 1].date)}</span>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span className="row" style={{ gap: 4, fontSize: 11, color: 'var(--ink-3)' }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: 'var(--info)',
                      borderRadius: 2,
                      display: 'inline-block',
                    }}
                  />{' '}
                  Workflows
                </span>
                <span className="row" style={{ gap: 4, fontSize: 11, color: 'var(--ink-3)' }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: 'var(--pop-purple)',
                      borderRadius: 2,
                      display: 'inline-block',
                      opacity: 0.8,
                    }}
                  />{' '}
                  LoRA
                </span>
              </div>
            </>
          )}
        </div>

        {/* Breakdown */}
        <div className="card card-pad col" style={{ gap: 10 }}>
          <div className="card-title">Breakdown</div>
          {[
            { label: 'Workflow jobs', value: stats.wfJobs.toLocaleString() },
            { label: 'LoRA jobs', value: stats.loraJobs.toLocaleString() },
            { label: 'Workflows used', value: stats.distinctWorkflows },
            { label: 'LoRA models used', value: stats.distinctModels },
            { label: 'Avg jobs / day', value: stats.avgPerDay },
          ].map(({ label, value }) => (
            <div key={label} className="row" style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--ink-3)' }}>{label}</span>
              <span className="spacer" />
              <span className="mono" style={{ fontWeight: 600 }}>
                {value}
              </span>
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>
              Rank
            </div>
            {[
              { label: 'Total jobs', rank: stats.totalRank, of: stats.totalUsers },
              { label: 'Workflow jobs', rank: stats.wfRank, of: stats.wfUsers },
              { label: 'LoRA jobs', rank: stats.loraRank, of: stats.loraUsers },
            ].map(({ label, rank, of }) => (
              <div key={label} className="row" style={{ fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: 'var(--ink-3)' }}>{label}</span>
                <span className="spacer" />
                <RankChip rank={rank} of={of} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Job history — full /jobs History component locked to this user. */}
      <History lock={{ kind: 'user', id: user.id, label: user.name ?? user.email ?? user.id }} />
    </>
  )
}
