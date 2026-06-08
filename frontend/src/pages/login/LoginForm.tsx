import { type FormEvent, useState } from 'react'
import { User, Lock, Eye, EyeOff, ChevronRight } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ErrorAlert } from '../../components/ui/Alert'
import { api } from '../../lib/api'
import { saveSession } from '../../lib/storage'
import { useAuth } from '../../context/AuthContext'
import type { Session } from '../../types'

export function LoginForm() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const data = await api.post<Session>('/api/auth/login', {
        username: username.trim(),
        password,
      })
      saveSession(data, remember)
      login(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-card" onSubmit={handleSubmit} noValidate>
      <div className="login-head">
        <h1>Welcome back</h1>
        <div className="login-sub">Sign in to continue to GT Coffee Maker</div>
      </div>

      <label className="login-field">
        <span>Username</span>
        <div className="login-input-wrap">
          <span className="login-input-ico">
            <User size={14} />
          </span>
          <input
            className="input"
            type="text"
            autoFocus
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your.username"
          />
        </div>
      </label>

      <label className="login-field">
        <span>Password</span>
        <div className="login-input-wrap">
          <span className="login-input-ico">
            <Lock size={14} />
          </span>
          <input
            className="input"
            type={showPw ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <button
            type="button"
            className="login-input-eye"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>

      <label className="login-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Keep me signed in</span>
      </label>

      {error && <ErrorAlert>{error}</ErrorAlert>}

      <Button
        type="submit"
        variant="accent"
        disabled={busy}
        style={{ height: 40, fontSize: 14, justifyContent: 'center' }}
      >
        {busy ? (
          'Signing in…'
        ) : (
          <>
            <span>Sign in</span>
            <ChevronRight size={14} />
          </>
        )}
      </Button>
    </form>
  )
}
