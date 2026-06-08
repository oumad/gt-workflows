import { History } from '../jobs/shared'
import { Kpi } from '../../components/ui/Kpi'
import type { UserStats, GtUser } from './gtUserDetailTypes'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void

/** User → workflow runs. Headline KPIs above the full /jobs History component,
 *  locked to this user and hard-locked to the `wf` job type. */
export function WorkflowsTab({
  user,
  stats,
  navigate,
}: {
  user: GtUser
  stats: UserStats
  navigate?: NavigateFn
}) {
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Kpi label="Workflow jobs" value={stats.wfJobs.toLocaleString()} />
        <Kpi label="Distinct workflows" value={stats.distinctWorkflows} valueColor="var(--info)" />
        <Kpi
          label="Cluster rank · WF"
          valueMono
          valueSize={22}
          value={
            <>
              {stats.wfRank != null ? `#${stats.wfRank}` : '—'}
              {stats.wfRank != null && stats.wfUsers > 0 && (
                <span style={{ color: 'var(--ink-3)', fontSize: 13, marginLeft: 6 }}>
                  / {stats.wfUsers}
                </span>
              )}
            </>
          }
        />
      </div>
      <History
        lock={{ kind: 'user', id: user.id, label: user.name ?? user.email ?? user.id }}
        jobKind="wf"
        navigate={navigate}
      />
    </>
  )
}
