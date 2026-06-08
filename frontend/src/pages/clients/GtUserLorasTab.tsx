import { History } from '../jobs/shared'
import { Kpi } from '../../components/ui/Kpi'
import type { UserStats, GtUser } from './gtUserDetailTypes'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void

/** User → LoRA training runs. KPI headline + full History locked to this user
 *  and hard-locked to the `lora` job type. */
export function LorasTab({
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
        <Kpi label="LoRA jobs" value={stats.loraJobs.toLocaleString()} />
        <Kpi label="Distinct base models" value={stats.distinctModels} valueColor="var(--info)" />
        <Kpi
          label="Cluster rank · LoRA"
          valueMono
          valueSize={22}
          value={
            <>
              {stats.loraRank != null ? `#${stats.loraRank}` : '—'}
              {stats.loraRank != null && stats.loraUsers > 0 && (
                <span style={{ color: 'var(--ink-3)', fontSize: 13, marginLeft: 6 }}>
                  / {stats.loraUsers}
                </span>
              )}
            </>
          }
        />
      </div>
      <History
        lock={{ kind: 'user', id: user.id, label: user.name ?? user.email ?? user.id }}
        jobKind="lora"
        navigate={navigate}
      />
    </>
  )
}
