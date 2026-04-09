import { useState, useCallback, useEffect } from 'react'
import { getEvents } from '@/services/api/events'

export interface Annotation {
  id: string
  date: string // YYYY-MM-DD
  text: string
  color: string
  /** True for annotations derived from calendar events (read-only in annotation panel) */
  fromEvent?: boolean
}

const STORAGE_KEY = 'gt-analytics-annotations'

const ANNOTATION_COLORS = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
] as const

export { ANNOTATION_COLORS }

function loadAnnotations(): Annotation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveAnnotations(annotations: Annotation[]): void {
  // Only persist locally-created annotations (not event-derived ones)
  const local = annotations.filter((a) => !a.fromEvent)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
}

export function useAnnotations() {
  const [localAnnotations, setLocalAnnotations] = useState<Annotation[]>(loadAnnotations)
  const [eventAnnotations, setEventAnnotations] = useState<Annotation[]>([])

  // Fetch calendar events and convert to read-only annotations
  useEffect(() => {
    let cancelled = false
    getEvents()
      .then((events) => {
        if (cancelled) return
        const derived: Annotation[] = events.map((e) => ({
          id: `event-${e.id}`,
          date: e.date,
          text: e.title,
          color: e.color,
          fromEvent: true,
        }))
        setEventAnnotations(derived)
      })
      .catch(() => {
        // silently ignore — events are optional enrichment
      })
    return () => { cancelled = true }
  }, [])

  // Merged view: local first, then event-derived (deduped by id)
  const annotations: Annotation[] = [...localAnnotations, ...eventAnnotations]

  const addAnnotation = useCallback((date: string, text: string, color?: string) => {
    setLocalAnnotations((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date,
          text,
          color: color ?? ANNOTATION_COLORS[prev.length % ANNOTATION_COLORS.length],
        },
      ]
      saveAnnotations(next)
      return next
    })
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    // Event-derived annotations cannot be removed from here (manage via Events calendar)
    if (id.startsWith('event-')) return
    setLocalAnnotations((prev) => {
      const next = prev.filter((a) => a.id !== id)
      saveAnnotations(next)
      return next
    })
  }, [])

  const updateAnnotation = useCallback((id: string, text: string, color?: string) => {
    if (id.startsWith('event-')) return
    setLocalAnnotations((prev) => {
      const next = prev.map((a) =>
        a.id === id ? { ...a, text, ...(color ? { color } : {}) } : a
      )
      saveAnnotations(next)
      return next
    })
  }, [])

  return { annotations, addAnnotation, removeAnnotation, updateAnnotation }
}
