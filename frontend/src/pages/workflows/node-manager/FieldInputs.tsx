import {
  ChevronRight,
  ChevronLeft,
  Image as ImageIcon,
  Video,
  Music,
  GitCompare,
  Paintbrush,
} from 'lucide-react'
import type { FieldValue, ParsedField } from './parser'
import { DARK, inputBase } from './previewStyles'

export function SelectField({
  value,
  options,
  onChange,
}: {
  value: string
  options: ReturnType<typeof Object> extends never
    ? never
    : ParsedField['options'] extends infer T
      ? T
      : never
  onChange: (v: FieldValue) => void
}) {
  const opts = (options ?? []) as NonNullable<ParsedField['options']>
  const current = opts.find((o) => o.value === value)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {current?.image && (
        <div
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: 6,
            background: DARK.bg,
            border: `1px solid ${DARK.line}`,
            display: 'grid',
            placeItems: 'center',
            color: DARK.ink3,
          }}
          title={current.image}
        >
          <ImageIcon size={14} />
        </div>
      )}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputBase}>
        {opts.map((o) => (
          <option key={o.value} value={o.value} disabled={o.dynamic}>
            {o.label ?? o.value}
            {o.image ? ' 🖼' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export function NumberStepper({
  fieldName,
  value,
  min,
  max,
  step,
  onChange,
}: {
  fieldName: string
  value: number
  min?: number
  max?: number
  step: number
  onChange: (v: number) => void
}) {
  const clamp = (v: number) => {
    if (min !== undefined && v < min) return min
    if (max !== undefined && v > max) return max
    return v
  }
  // Round to step precision to avoid floating-point drift
  const precision = (() => {
    const s = String(step)
    const i = s.indexOf('.')
    return i < 0 ? 0 : s.length - i - 1
  })()
  const round = (v: number) => Number(v.toFixed(precision))
  const dec = () => onChange(clamp(round(value - step)))
  const inc = () => onChange(clamp(round(value + step)))

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: DARK.surface,
        border: `1px solid ${DARK.line}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button onClick={dec} title="Decrement" style={stepBtn}>
        <ChevronLeft size={14} />
      </button>
      <span
        style={{
          fontSize: 13,
          color: DARK.ink2,
          marginLeft: 4,
        }}
      >
        {fieldName}
      </span>
      <span style={{ flex: 1 }} />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 70,
          textAlign: 'right',
          background: 'transparent',
          border: 0,
          outline: 'none',
          color: DARK.ink,
          font: '13px var(--font-mono)',
          padding: '7px 4px',
        }}
      />
      <button onClick={inc} title="Increment" style={stepBtn}>
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

const stepBtn: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 32,
  height: 36,
  flexShrink: 0,
  background: 'transparent',
  border: 0,
  padding: 0,
  color: DARK.ink2,
  cursor: 'pointer',
}

export function UploadBox({
  kind,
  field,
  value,
}: {
  kind: 'image' | 'video' | 'audio'
  field: ParsedField
  value: FieldValue
}) {
  const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? Video : Music
  const heightPx = (() => {
    if (kind !== 'image' || !field.imageSize) return 140
    const m = field.imageSize.match(/^(\d+)/)
    return m ? Number(m[1]) : 140
  })()

  return (
    <div
      style={{
        position: 'relative',
        height: heightPx,
        borderRadius: 10,
        border: `1px dashed ${DARK.line}`,
        background: DARK.bg,
        display: 'grid',
        placeItems: 'center',
        color: DARK.ink3,
        fontSize: 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <Icon size={22} />
        <div>
          {value ? String(value) : `Click or drop ${kind === 'image' ? 'an image' : `a ${kind}`}`}
        </div>
        {field.accept && field.accept.length > 0 && (
          <div style={{ fontSize: 10, color: DARK.ink3, opacity: 0.7 }}>
            {field.accept.join(' · ')}
          </div>
        )}
      </div>

      {field.drawMask && (
        <div
          title="Mask drawing enabled"
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: DARK.surface2,
            border: `1px solid ${DARK.line}`,
            borderRadius: 999,
            padding: '3px 7px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: DARK.ink2,
          }}
        >
          <Paintbrush size={11} /> Mask
        </div>
      )}

      {field.compare && (
        <div
          title="Side-by-side compare with output"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: DARK.surface2,
            border: `1px solid ${DARK.line}`,
            borderRadius: 999,
            padding: '3px 7px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: DARK.ink2,
          }}
        >
          <GitCompare size={11} /> Compare
        </div>
      )}
    </div>
  )
}

export function BrowseField({
  icon: Icon,
  value,
  onChange,
  accept,
}: {
  icon: React.ElementType
  value: FieldValue
  onChange: (v: FieldValue) => void
  accept?: string[]
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={accept?.length ? accept.join(' · ') : 'path…'}
        style={inputBase}
      />
      <button
        disabled
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: DARK.surface2,
          border: `1px solid ${DARK.line}`,
          color: DARK.ink2,
          borderRadius: 8,
          padding: '0 12px',
          font: '500 12px var(--font-ui)',
          cursor: 'default',
          opacity: 0.7,
        }}
      >
        <Icon size={12} /> Browse
      </button>
    </div>
  )
}
