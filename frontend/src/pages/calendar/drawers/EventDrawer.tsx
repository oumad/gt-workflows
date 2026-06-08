import { X, Calendar as CalIcon, User, Boxes, Tag, Activity } from 'lucide-react'
import { api } from '../../../lib/api'
import { useNotifications } from '../../../context/NotificationsContext'
import type { CalEvent } from '../calendarHelpers'
import { CAL_CATEGORIES, parseDate } from '../calendarHelpers'
import type { Page } from '../../../types'

type NavigateFn = (p: Page, path?: string) => void

/** Right-side slide-in drawer for viewing a calendar event. User-created
 *  events get a Delete button; WF/LoRA-derived events get an "Open run"
 *  shortcut that jumps to the Jobs page filtered by id. */
export function EventDrawer({
  event,
  onClose,
  onDeleted,
  navigate,
}: {
  event: CalEvent
  onClose: () => void
  onDeleted: () => void
  navigate?: NavigateFn
}) {
  const { notify } = useNotifications()
  const cat = CAL_CATEGORIES[event.category]
  const d = parseDate(event.date)
  const isUserEvent = event.source === 'user'

  const remove = async () => {
    if (!isUserEvent) return
    if (!window.confirm('Delete this event?')) return
    try {
      await api.del<void>(`/api/calendar/${event.id}`)
      notify({ variant: 'success', title: 'Event deleted', autoDismiss: 3000 })
      onDeleted()
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Delete failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,18,14,.35)',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ height: 6, background: cat.color }} />
        <div
          className="row"
          style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                color: 'var(--ink-3)',
              }}
            >
              {cat.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              {event.title}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="col" style={{ padding: 18, gap: 14, overflow: 'auto', flex: 1 }}>
          <DrawerRow icon={<CalIcon size={14} />} label="When">
            <div>
              {d.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {event.start} – {event.end}
            </div>
          </DrawerRow>
          {event.owner && (
            <DrawerRow icon={<User size={14} />} label="Owner">
              {event.owner}
            </DrawerRow>
          )}
          {(event.location || event.servers.length > 0) && (
            <DrawerRow icon={<Boxes size={14} />} label="Resource">
              <span className="mono">
                {event.servers.length > 0 ? event.servers.join(', ') : (event.location ?? '—')}
              </span>
            </DrawerRow>
          )}
          <DrawerRow icon={<Tag size={14} />} label="Category">
            <span
              className="chip"
              style={{ background: `color-mix(in oklab, ${cat.color} 14%, transparent)` }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: cat.color,
                  display: 'inline-block',
                  marginRight: 4,
                }}
              />
              {cat.label}
            </span>
          </DrawerRow>
          {event.notes && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>
                Notes
              </div>
              <div
                style={{
                  color: 'var(--ink-2)',
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {event.notes}
              </div>
            </div>
          )}
        </div>
        <div
          className="row"
          style={{
            marginTop: 'auto',
            padding: 18,
            borderTop: '1px solid var(--line)',
            gap: 8,
          }}
        >
          {(event.source === 'wf' || event.source === 'lora') && event.jobId && (
            <button
              className="btn btn-sm"
              onClick={() => {
                const q = encodeURIComponent(event.jobId ?? '')
                if (navigate) navigate('jobs', `/jobs?q=${q}`)
                else window.location.assign(`/jobs?q=${q}`)
              }}
            >
              <Activity size={14} /> Open run
            </button>
          )}
          <span className="spacer" />
          {isUserEvent && (
            <button className="btn btn-sm" onClick={remove} style={{ color: 'var(--bad)' }}>
              Delete
            </button>
          )}
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function DrawerRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: 'var(--surface-2)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ink-2)',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </div>
        <div style={{ marginTop: 2 }}>{children}</div>
      </div>
    </div>
  )
}
