import type { CalEvent } from '../calendarHelpers'
import {
  CAL_CATEGORIES,
  DAY_LABELS_SHORT,
  sameDay,
  addDays,
  startOfWeek,
  hourTo,
} from '../calendarHelpers'

export function WeekView({
  cursor,
  eventsFor,
  today,
  onOpen,
}: {
  cursor: Date
  eventsFor: (d: Date) => CalEvent[]
  today: Date
  onOpen: (e: CalEvent) => void
}) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const hours = Array.from({ length: 12 }, (_, i) => i + 8) // 08:00 → 19:00

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px repeat(7, 1fr)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div />
        {days.map((d, i) => {
          const isToday = sameDay(d, today)
          return (
            <div
              key={i}
              style={{
                padding: '10px 12px',
                borderLeft: '1px solid var(--line)',
                fontSize: 11,
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                fontWeight: 600,
              }}
            >
              <div>{DAY_LABELS_SHORT[i]}</div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 18,
                  color: isToday ? 'var(--accent)' : 'var(--ink)',
                  marginTop: 2,
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                {d.getDate()}
              </div>
            </div>
          )
        })}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px repeat(7, 1fr)',
          position: 'relative',
        }}
      >
        <div>
          {hours.map((h) => (
            <div
              key={h}
              className="mono"
              style={{
                height: 50,
                fontSize: 10,
                color: 'var(--ink-3)',
                padding: '2px 8px',
                textAlign: 'right',
              }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((d, di) => {
          const evs = eventsFor(d)
          return (
            <div key={di} style={{ borderLeft: '1px solid var(--line)', position: 'relative' }}>
              {hours.map((h) => (
                <div
                  key={h}
                  style={{
                    height: 50,
                    borderTop: h === hours[0] ? 0 : '1px dashed var(--line-2)',
                  }}
                />
              ))}
              {evs.map((e) => {
                const top = (hourTo(e.start) - hours[0]) * 50
                const height = Math.max(22, (hourTo(e.end) - hourTo(e.start)) * 50 - 2)
                const c = CAL_CATEGORIES[e.category].color
                return (
                  <button
                    key={e.id}
                    onClick={() => onOpen(e)}
                    style={{
                      position: 'absolute',
                      left: 4,
                      right: 4,
                      top,
                      height,
                      background: `color-mix(in oklab, ${c} 14%, transparent)`,
                      borderLeft: `3px solid ${c}`,
                      borderRadius: 6,
                      padding: '4px 6px',
                      textAlign: 'left',
                      border: 0,
                      cursor: 'default',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                      {e.start}–{e.end}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {e.title}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
