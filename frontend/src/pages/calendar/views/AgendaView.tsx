import type { CalEvent, CalCategory } from '../calendarHelpers'
import { CAL_CATEGORIES, sameDay, parseDate } from '../calendarHelpers'

export function AgendaView({
  cursor,
  events,
  filterCats,
  search,
  today,
  onOpen,
}: {
  cursor: Date
  events: CalEvent[]
  filterCats: CalCategory[]
  search: string
  today: Date
  onOpen: (e: CalEvent) => void
}) {
  const m = cursor.getMonth(),
    y = cursor.getFullYear()
  const items = events
    .filter((e) => filterCats.includes(e.category))
    .filter(
      (e) =>
        !search ||
        `${e.title} ${e.owner ?? ''} ${e.location ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .filter((e) => {
      const d = parseDate(e.date)
      return d.getMonth() === m && d.getFullYear() === y
    })
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))

  const byDay = new Map<string, CalEvent[]>()
  for (const e of items) {
    const arr = byDay.get(e.date) ?? []
    arr.push(e)
    byDay.set(e.date, arr)
  }

  if (byDay.size === 0) {
    return (
      <div className="placeholder">
        <h3>No events</h3>
        <div>Try changing filters or jumping to a different month.</div>
      </div>
    )
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      {Array.from(byDay.entries()).map(([date, evs]) => {
        const d = parseDate(date)
        const isToday = sameDay(d, today)
        return (
          <div key={date} className="card">
            <div className="card-head" style={{ gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: isToday ? 'var(--accent)' : 'var(--surface-2)',
                  color: isToday ? 'white' : 'var(--ink)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--font-display)',
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: '.05em',
                    marginBottom: -2,
                  }}
                >
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{d.getDate()}</div>
              </div>
              <div className="card-title">
                {d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              <span className="spacer" />
              <span className="chip">{evs.length}</span>
            </div>
            <div className="col" style={{ padding: '0 var(--pad) var(--pad)' }}>
              {evs.map((e) => {
                const c = CAL_CATEGORIES[e.category].color
                return (
                  <button
                    key={e.id}
                    onClick={() => onOpen(e)}
                    className="row"
                    style={{
                      padding: '10px 8px',
                      border: 0,
                      background: 'transparent',
                      borderTop: '1px solid var(--line-2)',
                      textAlign: 'left',
                      cursor: 'default',
                      gap: 12,
                    }}
                  >
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: 'var(--ink-3)', width: 90, flexShrink: 0 }}
                    >
                      {e.start}–{e.end}
                    </span>
                    <span
                      style={{ width: 4, alignSelf: 'stretch', background: c, borderRadius: 2 }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{e.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {e.owner ?? '—'}
                        {e.location ? ` · ${e.location}` : ''}
                      </div>
                    </span>
                    <span
                      className="chip"
                      style={{
                        background: `color-mix(in oklab, ${c} 14%, transparent)`,
                        color: 'var(--ink-2)',
                        fontSize: 10,
                      }}
                    >
                      {CAL_CATEGORIES[e.category].label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
