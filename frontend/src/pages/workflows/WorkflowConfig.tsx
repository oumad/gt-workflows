import { useState, useMemo } from 'react'
import {
  Workflow as WorkflowIcon,
  Sparkles,
  Image as ImageIcon,
  Video,
  AudioLines,
  Database,
  GraduationCap,
  Tag as TagIcon,
  Wrench,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { ServerUrlPicker } from './ServerUrlPicker'
import type { Workflow, Server } from '../../types'

const ICON_BADGES = [
  { id: 'none', label: 'None', color: 'transparent' },
  { id: 'beta', label: 'Beta', color: 'var(--info)' },
  { id: 'new', label: 'New', color: 'var(--good)' },
  { id: 'experimental', label: 'Experimental', color: 'var(--warn)' },
  { id: 'deprecated', label: 'Deprecated', color: 'var(--bad)' },
  { id: 'internal', label: 'Internal', color: 'var(--ink-2)' },
] as const

const ICON_GLYPHS: { id: string; Icon: React.ElementType }[] = [
  { id: 'workflow', Icon: WorkflowIcon },
  { id: 'spark', Icon: Sparkles },
  { id: 'image', Icon: ImageIcon },
  { id: 'video', Icon: Video },
  { id: 'audio', Icon: AudioLines },
  { id: 'data', Icon: Database },
  { id: 'train', Icon: GraduationCap },
  { id: 'tag', Icon: TagIcon },
  { id: 'tool', Icon: Wrench },
]

const TIMEOUT_PRESETS = [60, 300, 900, 1800, 3600]

const CATEGORY_OPTIONS = ['Image', 'Training', 'Video', 'Data', 'Audio', 'Ops', 'General']

const PARSER_OPTIONS = ['default', 'comfyui'] as const

function fmtTimeout(s: number): string {
  if (s >= 3600) return (s / 3600).toFixed(1).replace(/\.0$/, '') + 'h'
  if (s >= 60) return (s / 60).toFixed(s % 60 === 0 ? 0 : 1).replace(/\.0$/, '') + 'm'
  return s + 's'
}

type Values = {
  label: string
  category: string
  description: string
  tags: string[]
  parser: 'default' | 'comfyui'
  timeout: number
  devMode: boolean
  iconBadge: string
  icon: string
  serverUrls: string[]
}

function valuesFrom(wf: Workflow): Values {
  return {
    label: wf.name !== wf.path ? wf.name : '',
    category: wf.category || 'General',
    description: wf.description ?? '',
    tags: wf.tags ?? [],
    parser: wf.parser === 'comfyui' ? 'comfyui' : 'default',
    timeout: wf.timeout ?? 600,
    devMode: wf.devMode,
    iconBadge: 'none',
    icon: wf.icon ?? 'workflow',
    serverUrls: wf.serverUrls,
  }
}

type Props = {
  wf: Workflow
  servers: Server[]
  isAdmin: boolean
  onSaved?: (w: Workflow) => void
}

export function WorkflowConfig({ wf, servers, isAdmin, onSaved }: Props) {
  const initial = useMemo(() => valuesFrom(wf), [wf])
  const [v, setV] = useState<Values>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevWf, setPrevWf] = useState(wf)

  if (prevWf !== wf) {
    setPrevWf(wf)
    setV(initial)
  }

  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  const set = (patch: Partial<Values>) => setV((s) => ({ ...s, ...patch }))

  async function handleSave() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.patch<Workflow>(`/api/workflows/${wf.id}`, {
        label: v.label || null,
        description: v.description || null,
        category: v.category,
        parser: v.parser === 'default' ? null : v.parser,
        tags: v.tags,
        timeout: v.timeout,
        devMode: v.devMode,
        serverUrls: v.serverUrls,
      })
      onSaved?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 16, maxWidth: 980 }}>
      {/* sticky save bar */}
      <div
        className="row"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'var(--bg)',
          padding: '4px 0',
        }}
      >
        <div className="col" style={{ gap: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>
            Configuration
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            How this workflow is registered, executed, and presented.
          </div>
        </div>
        <span className="spacer" />
        {!isAdmin && (
          <span className="chip" style={{ fontSize: 11 }}>
            Read-only · admin required to edit
          </span>
        )}
        {isAdmin && dirty && (
          <span className="chip chip-warn">
            <span className="dot" style={{ background: 'var(--warn)' }} /> Unsaved changes
          </span>
        )}
        {isAdmin && (
          <button
            className="btn btn-sm"
            disabled={!dirty || busy}
            style={{ opacity: dirty && !busy ? 1 : 0.5 }}
            onClick={() => setV(initial)}
          >
            Revert
          </button>
        )}
        {isAdmin && (
          <button
            className="btn btn-sm btn-primary"
            disabled={!dirty || busy}
            style={{
              background: 'var(--accent)',
              borderColor: 'var(--accent)',
              opacity: dirty && !busy ? 1 : 0.5,
            }}
            onClick={handleSave}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            color: 'var(--bad)',
            background: 'var(--bad-soft)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* IDENTITY */}
      <ConfigSection title="Identity" sub="Catalog metadata users see when browsing workflows.">
        <div className="grid-2" style={{ gap: 12 }}>
          <FieldRow
            label="Label"
            hint="Display name shown on the card. Defaults to the folder name."
          >
            <input
              className="input"
              value={v.label}
              onChange={(e) => set({ label: e.target.value })}
              placeholder={wf.path}
            />
          </FieldRow>
          <FieldRow label="Category">
            <input
              className="input"
              list="wf-cfg-cat-list"
              value={v.category}
              onChange={(e) => set({ category: e.target.value })}
              placeholder="Image, Training, Video…"
            />
            <datalist id="wf-cfg-cat-list">
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FieldRow>
        </div>
        <FieldRow label="Description" hint="Plain-language summary, 1–3 sentences.">
          <textarea
            className="input"
            rows={3}
            value={v.description}
            onChange={(e) => set({ description: e.target.value })}
            style={{ resize: 'vertical' }}
          />
        </FieldRow>
        <FieldRow label="Tags" hint="Comma-separated. Drives search and filtering.">
          <TagsField value={v.tags} onChange={(tags) => set({ tags })} />
        </FieldRow>
        <div className="grid-2" style={{ gap: 12 }}>
          <FieldRow label="Icon">
            <IconPicker value={v.icon} onChange={(icon) => set({ icon })} />
          </FieldRow>
          <FieldRow label="Icon badge" hint="Decoration in the catalog card corner.">
            <BadgePicker value={v.iconBadge} onChange={(iconBadge) => set({ iconBadge })} />
          </FieldRow>
        </div>
      </ConfigSection>

      {/* EXECUTION */}
      <ConfigSection title="Execution" sub="Runtime behavior when a job is dispatched.">
        <div className="grid-2" style={{ gap: 12 }}>
          <FieldRow label="Parser type">
            <div className="toggle-group" style={{ width: 'fit-content' }}>
              {PARSER_OPTIONS.map((p) => (
                <button
                  key={p}
                  className={v.parser === p ? 'active' : ''}
                  onClick={() => set({ parser: p })}
                >
                  {p === 'default' ? 'Default' : 'ComfyUI'}
                </button>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Timeout" hint={`Max run duration. Currently ${fmtTimeout(v.timeout)}.`}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                className="input mono"
                type="number"
                min={1}
                value={v.timeout}
                onChange={(e) => set({ timeout: Number(e.target.value || 0) })}
                style={{ width: 110 }}
              />
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>seconds</span>
              <span className="spacer" />
              <div className="toggle-group">
                {TIMEOUT_PRESETS.map((s) => (
                  <button
                    key={s}
                    className={v.timeout === s ? 'active' : ''}
                    onClick={() => set({ timeout: s })}
                  >
                    {fmtTimeout(s)}
                  </button>
                ))}
              </div>
            </div>
          </FieldRow>
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
          <ToggleField
            label="Dev mode"
            hint="Skip cache, log verbosely, expose intermediate artifacts."
            value={v.devMode}
            onChange={(devMode) => set({ devMode })}
          />
        </div>
      </ConfigSection>

      {/* I/O — Servers is editable; workflow file & path are derived. */}
      <ConfigSection title="Inputs & outputs" sub="Where artifacts come from and go to.">
        <FieldRow
          label="Servers"
          hint="ComfyUI endpoint(s) this workflow runs on. Test & Audit let you pick which one to use."
        >
          {isAdmin ? (
            <ServerUrlPicker
              value={v.serverUrls}
              onChange={(serverUrls) => set({ serverUrls })}
              servers={servers}
            />
          ) : (
            <input className="input mono" value={v.serverUrls.join(', ') || '—'} readOnly />
          )}
        </FieldRow>
        <FieldRow
          label="Workflow file"
          hint="Path to the JSON definition relative to the workflow folder."
        >
          <input className="input mono" value={wf.workflowFile ?? ''} readOnly placeholder="—" />
        </FieldRow>
        <FieldRow label="Folder path">
          <input className="input mono" value={wf.path} readOnly />
        </FieldRow>
      </ConfigSection>
    </div>
  )
}

/* ─── Building blocks ─────────────────────────────────────────── */

function ConfigSection({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <div className="card-head" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
        <div className="card-title">{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div className="card-pad col" style={{ gap: 14 }}>
        {children}
      </div>
    </div>
  )
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="form-row" style={{ gap: 5 }}>
      <label>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{hint}</div>}
    </div>
  )
}

function ToggleField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="row"
      style={{
        flex: '1 1 280px',
        minWidth: 240,
        gap: 12,
        alignItems: 'flex-start',
        textAlign: 'left',
        background: value
          ? 'color-mix(in oklab, var(--accent) 8%, var(--surface))'
          : 'var(--surface)',
        border: '1px solid ' + (value ? 'var(--accent)' : 'var(--line)'),
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'default',
      }}
    >
      <span
        style={{
          width: 32,
          height: 18,
          borderRadius: 999,
          padding: 2,
          flexShrink: 0,
          background: value ? 'var(--accent)' : 'var(--line)',
          position: 'relative',
          transition: 'background .15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: 'white',
            transition: 'left .15s',
            boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          }}
        />
      </span>
      <div className="col" style={{ gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{hint}</div>}
      </div>
    </button>
  )
}

function TagsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')

  function add() {
    const t = draft.trim().toLowerCase()
    if (!t || value.includes(t)) {
      setDraft('')
      return
    }
    onChange([...value, t])
    setDraft('')
  }

  return (
    <div
      className="row"
      style={{
        flexWrap: 'wrap',
        gap: 6,
        padding: '6px 8px',
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
      }}
    >
      {value.map((t) => (
        <span
          key={t}
          className="chip"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
        >
          {t}
          <button
            onClick={() => onChange(value.filter((x) => x !== t))}
            style={{
              border: 0,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              padding: 0,
              marginLeft: 2,
              display: 'inline-flex',
            }}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
          if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={add}
        placeholder={value.length ? 'Add tag…' : 'type and press Enter'}
        style={{
          border: 0,
          outline: 'none',
          background: 'transparent',
          flex: '1 1 120px',
          fontSize: 12.5,
          color: 'var(--ink)',
          padding: '2px 4px',
        }}
      />
    </div>
  )
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {ICON_GLYPHS.map(({ id, Icon }) => {
        const on = value === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={id}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              cursor: 'default',
              border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
              background: on ? 'var(--accent-soft)' : 'var(--surface)',
              color: on ? 'var(--accent-ink)' : 'var(--ink-2)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  )
}

function BadgePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {ICON_BADGES.map((b) => {
        const on = value === b.id
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className="row"
            style={{
              gap: 6,
              padding: '6px 10px',
              borderRadius: 999,
              cursor: 'default',
              border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
              background: on ? 'var(--accent-soft)' : 'var(--surface)',
              fontSize: 12,
              fontWeight: on ? 600 : 500,
            }}
          >
            {b.id !== 'none' && (
              <span style={{ width: 8, height: 8, borderRadius: 999, background: b.color }} />
            )}
            {b.label}
          </button>
        )
      })}
    </div>
  )
}
