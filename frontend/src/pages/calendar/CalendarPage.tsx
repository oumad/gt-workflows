import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, Search, Filter, Plus, Download } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { api } from '../../lib/api'
import { loadSession } from '../../lib/storage'
import {
  type CalEvent,
  type CalFeed,
  type CalCategory,
  CAL_CATEGORIES,
  ALL_CATEGORIES,
  fmtDate,
  addDays,
  startOfWeek,
  monthLabel,
} from './calendarHelpers'
import { MonthView } from './views/MonthView'
import { WeekView } from './views/WeekView'
import { DayView } from './views/DayView'
import { AgendaView } from './views/AgendaView'
import { EventDrawer } from './drawers/EventDrawer'
import { CreateEventDrawer } from './drawers/CreateEventDrawer'
import type { Page } from '../../types'

type View = 'month' | 'week' | 'day' | 'agenda'
type NavigateFn = (p: Page, path?: string) => void

export function CalendarPage({ navigate }: { navigate?: NavigateFn }) {
  const today = useMemo(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return t
  }, [])
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState<Date>(today)
  const [selected, setSelected] = useState<Date>(today)
  const [openEvent, setOpenEvent] = useState<CalEvent | null>(null)
  const [filterCats, setFilterCats] = useState<CalCategory[]>(ALL_CATEGORIES)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Window: ±45 days around the cursor — wide enough that switching views
  // inside the same month doesn't re-fetch.
  const window = useMemo(
    () => ({
      from: fmtDate(addDays(cursor, -45)),
      to: fmtDate(addDays(cursor, 45)),
    }),
    [cursor],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        from: window.from,
        to: window.to,
        categories: ALL_CATEGORIES.join(','),
      })
      const res = await api.get<CalFeed>(`/api/calendar?${params}`)
      setEvents(res.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendar')
    } finally {
      setLoading(false)
    }
  }, [window.from, window.to])
  useEffect(() => {
    load()
  }, [load])

  // Filtered + searched accessor shared by all views.
  const eventsFor = useCallback(
    (date: Date): CalEvent[] => {
      const key = fmtDate(date)
      const needle = search.trim().toLowerCase()
      return events
        .filter((e) => e.date === key)
        .filter((e) => filterCats.includes(e.category))
        .filter(
          (e) =>
            !needle ||
            `${e.title} ${e.owner ?? ''} ${e.location ?? ''}`.toLowerCase().includes(needle),
        )
        .sort((a, b) => a.start.localeCompare(b.start))
    },
    [events, filterCats, search],
  )

  /* Navigation */
  const gotoPrev = () => {
    if (view === 'month') setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
    else if (view === 'week') setCursor((c) => addDays(c, -7))
    else setCursor((c) => addDays(c, -1))
  }
  const gotoNext = () => {
    if (view === 'month') setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
    else if (view === 'week') setCursor((c) => addDays(c, 7))
    else setCursor((c) => addDays(c, 1))
  }
  const gotoToday = () => {
    setCursor(today)
    setSelected(today)
  }

  const headerLabel = (() => {
    if (view === 'month') return monthLabel(cursor)
    if (view === 'week') {
      const s = startOfWeek(cursor)
      const e = addDays(s, 6)
      return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    return cursor.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  })()

  const totalThisRange = useMemo(() => {
    const matches = (e: CalEvent) => {
      if (!filterCats.includes(e.category)) return false
      if (
        search &&
        !`${e.title} ${e.owner ?? ''} ${e.location ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        return false
      return true
    }
    if (view === 'month' || view === 'agenda') {
      const y = cursor.getFullYear(),
        m = cursor.getMonth()
      const prefix = `${y}-${String(m + 1).padStart(2, '0')}`
      return events.filter((e) => matches(e) && e.date.startsWith(prefix)).length
    }
    if (view === 'week') {
      const s = startOfWeek(cursor)
      return Array.from({ length: 7 }, (_, i) => eventsFor(addDays(s, i)).length).reduce(
        (a, b) => a + b,
        0,
      )
    }
    return eventsFor(cursor).length
  }, [view, cursor, events, filterCats, search, eventsFor])

  const exportIcs = () => {
    const session = loadSession()
    const params = new URLSearchParams({
      from: window.from,
      to: window.to,
      categories: filterCats.join(','),
    })
    // Direct download — auth required, so use fetch + blob.
    fetch(`/api/calendar/export.ics?${params}`, {
      headers: session ? { Authorization: `Bearer ${session.token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('Export failed'))))
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = Object.assign(document.createElement('a'), {
          href: url,
          download: 'calendar.ics',
        })
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      .catch(() => {})
  }

  return (
    <>
      <PageHead
        crumbs={['Brews', 'Calendar']}
        title="Calendar"
        sub={`${totalThisRange} events · ${headerLabel}`}
        actions={
          <>
            <button className="btn btn-sm" onClick={gotoToday}>
              Today
            </button>
            <button className="btn btn-sm" onClick={exportIcs}>
              <Download size={14} /> Export .ics
            </button>
            <button
              className="btn btn-sm"
              style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'white' }}
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={14} /> New event
            </button>
          </>
        }
      />
      <Tabs
        tabs={[
          { id: 'month', label: 'Month' },
          { id: 'week', label: 'Week' },
          { id: 'day', label: 'Day' },
          { id: 'agenda', label: 'Agenda' },
        ]}
        active={view}
        onChange={(v) => setView(v as View)}
      />
      <div className="body">
        <div className="row" style={{ marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-sm btn-icon" onClick={gotoPrev} title="Previous">
              <ChevronLeft size={14} />
            </button>
            <button className="btn btn-sm btn-icon" onClick={gotoNext} title="Next">
              <ChevronRight size={14} />
            </button>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              minWidth: 220,
            }}
          >
            {headerLabel}
          </div>
          <span className="spacer" />
          <div className="search">
            <span className="search-icon">
              <Search size={14} />
            </span>
            <input
              className="input"
              placeholder="Search events…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <CategoryFilter cats={filterCats} setCats={setFilterCats} />
        </div>

        {error && (
          <div className="card card-pad" style={{ color: 'var(--bad)', marginBottom: 14 }}>
            {error}
          </div>
        )}
        {loading && events.length === 0 ? (
          <div
            className="card card-pad"
            style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 32 }}
          >
            Loading…
          </div>
        ) : (
          <>
            {view === 'month' && (
              <MonthView
                cursor={cursor}
                eventsFor={eventsFor}
                selected={selected}
                onSelect={setSelected}
                onOpen={setOpenEvent}
                today={today}
              />
            )}
            {view === 'week' && (
              <WeekView cursor={cursor} eventsFor={eventsFor} today={today} onOpen={setOpenEvent} />
            )}
            {view === 'day' && (
              <DayView cursor={cursor} eventsFor={eventsFor} onOpen={setOpenEvent} />
            )}
            {view === 'agenda' && (
              <AgendaView
                cursor={cursor}
                events={events}
                filterCats={filterCats}
                search={search}
                today={today}
                onOpen={setOpenEvent}
              />
            )}
          </>
        )}
      </div>

      {openEvent && (
        <EventDrawer
          event={openEvent}
          onClose={() => setOpenEvent(null)}
          onDeleted={() => {
            setOpenEvent(null)
            load()
          }}
          navigate={navigate}
        />
      )}
      {createOpen && (
        <CreateEventDrawer
          defaultDate={selected}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
    </>
  )
}

/* ─── Category filter dropdown ──────────────────────────────────── */
function CategoryFilter({
  cats,
  setCats,
}: {
  cats: CalCategory[]
  setCats: (c: CalCategory[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const toggle = (k: CalCategory) =>
    setCats(cats.includes(k) ? cats.filter((x) => x !== k) : [...cats, k])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        <Filter size={14} /> Categories
        <span className="chip" style={{ marginLeft: 4 }}>
          {cats.length}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            zIndex: 30,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-lg)',
            padding: 8,
            minWidth: 220,
          }}
        >
          {ALL_CATEGORIES.map((k) => {
            const v = CAL_CATEGORIES[k]
            return (
              <label
                key={k}
                className="row"
                style={{ padding: '6px 8px', borderRadius: 6, gap: 8 }}
              >
                <input type="checkbox" checked={cats.includes(k)} onChange={() => toggle(k)} />
                <span style={{ width: 10, height: 10, borderRadius: 3, background: v.color }} />
                <span style={{ fontSize: 13 }}>{v.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
