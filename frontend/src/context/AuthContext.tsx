import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Session, User } from '../types'
import { loadSession, clearSession, updateStoredSession } from '../lib/storage'
import {
  type Capability,
  type Role,
  can as canFn,
  derivePrimaryRole,
} from '../lib/permissions'

type AuthContextValue = {
  session: Session | null
  user: User | null
  /** Effective role for the current user. Read straight from `user.role` if
   *  the backend stamped it; otherwise derived from `roles[]` for older
   *  sessions (handles the cross-release transition without forcing a
   *  re-login). `null` when no user is logged in. */
  role: Role | null
  /** Quick capability check — false when no user. Cheap; wraps `can()`. */
  can: (capability: Capability) => boolean
  login: (s: Session) => void
  logout: () => void
  setUser: (u: User) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)

  function login(s: Session) {
    setSession(s)
  }

  function logout() {
    clearSession()
    setSession(null)
  }

  function setUser(u: User) {
    setSession((prev) => {
      if (!prev) return prev
      const next = { ...prev, user: u }
      updateStoredSession(next)
      return next
    })
  }

  const user = session?.user ?? null
  // Prefer the backend-stamped `role`; fall back to deriving from `roles[]`
  // so a session created before the role field shipped keeps working.
  const role: Role | null = user
    ? (user.role ?? derivePrimaryRole(user.roles ?? (user.isAdmin ? ['admin'] : [])))
    : null
  const can = (cap: Capability) => canFn(role, cap)

  return (
    <AuthContext.Provider value={{ session, user, role, can, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
