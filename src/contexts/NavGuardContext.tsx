import React, { createContext, useContext, useRef, useCallback } from 'react'

type NavGuardCheck = () => boolean

interface NavGuardContextValue {
  /** Register a guard function that returns true if navigation should be blocked */
  registerGuard: (check: NavGuardCheck) => void
  unregisterGuard: () => void
  /** Returns true if navigation is currently blocked */
  isBlocked: () => boolean
}

const NavGuardContext = createContext<NavGuardContextValue>({
  registerGuard: () => {},
  unregisterGuard: () => {},
  isBlocked: () => false,
})

export function NavGuardProvider({ children }: { children: React.ReactNode }) {
  const guardRef = useRef<NavGuardCheck | null>(null)

  const registerGuard = useCallback((check: NavGuardCheck) => {
    guardRef.current = check
  }, [])

  const unregisterGuard = useCallback(() => {
    guardRef.current = null
  }, [])

  const isBlocked = useCallback(() => {
    return guardRef.current ? guardRef.current() : false
  }, [])

  return (
    <NavGuardContext.Provider value={{ registerGuard, unregisterGuard, isBlocked }}>
      {children}
    </NavGuardContext.Provider>
  )
}

export function useNavGuard() {
  return useContext(NavGuardContext)
}
