import type { CalEvent } from '../calendarHelpers'
import {
  CAL_CATEGORIES,
  DAY_LABELS_SHORT,
  sameDay,
  addDays,
  startOfWeek,
  startOfMonth,
} from '../calendarHelpers'

export function MonthView({
  cursor,
  eventsFor,
  selected,
  onSelect,
  onOpen,
  today,
}: {
  cursor: Date
  eventsFor: (d: Date) => CalEvent[]
  selected: Date
  onSelect: (d: Date) => void
  onOpen: (e: CalEvent) => void
  today: Date
}) {
  const first = startOfMonth(cursor)
  const start = startOfWeek(first)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {DAY_LABELS_SHORT.map((d) => (
          <div
            key={d}
            style={{
              padding: '10px 12px',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              color: 'var(--ink-3)',
              borderRight: '1px solid var(--line)',
            }}
          >
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const isToday = sameDay(d, today)
          const isSel = sameDay(d, selected)
          const evs = eventsFor(d)
          const show = Math.min(evs.length, 3)
          const more = evs.length - show
          return (
            <div
              key={i}
              onClick={() => onSelect(d)}
              style={{
                minHeight: 110,
                padding: 6,
                borderRight: (i + 1) % 7 ? '1px solid var(--line)' : 0,
                borderTop: i >= 7 ? '1px solid var(--line)' : 0,
                background: isSel
                  ? 'var(--accent-soft)'
                  : inMonth
                    ? 'var(--surface)'
                    : 'var(--surface-2)',
                opacity: inMonth ? 1 : 0.55,
                cursor: 'default',
                position: 'relative',
              }}
            >
              <div className="row" style={{ marginBottom: 4 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    fontWeight: 600,
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    display: 'grid',
                    placeItems: 'center',
                    background: isToday ? 'var(--accent)' : 'transparent',
                    color: isToday ? 'white' : 'var(--ink)',
                  }}
                >
                  {d.getDate()}
                </span>
                <span className="spacer" />
                {evs.length > 0 && (
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {evs.length}
                  </span>
                )}
              </div>
              <div className="col" style={{ gap: 2 }}>
                {evs.slice(0, show).map((e) => {
                  const c = CAL_CATEGORIES[e.category].color
                  return (
                    <button
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onOpen(e)
                      }}
                      className="row"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '2px 5px',
                        borderRadius: 4,
                        gap: 4,
                        fontSize: 11,
                        lineHeight: 1.25,
                        background: `color-mix(in oklab, ${c} 14%, transparent)`,
                        color: 'var(--ink)',
                        border: 0,
                        cursor: 'default',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 999,
                          background: c,
                          flexShrink: 0,
                        }}
                      />
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
                        {e.start}
                      </span>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {e.title}
                      </span>
                    </button>
                  )
                })}
                {more > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--ink-3)', paddingLeft: 5 }}>
                    +{more} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
