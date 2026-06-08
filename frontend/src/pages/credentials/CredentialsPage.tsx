import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Eye, EyeOff, Server, Lock, Check } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { Modal } from '../../components/ui/Modal'
import { api } from '../../lib/api'
import { useServers } from '../../hooks/useServers'
import { useNotifications } from '../../context/NotificationsContext'
import type { Server as ServerType } from '../../types'

/* ────────────────────────────────────────────────────────────────────
 * Credentials — admin-only domain/user/password tuples that can be
 * attached to one or more servers (RDP / Ansible / SSH). The password
 * lives encrypted at rest on the backend (AES-256-GCM with a master
 * key) and is *never* returned to this UI; we only ever know whether
 * one is set via `hasPassword`. Writing a new password ships it over
 * to the API which re-encrypts and persists.
 * ──────────────────────────────────────────────────────────────────── */

type Credential = {
  id: string
  name: string
  domain: string
  username: string
  description: string | null
  hasPassword: boolean
  serverIds: string[]
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  items: Credential[]
  encryption: { available: boolean }
}

export function CredentialsPage() {
  const [creds, setCreds] = useState<Credential[]>([])
  const [encOk, setEncOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Credential | 'new' | null>(null)
  const { servers } = useServers()
  const { notify } = useNotifications()

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<ListResponse>('/api/credentials')
      setCreds(res.items)
      setEncOk(res.encryption.available)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load credentials')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleDelete(c: Credential) {
    if (!window.confirm(`Delete credential "${c.name}"? This cannot be undone.`)) return
    try {
      await api.del(`/api/credentials/${c.id}`)
      notify({ variant: 'success', title: 'Credential deleted', autoDismiss: 3000 })
      reload()
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Delete failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  const serverNameById = new Map(servers.map((s) => [s.id, s.name]))

  return (
    <>
      <PageHead
        crumbs={['Admin', 'Credentials']}
        title="Credentials"
        sub="Domain / username / password tuples, attachable to one or more servers"
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setEditing('new')}
            disabled={!encOk}
          >
            <Plus size={14} /> Add credential
          </button>
        }
      />
      <div className="body">
        {!encOk && (
          // Surfacing this up-front is critical: writing a credential without
          // a master key would silently fail at encrypt-time and leave the
          // user staring at a 500 with no idea what's missing.
          <div
            className="alert alert-error"
            style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}
          >
            <Lock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <strong>Encryption is not configured.</strong> Set the{' '}
              <code>CREDENTIALS_MASTER_KEY</code> env var on the API before saving credentials.
              Generate one with:{' '}
              <code>
                node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
              </code>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : creds.length === 0 ? (
          <div
            className="card card-pad"
            style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}
          >
            No credentials yet. Click <strong>Add credential</strong> to get started.
          </div>
        ) : (
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain · User</th>
                  <th>Password</th>
                  <th>Description</th>
                  <th>Servers</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {c.domain ? `${c.domain}\\${c.username}` : c.username}
                    </td>
                    <td>
                      {c.hasPassword ? (
                        <span className="chip chip-good" style={{ fontSize: 10 }}>
                          Set
                        </span>
                      ) : (
                        <span className="chip" style={{ fontSize: 10, color: 'var(--bad)' }}>
                          Unset
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        fontSize: 12,
                        color: 'var(--ink-3)',
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.description ?? '—'}
                    </td>
                    <td>
                      {c.serverIds.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>—</span>
                      ) : (
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {c.serverIds.slice(0, 3).map((sid) => (
                            <span key={sid} className="chip mono" style={{ fontSize: 10 }}>
                              {serverNameById.get(sid) ?? sid.slice(0, 8)}
                            </span>
                          ))}
                          {c.serverIds.length > 3 && (
                            <span className="chip" style={{ fontSize: 10 }}>
                              +{c.serverIds.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing(c)}
                          title="Edit"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDelete(c)}
                          title="Delete"
                          style={{ color: 'var(--bad)' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CredentialModal
          initial={editing === 'new' ? null : editing}
          servers={servers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────
 * Create / edit modal.
 * ──────────────────────────────────────────────────────────────────── */

function CredentialModal({
  initial,
  servers,
  onClose,
  onSaved,
}: {
  initial: Credential | null
  servers: ServerType[]
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useNotifications()
  const isNew = initial === null

  const [name, setName] = useState(initial?.name ?? '')
  const [domain, setDomain] = useState(initial?.domain ?? '')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [serverIds, setServerIds] = useState<string[]>(initial?.serverIds ?? [])
  const [busy, setBusy] = useState(false)

  // On create, password is required. On edit, an empty value means "leave the
  // existing password unchanged" — the backend simply skips re-encryption when
  // it doesn't see the field on the patch payload.
  const canSubmit =
    name.trim().length > 0 &&
    username.trim().length > 0 &&
    (isNew ? password.length > 0 : true) &&
    !busy

  async function submit() {
    setBusy(true)
    try {
      if (isNew) {
        await api.post('/api/credentials', {
          name: name.trim(),
          domain: domain.trim(),
          username: username.trim(),
          password,
          description: description.trim() || null,
          serverIds,
        })
        notify({ variant: 'success', title: 'Credential created', autoDismiss: 3000 })
      } else {
        const patch: Record<string, unknown> = {
          name: name.trim(),
          domain: domain.trim(),
          username: username.trim(),
          description: description.trim() || null,
          serverIds,
        }
        if (password.length > 0) patch.password = password
        await api.patch(`/api/credentials/${initial!.id}`, patch)
        notify({ variant: 'success', title: 'Credential updated', autoDismiss: 3000 })
      }
      onSaved()
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Save failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
      setBusy(false)
    }
  }

  const toggleServer = (sid: string) =>
    setServerIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]))

  return (
    <Modal title={isNew ? 'Add credential' : `Edit ${initial!.name}`} onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="form-row">
          <label>Name</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Prod RDP admin"
          />
        </div>

        <div className="grid-2" style={{ gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-row">
            <label>Domain</label>
            <input
              className="input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="optional · e.g. CORP"
            />
          </div>
          <div className="form-row">
            <label>Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="user"
            />
          </div>
        </div>

        <div className="form-row">
          <label>
            Password
            {!isNew && (
              <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 400, marginLeft: 6 }}>
                · leave empty to keep current
              </span>
            )}
          </label>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input mono"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isNew ? 'required' : initial!.hasPassword ? '••••••••' : 'not set'}
              autoComplete="new-password"
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              onClick={() => setShowPw((v) => !v)}
              title={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Description</label>
          <textarea
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what this credential is for"
            style={{
              minHeight: 60,
              fontFamily: 'inherit',
              fontSize: 13.5,
              lineHeight: 1.6,
              resize: 'vertical',
            }}
          />
        </div>

        <div className="form-row">
          <label>Assigned servers {serverIds.length > 0 && `(${serverIds.length})`}</label>
          {servers.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              No servers registered yet — add one in the Servers tool first.
            </span>
          ) : (
            <div
              className="row"
              style={{ flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}
            >
              {servers.map((s) => {
                const on = serverIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleServer(s.id)}
                    className="row"
                    style={{
                      gap: 4,
                      fontSize: 11,
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                      background: on
                        ? 'color-mix(in oklab, var(--accent) 14%, transparent)'
                        : 'var(--surface)',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {on && <Check size={10} />}
                    <Server size={10} style={{ color: 'var(--ink-3)' }} />
                    <span className="mono">{s.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
