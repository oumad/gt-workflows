import { useState, useEffect, useRef } from 'react'
import { fetchWithAuth, onAuthRequired, isSessionExpired, clearStoredAuth, getStoredAuth, setStoredAuth } from '@/utils/auth'
import { Login } from './Login'

const SESSION_CHECK_INTERVAL_MS = 60_000 // 1 minute

interface AuthGuardProps {
  children: React.ReactNode
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [authStatus, setAuthStatus] = useState<'pending' | 'required' | 'ok'>('pending')
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
    if (authStatus !== 'ok') return
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
  }, [authStatus])

  if (authStatus === 'pending') {
    return (
      <div className="auth-guard-loading">
        <span className="auth-guard-spinner" />
        <span>Checking authentication…</span>
      </div>
    )
  }

  if (authStatus === 'required') {
    return <Login onSuccess={() => setAuthStatus('ok')} />
  }

  return <>{children}</>
}
