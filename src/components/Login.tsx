import { useState, FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { setStoredAuth, clearStoredAuth, fetchWithAuth } from '../utils/auth'
import './Login.css'

interface LoginProps {
  onSuccess: () => void
}

export default function Login({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const b64 = btoa(unescape(encodeURIComponent(`${username}:${password}`)))
      setStoredAuth(b64)
      const res = await fetchWithAuth('/api/ping')
      if (res.status === 401) {
        clearStoredAuth()
        setError('Invalid username or password')
        return
      }
      if (!res.ok) {
        setError('Something went wrong')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data.sessionMaxTime != null) setStoredAuth(b64, data.sessionMaxTime)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      clearStoredAuth()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <Lock size={32} />
          <h1>GT Workflows Manager</h1>
          <p className="login-subtitle">Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <label className="login-label">
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="login-input"
              required
              disabled={submitting}
              autoFocus
            />
          </label>
          <label className="login-label">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-input"
              required
              disabled={submitting}
            />
          </label>
          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
