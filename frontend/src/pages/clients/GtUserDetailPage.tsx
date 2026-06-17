import { useState, useEffect } from 'react'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { api } from '../../lib/api'
import type { GtUser, UserStats } from './gtUserDetailTypes'
import { useTabWithUrl } from '../../hooks/useTabWithUrl'
import { avatarColor, initials, relTime } from './gtUserDetailHelpers'
import { OverviewTab } from './GtUserOverviewTab'
import { WorkflowsTab } from './GtUserWorkflowsTab'
import { LorasTab } from './GtUserLorasTab'
import { ServersTab } from './GtUserServersTab'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void
type Props = { userId: string; onBack: () => void; navigate?: NavigateFn }

export function GtUserDetailPage({ userId, onBack, navigate }: Props) {
  const [user, setUser] = useState<GtUser | null>(null)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useTabWithUrl('overview', ['overview', 'workflows', 'loras', 'servers'])

  useEffect(() => {
    setLoading(true)
    // Don't reset the tab here — useTabWithUrl already restores it from ?tab=
    // on mount; forcing 'overview' would clobber a deep-linked/bookmarked tab.
    Promise.all([
      api.get<GtUser>(`/api/gt-users/${userId}`),
      api.get<UserStats>(`/api/gt-users/${userId}/stats`),
    ])
      .then(([u, s]) => {
        setUser(u)
        setStats(s)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) {
    return (
      <>
        <PageHead
          crumbs={['Admin', { label: 'GT Users', onClick: onBack }, 'Loading…']}
          title="Loading…"
        />
        <div className="body" style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>
          Loading…
        </div>
      </>
    )
  }

  if (!user || !stats) {
    return (
      <>
        <PageHead
          crumbs={['Admin', { label: 'GT Users', onClick: onBack }, 'Not found']}
          title="User not found"
        />
        <div className="body" style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>
          User not found.
        </div>
      </>
    )
  }

  const color = avatarColor(user.id)
  const ini = initials(user.name, user.email)
  const lastSeen = relTime(user.lastSeenAt)

  const TABS = [
    { id: 'overview', label: 'Overview', pill: stats.totalJobs > 0 ? stats.totalJobs : undefined },
    { id: 'workflows', label: 'Workflows', pill: stats.wfJobs > 0 ? stats.wfJobs : undefined },
    { id: 'loras', label: 'LoRAs', pill: stats.loraJobs > 0 ? stats.loraJobs : undefined },
    { id: 'servers', label: 'Services' },
  ]

  return (
    <>
      <PageHead
        crumbs={[
          'Admin',
          { label: 'GT Users', onClick: onBack },
          user.name ?? user.email ?? user.id,
        ]}
        title={user.name ?? user.email ?? 'Unknown user'}
        sub={user.email ?? undefined}
        actions={null}
      />

      <div className="body">
        {/* User header card */}
        <div
          className="card card-pad row"
          style={{ gap: 16, marginBottom: 16, alignItems: 'center' }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              flexShrink: 0,
              background: color,
              color: 'white',
              display: 'grid',
              placeItems: 'center',
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {ini}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{user.name ?? 'Unnamed'}</span>
              <span className="chip" style={{ fontSize: 10 }}>
                MEMBER
              </span>
              <span className={`chip chip-${lastSeen.tone}`} style={{ fontSize: 10 }}>
                <span className="dot" /> {lastSeen.label}
              </span>
            </div>
            {user.email && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{user.email}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
              Member since{' '}
              {new Date(user.firstSeenAt).toLocaleDateString('en', {
                month: 'long',
                year: 'numeric',
              })}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="stat-value" style={{ fontSize: 28 }}>
              {stats.totalJobs.toLocaleString()}
            </div>
            <div className="stat-label">total jobs</div>
          </div>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <div style={{ marginTop: 16 }}>
          {tab === 'overview' && <OverviewTab user={user} stats={stats} />}
          {tab === 'workflows' && <WorkflowsTab user={user} stats={stats} navigate={navigate} />}
          {tab === 'loras' && <LorasTab user={user} stats={stats} navigate={navigate} />}
          {tab === 'servers' && <ServersTab user={user} stats={stats} navigate={navigate} />}
        </div>
      </div>
    </>
  )
}
