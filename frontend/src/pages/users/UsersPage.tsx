import { useState, useEffect } from 'react'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { Kpi } from '../../components/ui/Kpi'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import type { User } from '../../types'
import { Search, X, Check, Shield, Plus, KeyRound, Trash2, AlertCircle } from 'lucide-react'
import { ROLES as ROLE_VALUES, ROLE_LABEL, ROLE_DESCRIPTION, type Role } from '../../lib/permissions'

/* ─── Shared password rule (mirrors api/src/routes/users.ts validators) ──
   Min 8 chars. Documented in the create/reset modals so admins know up front
   instead of finding out from a server error. */
const PASSWORD_MIN = 8

/* ─── Static reference data ─────────────────────────────────────
   These role definitions describe the intended permission model. The Admin
   toggle (PATCH /api/users/:id) is the only piece the backend persists today;
   the role cards and permission matrix are presented as read-only reference
   until a full RBAC backend exists. */
const ROLES = [
  {
    id: 'admin',
    label: 'Admin',
    color: 'var(--bad)',
    desc: 'Full access including user management and service config.',
    perms: { workflows: true, jobs: true, servers: true, users: true, training: true },
  },
  {
    id: 'operator',
    label: 'Operator',
    color: 'var(--pop-purple)',
    desc: 'Can run jobs and manage workflows. Cannot manage users.',
    perms: { workflows: true, jobs: true, servers: false, users: false, training: true },
  },
  {
    id: 'user',
    label: 'User',
    color: 'var(--accent)',
    desc: 'Can run workflows and view results.',
    perms: { workflows: true, jobs: false, servers: false, users: false, training: false },
  },
  {
    id: 'viewer',
    label: 'Viewer',
    color: 'var(--ink-3)',
    desc: 'Read-only access to workflows and job history.',
    perms: { workflows: false, jobs: false, servers: false, users: false, training: false },
  },
]

const PERM_KEYS: { id: string; label: string }[] = [
  { id: 'workflows', label: 'Workflows' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'servers', label: 'Services' },
  { id: 'training', label: 'Training' },
  { id: 'users', label: 'Users' },
]

function initials(name: string | null | undefined) {
  if (!name) return '?'
  // Take up to 2 first letters; works for "maya" → "MA" and "Maya Reyes" → "MR".
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

/* ─── User drawer ───────────────────── */
function UserDrawer({
  user,
  onClose,
  onSaved,
}: {
  user: User
  onClose: () => void
  onSaved: () => void
}) {
  const { user: me } = useAuth()
  const isSelf = me?.id === user.id
  const [role, setRole] = useState<Role>(user.role)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = role !== user.role
  // Inline password-reset state: the admin types a new password, hits save,
  // and we POST it. No "show password" toggle — we trust the admin's keyboard.
  const [pwOpen, setPwOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      // Send `role` (canonical) — the backend writes it to roles[] and
      // re-derives isAdmin. Old isAdmin field stays in the row for back-compat
      // with anything that still reads it directly.
      await api.patch(`/api/users/${user.id}`, { role })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (newPassword.length < PASSWORD_MIN) {
      setPwMsg(`Password must be at least ${PASSWORD_MIN} characters`)
      return
    }
    setPwBusy(true)
    setPwMsg(null)
    try {
      await api.post(`/api/users/${user.id}/password`, { newPassword })
      setPwMsg('Password updated — share it with the user securely')
      setNewPassword('')
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setPwBusy(false)
    }
  }

  async function deleteUser() {
    if (
      !window.confirm(
        `Delete user "${user.username}"? This removes the account and revokes every personal token they minted. This cannot be undone.`,
      )
    )
      return
    setBusy(true)
    setErr(null)
    try {
      await api.del(`/api/users/${user.id}`)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
      setBusy(false)
    }
  }

  return (
    <div className="drawer-stage" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">Edit user</div>
            <div className="drawer-sub">{user.username}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="drawer-body col" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'center', marginBottom: 8 }}>
            <div className="avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
              {initials(user.username)}
            </div>
          </div>

          <div className="form-row">
            <label>Username</label>
            <input className="input" value={user.username} readOnly style={{ opacity: 0.6 }} />
          </div>
          <div className="form-row">
            <label>Role</label>
            <select
              className="input select"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLE_VALUES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
              {ROLE_DESCRIPTION[role]}
            </div>
          </div>
          <div className="form-row">
            <label>Created</label>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', paddingTop: 4 }}>
              {new Date(user.createdAt).toLocaleString()}
            </div>
          </div>
          <div className="form-row">
            <label>Last seen</label>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', paddingTop: 4 }}>
              {user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : 'Never'}
            </div>
          </div>

          {/* Password reset — inline; collapses by default to avoid being the
              first thing an admin's eye lands on. Self-reset goes through
              Preferences (current-password check); this is admin-only force
              reset. */}
          <div className="form-row">
            <label>Password</label>
            {!pwOpen ? (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setPwOpen(true)
                  setPwMsg(null)
                }}
                style={{ alignSelf: 'flex-start' }}
              >
                <KeyRound size={12} /> Reset password
              </button>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={`At least ${PASSWORD_MIN} characters`}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={pwBusy}
                />
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={resetPassword}
                    disabled={pwBusy || newPassword.length < PASSWORD_MIN}
                  >
                    {pwBusy ? 'Updating…' : 'Update password'}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setPwOpen(false)
                      setNewPassword('')
                      setPwMsg(null)
                    }}
                    disabled={pwBusy}
                  >
                    Cancel
                  </button>
                </div>
                {pwMsg && (
                  <div
                    className="row"
                    style={{
                      gap: 6,
                      fontSize: 11.5,
                      color: pwMsg.startsWith('Password updated')
                        ? 'var(--good)'
                        : 'var(--bad)',
                    }}
                  >
                    {pwMsg.startsWith('Password updated') ? (
                      <Check size={12} />
                    ) : (
                      <AlertCircle size={12} />
                    )}
                    {pwMsg}
                  </div>
                )}
              </div>
            )}
          </div>

          {err && <div className="alert alert-error">{err}</div>}
        </div>
        <div className="drawer-foot">
          {/* Destructive action lives on the left so admins read past it before
              committing — Cancel + Save stay where the eye expects them. */}
          {!isSelf && (
            <button
              className="btn btn-sm"
              onClick={deleteUser}
              disabled={busy}
              style={{ color: 'var(--bad)', marginRight: 'auto' }}
              title="Delete user"
            >
              <Trash2 size={12} /> Delete user
            </button>
          )}
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={save}
            disabled={busy || !dirty}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Create user modal ───────────────────────────────────────── */
function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('designer')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const normalized = username.toLowerCase().trim()
  const usernameValid =
    normalized.length >= 2 && /^[a-z0-9._-]+$/.test(normalized) && normalized.length <= 64
  const passwordValid = password.length >= PASSWORD_MIN
  const canSubmit = usernameValid && passwordValid && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    try {
      await api.post('/api/users', { username: normalized, password, role })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
      setBusy(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card card-pad col"
        style={{ gap: 14, width: 420, maxWidth: '100%' }}
      >
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Plus size={18} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 15 }}>New user</strong>
          <span className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Cancel">
            <X size={14} />
          </button>
        </div>

        <div className="form-row">
          <label>Username</label>
          <input
            className="input"
            autoFocus
            placeholder="alice"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Lowercase letters, numbers, and <code>. _ -</code>. 2–64 chars.
          </div>
          {username && !usernameValid && (
            <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 4 }}>
              Username doesn't match the rules above.
            </div>
          )}
        </div>

        <div className="form-row">
          <label>Password</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Share it with the user securely — we don't email it.
          </div>
        </div>

        <div className="form-row">
          <label>Role</label>
          <select
            className="input select"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLE_VALUES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
            {ROLE_DESCRIPTION[role]}
          </div>
        </div>

        {err && (
          <div
            className="row"
            style={{
              gap: 6,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--bad-soft)',
              color: 'var(--bad)',
              fontSize: 12,
            }}
          >
            <AlertCircle size={13} /> {err}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── All users tab ─────────────────── */
function AllUsers() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setUsers(await api.get<User[]>('/api/users'))
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const filtered = users.filter(
    (u) =>
      !search ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.roles.some((r) => r.toLowerCase().includes(search.toLowerCase())),
  )

  // "Active in last 7 days" — derived from the lastSeenAt the API stamps on
  // each authenticated request. Users who never signed in have null and are
  // excluded.
  const sevenDaysAgo = Date.now() - 7 * 86_400_000
  const active7d = users.filter(
    (u) => u.lastSeenAt && new Date(u.lastSeenAt).getTime() >= sevenDaysAgo,
  ).length
  const adminCount = users.filter((u) => u.isAdmin).length
  const memberCount = users.filter((u) => !u.isAdmin).length

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Total users" value={users.length} />
        <Kpi label="Admins" value={adminCount} valueColor="var(--bad)" />
        <Kpi label="Members" value={memberCount} />
        <Kpi label="Active · 7d" value={active7d} valueColor="var(--good)" />
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <div className="search">
          <span className="search-icon">
            <Search size={14} />
          </span>
          <input
            className="input"
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
          <Plus size={13} /> New user
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Custom roles</th>
                <th>Created</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                        {initials(u.username)}
                      </div>
                      <span style={{ fontWeight: 500 }}>{u.username}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`chip ${u.isAdmin ? 'chip-bad' : ''}`}>
                      {u.isAdmin ? 'Admin' : 'Member'}
                    </span>
                  </td>
                  <td>
                    {u.roles.length === 0 ? (
                      <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>—</span>
                    ) : (
                      <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
                        {u.roles.map((r) => (
                          <span key={r} className="chip" style={{ fontSize: 10 }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {new Date(u.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {u.lastSeenAt
                      ? new Date(u.lastSeenAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Never'}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}
                  >
                    {search ? 'No users match your search.' : 'No users yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserDrawer
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
    </>
  )
}

/* ─── Roles tab ─────────────────────── */
function RolesTab() {
  return (
    <div className="grid-2">
      {ROLES.map((r) => (
        <div key={r.id} className="card card-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <span
              className="chip"
              style={{
                background: `color-mix(in oklab, ${r.color} 14%, transparent)`,
                color: r.color,
              }}
            >
              {r.label}
            </span>
            <Shield size={14} style={{ color: r.color, marginLeft: 'auto' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12, lineHeight: 1.4 }}>
            {r.desc}
          </div>
          <div className="col" style={{ gap: 6 }}>
            {PERM_KEYS.map((p) => (
              <div key={p.id} className="row" style={{ gap: 8 }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)' }}>{p.label}</span>
                {r.perms[p.id as keyof typeof r.perms] ? (
                  <span className="chip chip-good" style={{ padding: '1px 6px' }}>
                    <Check size={10} /> On
                  </span>
                ) : (
                  <span className="chip" style={{ padding: '1px 6px', color: 'var(--ink-3)' }}>
                    Off
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── Permissions tab ───────────────────────────────────────────
   Read-only matrix. Per-permission editing requires a backend that the
   current schema doesn't support — only the Admin boolean on users is
   persisted today. */
function PermissionsTab() {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Permission matrix</div>
        <span className="chip" style={{ fontSize: 11 }}>
          Reference · admin flag is the only persisted toggle
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th>Permission</th>
              {ROLES.map((r) => (
                <th key={r.id} style={{ textAlign: 'center', color: r.color }}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_KEYS.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.label}</td>
                {ROLES.map((r) => (
                  <td key={r.id} style={{ textAlign: 'center' }}>
                    <span
                      className="perm-cell"
                      data-on={r.perms[p.id as keyof typeof r.perms] ? '' : undefined}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {r.perms[p.id as keyof typeof r.perms] && <Check size={12} />}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── Page ──────────────────────────── */
export function UsersPage() {
  const [tab, setTab] = useState('users')

  return (
    <>
      <PageHead
        crumbs={['Admin', 'Users']}
        title="Users"
        sub="Manage team members, roles, and permissions"
      />
      <Tabs
        tabs={[
          { id: 'users', label: 'All users' },
          { id: 'roles', label: 'Roles' },
          { id: 'permissions', label: 'Permissions' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="body">
        {tab === 'users' && <AllUsers />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'permissions' && <PermissionsTab />}
      </div>
    </>
  )
}
