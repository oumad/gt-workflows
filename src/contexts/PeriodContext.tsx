import { createContext, useContext, useState, useCallback } from 'react'

// Superset of all period types used across the app
export type GlobalPeriod = '1h' | '1d' | '1w' | '1m' | 'all'

interface PeriodContextValue {
  period: GlobalPeriod
  setPeriod: (p: GlobalPeriod) => void
}

const PeriodContext = createContext<PeriodContextValue | null>(null)

const STORAGE_KEY = 'gt-global-period'

function loadPeriod(): GlobalPeriod {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === '1h' || v === '1d' || v === '1w' || v === '1m' || v === 'all') return v
  } catch { /* ignore */ }
  return '1d'
}

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = useState<GlobalPeriod>(loadPeriod)

  const setPeriod = useCallback((p: GlobalPeriod) => {
    setPeriodState(p)
    try { localStorage.setItem(STORAGE_KEY, p) } catch { /* ignore */ }
  }, [])

  return (
    <PeriodContext.Provider value={{ period, setPeriod }}>
      {children}
    </PeriodContext.Provider>
  )
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext)
  if (!ctx) throw new Error('usePeriod must be used within PeriodProvider')
  return ctx
}
