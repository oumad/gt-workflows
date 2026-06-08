import type { Session } from '../types'

const KEY = 'cm-session'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(session: Session, remember: boolean): void {
  const target = remember ? localStorage : sessionStorage
  target.setItem(KEY, JSON.stringify(session))
}

/** Update the session in whichever store currently holds it. No-op when the
 *  session lives only in React state (e.g. just after a logout race). */
export function updateStoredSession(session: Session): void {
  try {
    if (localStorage.getItem(KEY) !== null) {
      localStorage.setItem(KEY, JSON.stringify(session))
    } else if (sessionStorage.getItem(KEY) !== null) {
      sessionStorage.setItem(KEY, JSON.stringify(session))
    }
  } catch {
    /* quota or privacy-mode write failure — non-critical */
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
  sessionStorage.removeItem(KEY)
}
