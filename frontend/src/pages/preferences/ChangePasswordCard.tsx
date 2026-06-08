import { useState } from 'react'
import { KeyRound, Check, AlertCircle } from 'lucide-react'
import { api } from '../../lib/api'

/** Mirrors api/src/routes/users.ts:passwordSchema. */
const PASSWORD_MIN = 8

/**
 * Inline self-service password change. Sits in Preferences so the user can
 * change their own password without bothering an admin. Backend
 * (POST /api/users/me/password) checks the current password before applying
 * the new one, so a hijacked session can't silently rotate the credential.
 */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const nextValid = next.length >= PASSWORD_MIN
  const matches = next === confirm
  const canSubmit = !busy && current.length > 0 && nextValid && matches && next !== current

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setMsg(null)
    try {
      await api.post('/api/users/me/password', { currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      setMsg({ kind: 'ok', text: 'Password updated.' })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <KeyRound size={14} style={{ color: 'var(--accent)' }} />
        <div className="card-title">Change password</div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
        Sign-in password for the browser session. Personal tokens for MCP / API are managed
        separately above.
      </div>

      <div className="form-row">
        <label>Current password</label>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="form-row">
        <label>New password</label>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${PASSWORD_MIN} characters`}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="form-row">
        <label>Confirm new password</label>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
        {confirm && !matches && (
          <div style={{ fontSize: 11, color: 'var(--bad)', marginTop: 4 }}>
            Confirmation doesn't match.
          </div>
        )}
        {next && next === current && (
          <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 4 }}>
            New password is the same as the current one.
          </div>
        )}
      </div>

      {msg && (
        <div
          className="row"
          style={{
            gap: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: msg.kind === 'ok' ? 'var(--good-soft)' : 'var(--bad-soft)',
            color: msg.kind === 'ok' ? 'var(--good)' : 'var(--bad)',
            fontSize: 12,
          }}
        >
          {msg.kind === 'ok' ? <Check size={13} /> : <AlertCircle size={13} />}
          {msg.text}
        </div>
      )}

      <button
        className="btn btn-sm btn-primary"
        onClick={submit}
        disabled={!canSubmit}
        style={{ alignSelf: 'flex-start' }}
      >
        {busy ? 'Updating…' : 'Change password'}
      </button>
    </div>
  )
}
