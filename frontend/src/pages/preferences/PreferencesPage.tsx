import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'
import type { User } from '../../types'
import { PersonalTokensCard } from './PersonalTokensCard'
import { McpToolsCard } from './McpToolsCard'
import { ChangePasswordCard } from './ChangePasswordCard'

export type WorkflowLayout = 'cards' | 'list'
export type AutoRefresh = '5' | '30' | '60' | 'off'

export type Prefs = {
  workflowLayout: WorkflowLayout
  autoRefresh: AutoRefresh
  /** GT-user id the current operator identifies as. When set, Jobs Live + History
   *  expose a "Mine" toggle that filters to this user's runs. Stored as the
   *  gt_users.id (UUID). null = unset. */
  myGtUserId: string | null
  /** Display name cached alongside the id so the picker can show "(currently:
   *  alice)" without re-fetching. Refreshed whenever the picker is used. */
  myGtUserLabel: string | null
}

const AUTO_REFRESH_OPTIONS: { value: AutoRefresh; label: string }[] = [
  { value: '5', label: '5 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: 'off', label: 'Off' },
]

const USERNAME_RE = /^[a-z0-9._-]+$/

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem('coffee-maker-prefs') || '{}')
    return {
      workflowLayout: raw.workflowLayout ?? 'cards',
      autoRefresh: raw.autoRefresh ?? '5',
      myGtUserId: raw.myGtUserId ?? null,
      myGtUserLabel: raw.myGtUserLabel ?? null,
    }
  } catch {
    return {
      workflowLayout: 'cards',
      autoRefresh: '5',
      myGtUserId: null,
      myGtUserLabel: null,
    }
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem('coffee-maker-prefs', JSON.stringify(p))
  } catch {}
}

export function PreferencesPage() {
  const { user, setUser } = useAuth()
  const saved = loadPrefs()

  const [displayName, setDisplayName] = useState<string>(user?.username ?? '')
  const [workflowLayout, setWorkflowLayout] = useState<WorkflowLayout>(saved.workflowLayout)
  const [autoRefresh, setAutoRefresh] = useState<AutoRefresh>(saved.autoRefresh)
  const [myGtUserId, setMyGtUserId] = useState<string | null>(saved.myGtUserId)
  const [myGtUserLabel, setMyGtUserLabel] = useState<string | null>(saved.myGtUserLabel)
  const [savedTick, setSavedTick] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // GT-user picker state — searches /api/gt-users on debounce. The currently
  // selected id+label live in component state; they're persisted on Save.
  const [gtQuery, setGtQuery] = useState('')
  const [gtResults, setGtResults] = useState<
    { id: string; name: string | null; email: string | null }[]
  >([])
  const [gtLoading, setGtLoading] = useState(false)
  useEffect(() => {
    if (!gtQuery.trim()) {
      setGtResults([])
      return
    }
    const id = setTimeout(async () => {
      setGtLoading(true)
      try {
        const res = await api.get<{
          items: { id: string; name: string | null; email: string | null }[]
        }>(`/api/gt-users?limit=10&q=${encodeURIComponent(gtQuery.trim())}`)
        setGtResults(res.items ?? [])
      } catch {
        setGtResults([])
      } finally {
        setGtLoading(false)
      }
    }, 300)
    return () => clearTimeout(id)
  }, [gtQuery])

  const normalized = displayName.toLowerCase().trim()
  const nameChanged = normalized !== (user?.username ?? '')
  const layoutChanged = workflowLayout !== saved.workflowLayout
  const refreshChanged = autoRefresh !== saved.autoRefresh
  const gtUserChanged = myGtUserId !== saved.myGtUserId
  const dirty = nameChanged || layoutChanged || refreshChanged || gtUserChanged
  const nameValid = !nameChanged || (normalized.length >= 2 && USERNAME_RE.test(normalized))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (nameChanged) {
        const updated = await api.patch<User>('/api/users/me', { username: normalized })
        setUser(updated)
      }
      if (layoutChanged || refreshChanged || gtUserChanged) {
        savePrefs({ workflowLayout, autoRefresh, myGtUserId, myGtUserLabel })
      }
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead
        crumbs={['Admin', 'Preferences']}
        title="Preferences"
        sub="Personal settings — only visible to you"
        actions={
          <>
            {savedTick && (
              <span className="chip chip-good">
                <Check size={11} /> Saved
              </span>
            )}
            <button
              className="btn btn-sm btn-primary"
              disabled={!dirty || !nameValid || busy}
              style={{ opacity: dirty && nameValid && !busy ? 1 : 0.5 }}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save preferences'}
            </button>
          </>
        }
      />
      <div className="body">
        <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr', maxWidth: 1100 }}>
          <div className="col" style={{ gap: 16 }}>
            <div className="card card-pad col" style={{ gap: 14 }}>
              <div className="card-title">Profile</div>
              <div className="form-row">
                <label>Display name</label>
                <input
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How your name appears across the hub"
                />
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                  This is also your login username. Lowercase letters, numbers, and{' '}
                  <code>. _ -</code>.
                </div>
                {nameChanged && !nameValid && (
                  <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 4 }}>
                    Username must be 2+ chars: lowercase letters, numbers, <code>. _ -</code>.
                  </div>
                )}
                {error && (
                  <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 4 }}>{error}</div>
                )}
              </div>
            </div>

            <ChangePasswordCard />

            <div className="card card-pad col" style={{ gap: 14 }}>
              <div className="card-title">Workflows</div>
              <div className="form-row">
                <label>Default layout</label>
                <div className="toggle-group">
                  <button
                    className={workflowLayout === 'cards' ? 'active' : ''}
                    onClick={() => setWorkflowLayout('cards')}
                  >
                    Cards
                  </button>
                  <button
                    className={workflowLayout === 'list' ? 'active' : ''}
                    onClick={() => setWorkflowLayout('list')}
                  >
                    List
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                  How workflows are displayed when you open the Workflows page.
                </div>
              </div>
            </div>

            <div className="card card-pad col" style={{ gap: 14 }}>
              <div className="card-title">Identity in Jobs</div>
              <div className="form-row">
                <label>I am this GT user</label>
                {myGtUserId && myGtUserLabel ? (
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="chip chip-good" style={{ fontSize: 11 }}>
                      <Check size={11} /> {myGtUserLabel}
                    </span>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setMyGtUserId(null)
                        setMyGtUserLabel(null)
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="input"
                      placeholder="Search by username or email…"
                      value={gtQuery}
                      onChange={(e) => setGtQuery(e.target.value)}
                    />
                    {gtQuery.trim() && (
                      <div
                        className="col"
                        style={{
                          marginTop: 6,
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          maxHeight: 200,
                          overflow: 'auto',
                        }}
                      >
                        {gtLoading && (
                          <div style={{ padding: 8, fontSize: 12, color: 'var(--ink-3)' }}>
                            Searching…
                          </div>
                        )}
                        {!gtLoading && gtResults.length === 0 && (
                          <div style={{ padding: 8, fontSize: 12, color: 'var(--ink-3)' }}>
                            No matches.
                          </div>
                        )}
                        {gtResults.map((u) => {
                          const label = u.name ?? u.email ?? u.id
                          return (
                            <button
                              key={u.id}
                              type="button"
                              className="row"
                              style={{
                                background: 'transparent',
                                border: 0,
                                borderBottom: '1px solid var(--line)',
                                padding: '8px 10px',
                                cursor: 'pointer',
                                textAlign: 'left',
                                fontSize: 12,
                                gap: 6,
                              }}
                              onClick={() => {
                                setMyGtUserId(u.id)
                                setMyGtUserLabel(label)
                                setGtQuery('')
                                setGtResults([])
                              }}
                            >
                              <strong>{label}</strong>
                              {u.email && u.name && (
                                <span style={{ color: 'var(--ink-3)' }}>· {u.email}</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                  Once linked, Jobs Live + History show a "Mine" toggle that filters to your runs.
                </div>
              </div>
            </div>

            <div className="card card-pad col" style={{ gap: 14 }}>
              <div className="card-title">Auto-refresh</div>
              <div className="form-row">
                <label>Default interval</label>
                <select
                  className="input select"
                  value={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.value as AutoRefresh)}
                >
                  {AUTO_REFRESH_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                  Default auto-refresh interval for live feeds and service views. Can be overridden
                  per-view.
                </div>
              </div>
            </div>

            <PersonalTokensCard />

            <McpToolsCard />
          </div>

          <div className="col" style={{ gap: 16 }}>
            <div className="card card-pad col" style={{ gap: 10 }}>
              <div className="card-title">Current</div>
              <div className="health-row">
                <span className="health-label">Display name</span>
                <span className="health-val">
                  <strong>{user?.username || '—'}</strong>
                </span>
              </div>
              <div className="health-row">
                <span className="health-label">Workflow layout</span>
                <span className="health-val" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                  {workflowLayout}
                </span>
              </div>
              <div className="health-row">
                <span className="health-label">Auto-refresh</span>
                <span className="health-val mono" style={{ fontSize: 11 }}>
                  {AUTO_REFRESH_OPTIONS.find((r) => r.value === autoRefresh)?.label ?? autoRefresh}
                </span>
              </div>
              <div className="health-row">
                <span className="health-label">Role</span>
                <span className="health-val" style={{ fontSize: 12 }}>
                  {user?.isAdmin ? 'Admin' : 'Member'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
