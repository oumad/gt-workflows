import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Session, User } from '../types'
import { loadSession, clearSession, updateStoredSession } from '../lib/storage'
import {
  type Role,
  canSee as canSeeFn,
  canWrite as canWriteFn,
  derivePrimaryRole,
  isRole,
} from '../lib/permissions'
import type { Page } from '../types'

type AuthContextValue = {
  session: Session | null
  user: User | null
  /** Effective role for the current user. Read straight from `user.role` if
   *  the backend stamped it; otherwise derived from `roles[]` for older
   *  sessions (handles the cross-release transition without forcing a
   *  re-login). `null` when no user is logged in. */
  role: Role | null
  /** Brew visible at all (read or write)? False when no user. */
  canSee: (page: Page) => boolean
  /** Brew fully editable? Gates every edit affordance. False when no user. */
  canWrite: (page: Page) => boolean
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
  // Prefer the backend-stamped `role` (when it's a current role string);
  // otherwise derive from `roles[]` — this also normalises legacy roles
  // (ops/designer/viewer) from sessions created before the rename.
  const role: Role | null = user
    ? isRole(user.role)
      ? user.role
      : derivePrimaryRole(user.roles ?? (user.isAdmin ? ['admin'] : []))
    : null
  const canSee = (page: Page) => canSeeFn(role, page)
  const canWrite = (page: Page) => canWriteFn(role, page)

  return (
    <AuthContext.Provider value={{ session, user, role, canSee, canWrite, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
