import { fetchWithAuth } from '@/utils/auth'

export interface CalendarEvent {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  /** 0–23 */
  hour: number
  /** Total duration in hours (e.g. 48 = 2 days) */
  durationHours: number
  affectedServers: string[]
  discordReminder: boolean
  color: string
  createdAt: string
}

export type CalendarEventInput = Omit<CalendarEvent, 'id' | 'createdAt'>

export async function getEvents(): Promise<CalendarEvent[]> {
  const res = await fetchWithAuth('/api/events')
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`)
  return res.json() as Promise<CalendarEvent[]>
}

export async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const res = await fetchWithAuth('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? 'Failed to create event')
  }
  return res.json() as Promise<CalendarEvent>
}

export async function updateEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent> {
  const res = await fetchWithAuth(`/api/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? 'Failed to update event')
  }
  return res.json() as Promise<CalendarEvent>
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await fetchWithAuth(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new Error(err.error ?? 'Failed to delete event')
  }
}
