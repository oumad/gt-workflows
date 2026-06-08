import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { api } from '../../lib/api'
import type { NavigateFn } from '../../types'

/**
 * Top GT users on a given server over a recent window. Powers the "Top users"
 * panel on the server detail Overview tab — answers "who is monopolising
 * worker-03" in one click. Clicking a row routes to the client detail page
 * when the underlying user is known.
 */

type TopUser = {
  userId: string | null
  userName: string
  total: number
  running: number
  failed: number
  completed: number
  lastAt: string | null
}

const WINDOWS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
] as const

export function ServerTopUsersWidget({
  serverId,
  navigate,
}: {
  serverId: string
  navigate?: NavigateFn
}) {
  const [hours, setHours] = useState<number>(1)
  const [rows, setRows] = useState<TopUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get<TopUser[]>(`/api/servers/${serverId}/top-users?hours=${hours}&limit=10`)
      .then((d) => {
        if (!cancelled) setRows(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverId, hours])

  const maxTotal = Math.max(1, ...rows.map((r) => r.total))

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title row" style={{ gap: 6 }}>
          <Users size={13} /> Top users
        </div>
        <span className="spacer" />
        <div className="toggle-group">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              className={hours === w.hours ? 'active' : ''}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card-pad col" style={{ gap: 8 }}>
        {loading ? (
          <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</span>
        ) : error ? (
          <span style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</span>
        ) : rows.length === 0 ? (
          <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>
            No activity in the last {hours}h on this {hours === 1 ? 'hour' : 'window'}.
          </span>
        ) : (
          rows.map((u) => {
            const widthPct = (u.total / maxTotal) * 100
            const failPct = u.total > 0 ? (u.failed / u.total) * 100 : 0
            const tone = failPct >= 25 ? 'var(--bad)' : failPct >= 10 ? 'var(--warn)' : 'var(--accent)'
            const clickable = !!(u.userId && navigate)
            return (
              <button
                key={`${u.userId ?? 'anon'}-${u.userName}`}
                type="button"
                onClick={
                  clickable ? () => navigate!('clients', `/gt-users/${u.userId}`) : undefined
                }
                disabled={!clickable}
                title={
                  clickable
                    ? `Open ${u.userName}'s detail page`
                    : 'No linked user record — click-through not available.'
                }
                style={{
                  display: 'block',
                  textAlign: 'left',
                  width: '100%',
                  padding: 8,
                  borderRadius: 6,
                  background: 'transparent',
                  border: '1px solid transparent',
                  cursor: clickable ? 'pointer' : 'default',
                  font: 'inherit',
                  color: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (clickable) e.currentTarget.style.background = 'var(--surface-2)'
                }}
                onMouseLeave={(e) => {
                  if (clickable) e.currentTarget.style.background = 'transparent'
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{u.userName}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {u.total} runs
                  </span>
                </div>
                <div className="bar" style={{ marginBottom: 4 }}>
                  <i style={{ width: `${widthPct}%`, background: tone }} />
                </div>
                <div
                  className="row"
                  style={{
                    gap: 8,
                    fontSize: 10,
                    color: 'var(--ink-3)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {u.running > 0 && <span style={{ color: 'var(--info)' }}>{u.running} running</span>}
                  <span style={{ color: 'var(--good)' }}>{u.completed} ok</span>
                  {u.failed > 0 && <span style={{ color: 'var(--bad)' }}>{u.failed} failed</span>}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
