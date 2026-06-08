import { useState, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import { api } from '../../../lib/api'
import { useNotifications } from '../../../context/NotificationsContext'
import { FormField } from '../../../components/ui/FormField'
import type { CalCategory } from '../calendarHelpers'
import { CAL_CATEGORIES, USER_CATEGORIES, fmtDate } from '../calendarHelpers'

/** Right-side drawer for creating a new calendar event (maintenance or
 *  workshop). Workflow runs and LoRA training events are derived from job
 *  tables and not creatable here. */
export function CreateEventDrawer({
  defaultDate,
  onClose,
  onCreated,
}: {
  defaultDate: Date
  onClose: () => void
  onCreated: () => void
}) {
  const { notify } = useNotifications()
  const [name, setName] = useState('')
  const [date, setDate] = useState(fmtDate(defaultDate))
  const [hour, setHour] = useState('10:00')
  const [duration, setDuration] = useState(60)
  const [cat, setCat] = useState<CalCategory>('maintenance')
  const [servers, setServers] = useState<string[]>([])
  const [owner, setOwner] = useState('')
  const [serversAvail, setServersAvail] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Pull server names so the chip picker shows real options.
    api
      .get<{ id: string; name: string }[]>('/api/servers')
      .then((rows) => setServersAvail(rows.map((r) => r.name)))
      .catch(() => setServersAvail([]))
  }, [])

  const endTime = (() => {
    const [h, m] = hour.split(':').map(Number)
    const total = (h ?? 0) * 60 + (m ?? 0) + duration
    const eh = Math.floor(total / 60) % 24
    const em = total % 60
    return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
  })()

  const toggleServer = (s: string) =>
    setServers((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await api.post('/api/calendar', {
        title: name.trim(),
        category: cat,
        date,
        start: hour,
        end: endTime,
        owner: owner.trim() || null,
        location: servers.length ? servers.join(', ') : null,
        servers,
      })
      notify({ variant: 'success', title: 'Event created', autoDismiss: 3000 })
      onCreated()
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Create failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
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
          width: 460,
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ height: 6, background: CAL_CATEGORIES[cat].color }} />
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
              New event
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              Schedule
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="col" style={{ padding: 18, gap: 16, overflow: 'auto', flex: 1 }}>
          <FormField label="Name">
            <input
              className="input"
              placeholder="e.g. Cache rebuild"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </FormField>

          <FormField label="Category">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {USER_CATEGORIES.map((k) => {
                const v = CAL_CATEGORIES[k]
                const on = cat === k
                return (
                  <button
                    key={k}
                    onClick={() => setCat(k)}
                    className="row"
                    style={{
                      gap: 6,
                      fontSize: 12,
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: '1px solid ' + (on ? v.color : 'var(--line)'),
                      background: on
                        ? `color-mix(in oklab, ${v.color} 14%, var(--surface))`
                        : 'var(--surface)',
                      color: 'var(--ink)',
                      cursor: 'default',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: v.color }} />
                    {v.label}
                  </button>
                )
              })}
            </div>
          </FormField>

          <div className="grid-2">
            <FormField label="Date">
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </FormField>
            <FormField label="Hour">
              <input
                className="input"
                type="time"
                value={hour}
                onChange={(e) => setHour(e.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Duration">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {[15, 30, 60, 90, 120, 240, 480].map((m) => (
                <button
                  key={m}
                  onClick={() => setDuration(m)}
                  style={{
                    fontSize: 12,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid ' + (duration === m ? 'var(--accent)' : 'var(--line)'),
                    background: duration === m ? 'var(--accent-soft)' : 'var(--surface)',
                    color: duration === m ? 'var(--accent-ink)' : 'var(--ink)',
                    cursor: 'default',
                  }}
                >
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
              <input
                className="input mono"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10) || 60)}
                style={{ width: 80, fontSize: 12, height: 28 }}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-3)', alignSelf: 'center' }}>
                min · ends {endTime}
              </span>
            </div>
          </FormField>

          <FormField label="Owner">
            <input
              className="input"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="optional"
            />
          </FormField>

          <FormField label={`Affected services${servers.length ? ` (${servers.length})` : ''}`}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {serversAvail.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>No services registered.</span>
              ) : (
                serversAvail.map((s) => {
                  const on = servers.includes(s)
                  return (
                    <button
                      key={s}
                      onClick={() => toggleServer(s)}
                      className="row"
                      style={{
                        gap: 4,
                        fontSize: 11,
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                        background: on ? 'var(--accent-soft)' : 'var(--surface)',
                        color: on ? 'var(--accent-ink)' : 'var(--ink-2)',
                        cursor: 'default',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {on && <Check size={10} />}
                      {s}
                    </button>
                  )
                })
              )}
            </div>
          </FormField>
        </div>

        <div className="row" style={{ padding: 18, borderTop: '1px solid var(--line)', gap: 8 }}>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-sm"
            style={{
              background: 'var(--accent)',
              borderColor: 'var(--accent)',
              color: 'white',
              opacity: name.trim() && !saving ? 1 : 0.5,
            }}
            onClick={submit}
            disabled={!name.trim() || saving}
          >
            {saving ? 'Creating…' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  )
}
