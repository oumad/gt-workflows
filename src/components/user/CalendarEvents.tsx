import React, { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X, Bell, BellOff, Server, Calendar, Check,
} from 'lucide-react'
import {
  getEvents, createEvent, updateEvent, deleteEvent,
  type CalendarEvent, type CalendarEventInput,
} from '@/services/api/events'
import { ANNOTATION_COLORS } from '@/features/dashboard/useAnnotations'
import type { AppPreferences } from '@/services/api/preferences'

// ─── helpers ────────────────────────────────────────────────────────────────

const QUERY_KEY = ['calendar-events'] as const

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

function formatDuration(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const d = hours / 24
    return d === 1 ? '1 day' : `${d} days`
  }
  return hours === 1 ? '1 hour' : `${hours} hours`
}

function buildMonthGrid(year: number, month: number): (number | null)[][] {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = (firstDay + 6) % 7
  const cells: (number | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

function serverLabel(url: string, aliases: Record<string, string>): string {
  return aliases[url] ?? url
}

// ─── Shared style constants ──────────────────────────────────────────────────

const CLS_INPUT = 'w-full bg-primary border border-default rounded-md px-[0.7rem] py-2 text-sm text-primary font-[inherit] outline-none transition-[border-color] duration-150 box-border focus:border-accent/60'
const CLS_ICON_BTN = 'flex items-center justify-center w-[22px] h-[22px] bg-transparent border-none rounded text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-[#b8c5d0]'

// ─── Form state ──────────────────────────────────────────────────────────────

interface FormState {
  title: string
  date: string
  hour: number
  durationValue: number
  durationUnit: 'hours' | 'days'
  affectedServers: string[]
  discordReminder: boolean
  color: string
}

const EMPTY_FORM: FormState = {
  title: '',
  date: toYMD(new Date()),
  hour: 9,
  durationValue: 1,
  durationUnit: 'hours',
  affectedServers: [],
  discordReminder: false,
  color: ANNOTATION_COLORS[0],
}

function eventToForm(e: CalendarEvent): FormState {
  const isWholeDays = e.durationHours >= 24 && e.durationHours % 24 === 0
  return {
    title: e.title,
    date: e.date,
    hour: e.hour,
    durationValue: isWholeDays ? e.durationHours / 24 : e.durationHours,
    durationUnit: isWholeDays ? 'days' : 'hours',
    affectedServers: [...e.affectedServers],
    discordReminder: e.discordReminder,
    color: e.color,
  }
}

function formToInput(f: FormState): CalendarEventInput {
  return {
    title: f.title.trim(),
    date: f.date,
    hour: f.hour,
    durationHours: f.durationUnit === 'days' ? f.durationValue * 24 : f.durationValue,
    affectedServers: f.affectedServers,
    discordReminder: f.discordReminder,
    color: f.color,
  }
}

// ─── Event form modal ────────────────────────────────────────────────────────

interface EventFormModalProps {
  initial: FormState
  editing: boolean
  servers: string[]
  serverAliases: Record<string, string>
  discordEnabled: boolean
  onSave: (f: FormState) => Promise<void>
  onClose: () => void
}

const CLS_LABEL = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted'
const CLS_SELECT = 'bg-primary border border-default rounded-md px-[0.6rem] py-[0.35rem] text-sm text-primary font-[inherit] outline-none transition-[border-color] duration-150 cursor-pointer focus:border-accent/60 w-full'

function EventFormModal({
  initial, editing, servers, serverAliases, discordEnabled, onSave, onClose,
}: EventFormModalProps): React.ReactElement {
  const [form, setForm] = useState<FormState>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }))

  const toggleServer = (url: string) =>
    set('affectedServers', form.affectedServers.includes(url)
      ? form.affectedServers.filter((u) => u !== url)
      : [...form.affectedServers, url])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Title is required'); return }
    if (form.durationValue <= 0) { setError('Duration must be greater than 0'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-default rounded-xl w-full flex flex-col overflow-hidden shadow-2xl"
        style={{ maxWidth: 680, maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-default shrink-0">
          <h2 className="text-base font-semibold text-primary m-0">{editing ? 'Edit Event' : 'New Event'}</h2>
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-none text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="flex flex-col gap-5 px-5 py-5 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">

            {/* Title */}
            <div className="flex flex-col gap-[0.35rem]">
              <label className={CLS_LABEL}>Title</label>
              <input
                className={CLS_INPUT}
                type="text"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Workshop session"
                maxLength={200}
                autoFocus
              />
            </div>

            {/* Date · Hour · Duration — single row */}
            <div className="grid grid-cols-[1fr_120px_1fr] gap-3 items-end">
              <div className="flex flex-col gap-[0.35rem]">
                <label className={CLS_LABEL}>Date</label>
                <input
                  className={`${CLS_INPUT} [&::-webkit-calendar-picker-indicator]:[filter:invert(0.55)] [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-[0.35rem]">
                <label className={CLS_LABEL}>Hour</label>
                <select
                  className={CLS_SELECT}
                  value={form.hour}
                  onChange={(e) => set('hour', Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatHour(i)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-[0.35rem]">
                <label className={CLS_LABEL}>Duration</label>
                <div className="flex gap-2 items-stretch">
                  <input
                    className={`${CLS_INPUT} w-16 shrink-0 text-center`}
                    type="number"
                    min={0.5}
                    step={form.durationUnit === 'days' ? 1 : 0.5}
                    value={form.durationValue}
                    onChange={(e) => set('durationValue', parseFloat(e.target.value) || 1)}
                  />
                  <div className="flex bg-primary border border-default rounded-md overflow-hidden flex-1">
                    {(['hours', 'days'] as const).map((unit, i) => (
                      <button
                        key={unit}
                        type="button"
                        className={`flex-1 py-[0.4rem] text-sm font-[inherit] bg-transparent border-none cursor-pointer transition-all duration-150${i > 0 ? ' border-l border-default' : ''} ${form.durationUnit === unit ? 'bg-tertiary text-primary font-medium' : 'text-muted hover:bg-tertiary/50 hover:text-secondary'}`}
                        onClick={() => set('durationUnit', unit)}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Color */}
            <div className="flex flex-col gap-[0.35rem]">
              <label className={CLS_LABEL}>Color</label>
              <div className="flex gap-[0.55rem] flex-wrap">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`w-6 h-6 rounded-full border-2 cursor-pointer shrink-0 p-0 transition-all duration-100 hover:scale-[1.15] ${form.color === c ? 'border-primary shadow-[0_0_0_2px_rgba(232,236,241,0.2)]' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => set('color', c)}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>

            {/* Affected servers — 2-column grid */}
            {servers.length > 0 && (
              <div className="flex flex-col gap-[0.35rem]">
                <label className={`${CLS_LABEL} flex items-center gap-[0.3rem]`}>
                  <Server size={11} />
                  Affected Servers
                </label>
                <div className={`grid gap-1.5 max-h-[200px] overflow-y-auto pr-[2px] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm ${servers.length > 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {servers.map((url) => {
                    const name = serverAliases[url]
                    const selected = form.affectedServers.includes(url)
                    return (
                      <div
                        key={url}
                        role="checkbox"
                        aria-checked={selected}
                        tabIndex={0}
                        className={`flex items-center gap-[0.55rem] px-[0.6rem] py-[0.4rem] bg-primary border rounded-md cursor-pointer transition-all duration-120 select-none min-w-0 ${selected ? 'bg-accent/[0.08] border-accent/35 hover:bg-accent/[0.14]' : 'border-default hover:bg-tertiary hover:border-[#354556]'}`}
                        onClick={() => toggleServer(url)}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleServer(url) } }}
                      >
                        <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-all duration-120 ${selected ? 'bg-accent border-accent text-white' : 'border-[#354556] bg-transparent text-transparent'}`}>
                          {selected && <Check size={10} strokeWidth={3} />}
                        </span>
                        <div className="flex flex-col min-w-0 gap-[0.05rem]">
                          <span className="text-sm text-primary font-medium overflow-hidden text-ellipsis whitespace-nowrap leading-[1.25]">{name ?? url}</span>
                          {name && <span className="text-[0.75rem] text-muted font-mono overflow-hidden text-ellipsis whitespace-nowrap leading-[1.2]">{url}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Discord reminder */}
            <div
              role="switch"
              aria-checked={form.discordReminder}
              tabIndex={discordEnabled ? 0 : -1}
              className={`flex items-center justify-between gap-4 px-4 py-3 bg-primary border border-default rounded-lg transition-[border-color] duration-150 ${discordEnabled ? 'cursor-pointer hover:border-[#354556]' : 'opacity-45 cursor-not-allowed'}`}
              onClick={() => { if (discordEnabled) set('discordReminder', !form.discordReminder) }}
              onKeyDown={(e) => { if (discordEnabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); set('discordReminder', !form.discordReminder) } }}
            >
              <div className="flex flex-col gap-[0.15rem] min-w-0">
                <span className="flex items-center gap-[0.35rem] text-sm font-medium text-primary">
                  {discordEnabled ? <Bell size={14} /> : <BellOff size={14} />}
                  Discord reminders
                </span>
                <span className="text-sm text-muted leading-[1.35]">
                  {discordEnabled
                    ? 'Sends a reminder 1 day before and 30 min before the event'
                    : 'No Discord webhook configured — reminders will not be sent'}
                </span>
              </div>
              <div
                className={`relative w-9 h-5 rounded-[10px] shrink-0 transition-colors duration-200 pointer-events-none border-none ${form.discordReminder ? 'bg-accent' : 'bg-[#4a5d73]'}`}
              >
                <span className={`absolute top-[3px] left-[3px] w-[14px] h-[14px] rounded-full transition-all duration-200 ${form.discordReminder ? 'translate-x-4 bg-white' : 'translate-x-0 bg-white/70'}`} />
              </div>
            </div>

            {error && (
              <p className="text-sm text-semantic-error bg-semantic-error/[0.07] border border-semantic-error/20 rounded-md px-[0.65rem] py-[0.4rem] m-0">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-default shrink-0">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-[0.45rem] bg-tertiary border border-default rounded-lg text-secondary text-sm font-medium cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-[0.45rem] bg-accent border border-transparent rounded-lg text-white text-sm font-medium cursor-pointer transition-all duration-150 hover:bg-accent/85 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={saving}
            >
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ─── Event card ───────────────────────────────────────────────────────────────

interface EventCardProps {
  event: CalendarEvent
  serverAliases: Record<string, string>
  onEdit: (e: CalendarEvent) => void
  onDelete: (id: string) => void
}

function EventCard({ event, serverAliases, onEdit, onDelete }: EventCardProps): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="flex items-start gap-[0.6rem] px-3 py-[0.6rem] bg-primary border border-default rounded-[7px] transition-colors duration-150 hover:border-[#354556] group">
      <span className="w-[3px] rounded-sm self-stretch shrink-0 min-h-[32px]" style={{ background: event.color }} />
      <div className="flex-1 min-w-0 flex flex-col gap-[0.2rem]">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-primary leading-[1.3] overflow-hidden text-ellipsis whitespace-nowrap">{event.title}</span>
          <div className="flex items-center gap-[0.1rem] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <button type="button" className={CLS_ICON_BTN} onClick={() => onEdit(event)} title="Edit">
              <Pencil size={13} />
            </button>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className="flex items-center justify-center w-[22px] h-[22px] bg-transparent border-none rounded text-semantic-error cursor-pointer transition-all duration-150 hover:bg-semantic-error/[0.12] hover:text-[#e88080]"
                  onClick={() => onDelete(event.id)}
                  title="Confirm delete"
                >
                  <Trash2 size={13} />
                </button>
                <button type="button" className={CLS_ICON_BTN} onClick={() => setConfirmDelete(false)} title="Cancel">
                  <X size={13} />
                </button>
              </>
            ) : (
              <button type="button" className={CLS_ICON_BTN} onClick={() => setConfirmDelete(true)} title="Delete">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-1 text-sm text-muted">
          <span>{event.date} · {formatHour(event.hour)}</span>
          <span className="text-[#354556]">·</span>
          <span>{formatDuration(event.durationHours)}</span>
          {event.discordReminder && (
            <>
              <span className="text-[#354556]">·</span>
              <span className="flex items-center text-[#9366cc]" title="Discord reminders on"><Bell size={11} /></span>
            </>
          )}
        </div>

        {event.affectedServers.length > 0 && (
          <div className="flex items-center flex-wrap gap-[0.3rem] mt-[0.15rem] text-sm text-muted">
            <Server size={11} />
            {event.affectedServers.map((url) => (
              <span key={url} className="px-[0.4rem] py-[0.1rem] bg-secondary border border-default rounded text-sm text-muted max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">
                {serverLabel(url, serverAliases)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Mini calendar ────────────────────────────────────────────────────────────

interface MiniCalendarProps {
  year: number
  month: number
  today: string
  selectedDate: string | null
  eventDates: Set<string>
  onSelectDate: (ymd: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}

function MiniCalendar({
  year, month, today, selectedDate, eventDates, onSelectDate, onPrevMonth, onNextMonth,
}: MiniCalendarProps): React.ReactElement {
  const rows = buildMonthGrid(year, month)

  return (
    <div className="bg-primary border border-default rounded-lg p-3 w-[268px] shrink-0 select-none">
      <div className="flex items-center justify-between mb-[0.65rem]">
        <button type="button" className="flex items-center justify-center w-6 h-6 bg-transparent border-none rounded-[5px] text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary" onClick={onPrevMonth} aria-label="Previous month">
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-primary">{MONTH_NAMES[month]} {year}</span>
        <button type="button" className="flex items-center justify-center w-6 h-6 bg-transparent border-none rounded-[5px] text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary" onClick={onNextMonth} aria-label="Next month">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid [grid-template-columns:repeat(7,1fr)] gap-px">
        {DAY_NAMES.map((d) => (
          <span key={d} className="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-muted text-center pt-[0.1rem] pb-[0.4rem]">{d}</span>
        ))}
        {rows.map((row, ri) =>
          row.map((day, ci) => {
            if (!day) return <span key={`e-${ri}-${ci}`} className="w-8 h-8 cursor-default pointer-events-none" />
            const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isToday = ymd === today
            const isSelected = ymd === selectedDate
            return (
              <button
                key={ymd}
                type="button"
                onClick={() => onSelectDate(ymd)}
                className={[
                  'relative flex flex-col items-center justify-center w-8 h-8 text-[0.8125rem] bg-transparent border border-transparent rounded-md cursor-pointer transition-all duration-100 gap-px p-0 font-[inherit] leading-none',
                  isSelected
                    ? 'bg-accent/20 border-accent/45 text-[#c9a6f0] hover:bg-accent/30'
                    : 'text-[#b8c5d0] hover:bg-tertiary hover:text-primary',
                  isToday && !isSelected ? 'text-[#9366cc] font-bold' : '',
                ].filter(Boolean).join(' ')}
                aria-pressed={isSelected}
              >
                {day}
                {eventDates.has(ymd) && <span className="w-1 h-1 rounded-full bg-[#9366cc] shrink-0" />}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface CalendarEventsProps {
  preferences: AppPreferences | undefined
  discordEnabled?: boolean
}

export function CalendarEvents({ preferences, discordEnabled = false }: CalendarEventsProps): React.ReactElement {
  const qc = useQueryClient()
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getEvents,
    staleTime: 30_000,
  })

  const today = toYMD(new Date())
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)

  const serverAliases: Record<string, string> = preferences?.serverAliases ?? {}
  const servers: string[] = preferences?.monitoredServers ?? []
  const eventDates = new Set(events.map((e) => e.date))

  const displayedEvents = selectedDate
    ? events.filter((e) => e.date === selectedDate)
    : events.filter((e) => e.date >= today).slice(0, 8)

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11) }
    else setViewMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0) }
    else setViewMonth((m) => m + 1)
  }

  const handleSelectDate = (ymd: string) =>
    setSelectedDate((prev) => prev === ymd ? null : ymd)

  const openEdit = useCallback((e: CalendarEvent) => {
    setEditingEvent(e)
    setFormOpen(true)
  }, [])

  const closeForm = () => { setFormOpen(false); setEditingEvent(null) }

  const handleSave = async (form: FormState) => {
    const input = formToInput(form)
    if (editingEvent) await updateEvent(editingEvent.id, input)
    else await createEvent(input)
    await qc.invalidateQueries({ queryKey: QUERY_KEY })
    closeForm()
  }

  const handleDelete = useCallback(async (id: string) => {
    await deleteEvent(id)
    await qc.invalidateQueries({ queryKey: QUERY_KEY })
  }, [qc])

  return (
    <section className="bg-secondary border border-default rounded-[10px] p-[1.1rem_1.25rem] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-[0.4rem] text-muted">
        <Calendar size={15} />
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted m-0 flex-1">Events &amp; Reminders</h2>
        <span className="text-sm font-semibold text-muted bg-tertiary px-[0.45rem] py-[0.1rem] rounded-[10px]">{events.length}</span>
        <button
          type="button"
          className="inline-flex items-center gap-[0.3rem] px-[0.7rem] py-[0.3rem] bg-transparent border border-default rounded-md text-[#b8c5d0] text-sm font-medium cursor-pointer font-[inherit] transition-all duration-150 hover:bg-tertiary hover:border-accent hover:text-primary"
          onClick={() => { setEditingEvent(null); setFormOpen(true) }}
        >
          <Plus size={13} />
          New Event
        </button>
      </div>

      {/* Body */}
      <div className="grid gap-5 [grid-template-columns:268px_1fr] items-start max-[680px]:[grid-template-columns:1fr]">
        <MiniCalendar
          year={viewYear}
          month={viewMonth}
          today={today}
          selectedDate={selectedDate}
          eventDates={eventDates}
          onSelectDate={handleSelectDate}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
        />

        {/* Event list panel */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 min-h-[22px]">
            {selectedDate ? (
              <>
                <span className="text-sm font-semibold text-muted uppercase tracking-[0.05em]">{selectedDate}</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-[0.2rem] text-sm text-muted bg-transparent border-none cursor-pointer px-[0.35rem] py-[0.1rem] rounded font-[inherit] transition-all duration-150 hover:text-[#b8c5d0] hover:bg-tertiary"
                  onClick={() => setSelectedDate(null)}
                >
                  <X size={11} /> All upcoming
                </button>
              </>
            ) : (
              <span className="text-sm font-semibold text-muted uppercase tracking-[0.05em]">Upcoming</span>
            )}
          </div>

          {isLoading && <p className="text-sm text-muted m-[0.25rem_0]">Loading…</p>}
          {error && <p className="text-sm text-semantic-error m-[0.25rem_0]">Failed to load events.</p>}
          {!isLoading && !error && displayedEvents.length === 0 && (
            <p className="text-sm text-muted m-[0.25rem_0]">
              {selectedDate ? 'No events on this day.' : 'No upcoming events.'}
            </p>
          )}

          <div className="flex flex-col gap-[0.35rem]">
            {displayedEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                serverAliases={serverAliases}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      </div>

      {formOpen && (
        <EventFormModal
          initial={editingEvent ? eventToForm(editingEvent) : { ...EMPTY_FORM, date: selectedDate ?? today }}
          editing={editingEvent !== null}
          servers={servers}
          serverAliases={serverAliases}
          discordEnabled={discordEnabled}
          onSave={handleSave}
          onClose={closeForm}
        />
      )}
    </section>
  )
}
