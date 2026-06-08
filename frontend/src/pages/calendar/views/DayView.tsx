import type { CalEvent } from '../calendarHelpers'
import { ALL_CATEGORIES, CAL_CATEGORIES, hourTo } from '../calendarHelpers'

export function DayView({
  cursor,
  eventsFor,
  onOpen,
}: {
  cursor: Date
  eventsFor: (d: Date) => CalEvent[]
  onOpen: (e: CalEvent) => void
}) {
  const evs = eventsFor(cursor)
  const hours = Array.from({ length: 14 }, (_, i) => i + 7) // 07:00 → 20:00

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 320px' }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head">
          <div className="card-title">
            {cursor.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </div>
          <span className="spacer" />
          <span className="chip">{evs.length} events</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', position: 'relative' }}>
          <div>
            {hours.map((h) => (
              <div
                key={h}
                className="mono"
                style={{
                  height: 56,
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
          <div style={{ borderLeft: '1px solid var(--line)', position: 'relative' }}>
            {hours.map((h) => (
              <div
                key={h}
                style={{
                  height: 56,
                  borderTop: h === hours[0] ? 0 : '1px dashed var(--line-2)',
                }}
              />
            ))}
            {evs.map((e) => {
              const top = (hourTo(e.start) - hours[0]) * 56
              const height = Math.max(28, (hourTo(e.end) - hourTo(e.start)) * 56 - 2)
              const c = CAL_CATEGORIES[e.category].color
              return (
                <button
                  key={e.id}
                  onClick={() => onOpen(e)}
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    top,
                    height,
                    background: `color-mix(in oklab, ${c} 14%, transparent)`,
                    borderLeft: `4px solid ${c}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    textAlign: 'left',
                    border: 0,
                    cursor: 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                    {e.start}–{e.end} · {CAL_CATEGORIES[e.category].label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</span>
                  {(e.owner || e.location) && (
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {e.owner ?? '—'}
                      {e.location ? ` · ${e.location}` : ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="card card-pad col" style={{ gap: 10 }}>
        <div className="card-title">Summary</div>
        {ALL_CATEGORIES.map((k) => {
          const n = evs.filter((e) => e.category === k).length
          if (!n) return null
          const v = CAL_CATEGORIES[k]
          return (
            <div className="row" key={k} style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: v.color }} />
                <span style={{ fontSize: 13 }}>{v.label}</span>
              </span>
              <strong className="mono">{n}</strong>
            </div>
          )
        })}
        {evs.length === 0 && (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No events scheduled.</div>
        )}
      </div>
    </div>
  )
}
