import { useState, useEffect, FormEvent } from 'react'
import { setStoredAuth, clearStoredAuth, fetchWithAuth, getUnauthorizedFlag, clearUnauthorizedFlag } from '@/utils/auth'
import { useAuth } from '@/contexts/AuthContext'
import { AppLogo } from '@/components/ui/AppLogo'

interface LoginProps {
  onSuccess: () => void
}

export function Login({ onSuccess }: LoginProps) {
  const { setRole, setUsername: setAuthUsername } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unauthorizedMessage, setUnauthorizedMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (getUnauthorizedFlag()) {
      setUnauthorizedMessage('Your session has expired or you are not authorized. Please sign in again.')
      clearUnauthorizedFlag()
    }
  }, [])

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
      if (typeof data.username === 'string') setAuthUsername(data.username)
      setRole(data.role === 'admin' ? 'admin' : 'guest')
      try {
        sessionStorage.setItem('gt-workflows-first-login', '1')
      } catch {}
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      clearStoredAuth()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0f1419]">
      {/* Geometric Background Pattern */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Purple gradient background with subtle geometric pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1419] via-[#1a2332] to-[#0f1419]" />

        {/* Subtle geometric elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-900/10 rounded-full blur-3xl -mr-48 -mt-48" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-900/5 rounded-full blur-3xl -ml-48 -mb-48" />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'linear-gradient(0deg, #7a4db0 1px, transparent 1px), linear-gradient(90deg, #7a4db0 1px, transparent 1px)',
            backgroundSize: '50px 50px'
          }}
          aria-hidden="true"
        />
      </div>

      {/* Login Card Container */}
      <div className="relative z-10 w-full max-w-md px-4 sm:px-0">
        <div className="bg-[#1a2332] border border-[#354556] rounded-lg shadow-lg p-8 space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <AppLogo size={56} />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-[#e8ecf1]">GT Coffee Maker</h1>
              <p className="text-sm text-purple-400">GEAR Productions</p>
            </div>
            <p className="text-sm text-[#8b9aab]">Sign in to continue</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Unauthorized Message */}
            {unauthorizedMessage && (
              <div
                className="bg-orange-900/20 border border-orange-800/30 text-orange-300 text-sm rounded-md p-3"
                role="status"
              >
                {unauthorizedMessage}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div
                className="bg-red-900/20 border border-red-800/30 text-red-300 text-sm rounded-md p-3"
                role="alert"
              >
                {error}
              </div>
            )}

            {/* Username Field */}
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-medium text-[#e8ecf1]">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 bg-[#0f1419] border border-[#354556] rounded-md text-[#e8ecf1] placeholder-[#697784] focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Enter your username"
                required
                disabled={submitting}
                autoFocus
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-[#e8ecf1]">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-[#0f1419] border border-[#354556] rounded-md text-[#e8ecf1] placeholder-[#697784] focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="Enter your password"
                required
                disabled={submitting}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-purple-700 hover:bg-purple-750 text-white font-medium py-2 px-4 rounded-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed mt-6"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Footer */}
          <div className="text-center text-xs text-[#697784] pt-4 border-t border-[#354556]">
            <p>GT Coffee Maker v1.0.0</p>
          </div>
        </div>
      </div>
    </div>
  )
}
