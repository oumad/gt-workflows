import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { fetchWithAuth, onAuthRequired, isSessionExpired, clearStoredAuth, getStoredAuth, setStoredAuth } from '@/utils/auth'

const SESSION_CHECK_INTERVAL_MS = 60_000

export type AuthStatus = 'pending' | 'required' | 'ok'

interface AuthContextValue {
  authStatus: AuthStatus
  authEnabled: boolean
  setAuthStatus: (status: AuthStatus) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('pending')
  const [authEnabled, setAuthEnabled] = useState<boolean>(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async (retries = 0) => {
      try {
        const res = await fetchWithAuth('/api/ping')
        if (cancelled) return
        if (res.status === 401) {
          setAuthStatus('required')
          return
        }
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          const enabled = data.authEnabled === true
          setAuthEnabled(enabled)
          if (!enabled) {
            setAuthStatus('ok')
            return
          }
          if (data.sessionMaxTime != null) {
            const auth = getStoredAuth()
            if (auth) setStoredAuth(auth, data.sessionMaxTime)
          }
          setAuthStatus('ok')
          return
        }
        const maxRetries = 20
        const delay = 500 + Math.min(retries * 300, 2000)
        if (retries < maxRetries) {
          setTimeout(() => check(retries + 1), delay)
        } else {
          setAuthStatus('ok')
        }
      } catch {
        if (cancelled) return
        const maxRetries = 20
        const delay = 500 + Math.min(retries * 300, 2000)
        if (retries < maxRetries) {
          setTimeout(() => check(retries + 1), delay)
        } else {
          setAuthStatus('ok')
        }
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    return onAuthRequired(() => setAuthStatus('required'))
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok' || !authEnabled) return
    const tick = () => {
      if (isSessionExpired()) {
        clearStoredAuth()
        setAuthStatus('required')
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }
    intervalRef.current = setInterval(tick, SESSION_CHECK_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [authStatus, authEnabled])

  const value: AuthContextValue = { authStatus, authEnabled, setAuthStatus }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
