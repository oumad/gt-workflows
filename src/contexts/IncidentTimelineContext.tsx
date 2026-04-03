import { createContext, useContext, useState, useCallback } from 'react'

export interface TimelineEvent {
  id: string
  ts: number
  action: string
  detail?: string
}

interface IncidentTimelineContextValue {
  events: TimelineEvent[]
  addEvent: (action: string, detail?: string) => void
  clearEvents: () => void
}

const IncidentTimelineContext = createContext<IncidentTimelineContextValue | null>(null)

const STORAGE_KEY = 'gt-incident-timeline'
const MAX_EVENTS = 200

function loadEvents(): TimelineEvent[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TimelineEvent[]
  } catch { return [] }
}

export function IncidentTimelineProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<TimelineEvent[]>(loadEvents)

  const addEvent = useCallback((action: string, detail?: string) => {
    const event: TimelineEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ts: Date.now(),
      action,
      detail,
    }
    setEvents((prev) => {
      const next = [...prev, event].slice(-MAX_EVENTS)
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const clearEvents = useCallback(() => {
    setEvents([])
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  return (
    <IncidentTimelineContext.Provider value={{ events, addEvent, clearEvents }}>
      {children}
    </IncidentTimelineContext.Provider>
  )
}

export function useIncidentTimeline(): IncidentTimelineContextValue {
  const ctx = useContext(IncidentTimelineContext)
  if (!ctx) throw new Error('useIncidentTimeline must be used within IncidentTimelineProvider')
  return ctx
}
