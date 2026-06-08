import { Plug } from 'lucide-react'
import { type FieldType, type FieldValue, type ParsedField } from './parser'

const FIELD_TYPES: FieldType[] = [
  'textField',
  'textArea',
  'number',
  'slider',
  'checkbox',
  'select',
  'uploadImage',
  'uploadVideo',
  'uploadAudio',
  'file',
  'folder',
]

export function FieldEditor({
  field,
  onChange,
}: {
  field: ParsedField
  onChange: (patch: Partial<ParsedField>) => void
}) {
  const [, fieldName] = field.id.split('#')
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <Plug size={13} color="var(--ink-3)" />
        <span className="mono" style={{ fontSize: 12 }}>
          {fieldName}
        </span>
        <span className="spacer" />
        <label
          className="row"
          style={{ gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'default' }}
        >
          <input
            type="checkbox"
            checked={!!field.required}
            onChange={(e) => onChange({ required: e.target.checked || undefined })}
            style={{ accentColor: 'var(--accent)' }}
          />
          Required
        </label>
        <label
          className="row"
          style={{ gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'default' }}
        >
          <input
            type="checkbox"
            checked={!!field.hidden}
            onChange={(e) => onChange({ hidden: e.target.checked || undefined })}
            style={{ accentColor: 'var(--accent)' }}
          />
          Hide
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
        <FieldRow label="Type">
          <select
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as FieldType })}
            style={inputStyle}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Label">
          <input
            value={field.title}
            onChange={(e) => onChange({ title: e.target.value })}
            style={inputStyle}
          />
        </FieldRow>
      </div>

      <FieldRow label="Default / current value">
        <input
          value={String(field.default ?? '')}
          onChange={(e) => onChange({ default: coerce(e.target.value, field.type) })}
          style={inputStyle}
        />
      </FieldRow>

      {(field.type === 'slider' || field.type === 'number') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <FieldRow label="Min">
            <input
              type="number"
              value={field.min ?? ''}
              onChange={(e) =>
                onChange({ min: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Max">
            <input
              type="number"
              value={field.max ?? ''}
              onChange={(e) =>
                onChange({ max: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Step">
            <input
              type="number"
              value={field.step ?? ''}
              onChange={(e) =>
                onChange({ step: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              style={inputStyle}
            />
          </FieldRow>
        </div>
      )}

      {field.type === 'uploadImage' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FieldRow label="Image size">
            <input
              value={field.imageSize ?? ''}
              placeholder="e.g. 300px"
              onChange={(e) => onChange({ imageSize: e.target.value || undefined })}
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Mask drawing">
            <label
              className="row"
              style={{ gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'default' }}
            >
              <input
                type="checkbox"
                checked={!!field.drawMask}
                onChange={(e) => onChange({ drawMask: e.target.checked || undefined })}
                style={{ accentColor: 'var(--accent)' }}
              />
              Enable mask drawing
            </label>
          </FieldRow>
        </div>
      )}

      {(field.type === 'uploadImage' ||
        field.type === 'uploadVideo' ||
        field.type === 'uploadAudio' ||
        field.type === 'file') && (
        <FieldRow label="Accepted formats (comma-separated)">
          <input
            value={(field.accept ?? []).join(', ')}
            onChange={(e) => {
              const list = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
              onChange({ accept: list.length > 0 ? list : undefined })
            }}
            style={inputStyle}
          />
        </FieldRow>
      )}

      {field.type === 'textArea' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FieldRow label="AI Refine">
            <label
              className="row"
              style={{ gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'default' }}
            >
              <input
                type="checkbox"
                checked={!!field.ai?.refine}
                onChange={(e) =>
                  onChange({
                    ai: e.target.checked
                      ? { ...field.ai, refine: field.ai?.refine ?? {} }
                      : field.ai?.describeImage
                        ? { describeImage: field.ai.describeImage }
                        : undefined,
                  })
                }
                style={{ accentColor: 'var(--accent)' }}
              />
              Enable
            </label>
          </FieldRow>
          <FieldRow label="AI Describe Image">
            <label
              className="row"
              style={{ gap: 6, fontSize: 12, color: 'var(--ink-2)', cursor: 'default' }}
            >
              <input
                type="checkbox"
                checked={!!field.ai?.describeImage}
                onChange={(e) =>
                  onChange({
                    ai: e.target.checked
                      ? { ...field.ai, describeImage: field.ai?.describeImage ?? {} }
                      : field.ai?.refine
                        ? { refine: field.ai.refine }
                        : undefined,
                  })
                }
                style={{ accentColor: 'var(--accent)' }}
              />
              Enable
            </label>
          </FieldRow>
        </div>
      )}

      {field.type === 'select' && (
        <FieldRow label="Options (one per line — strings or JSON)">
          <textarea
            rows={4}
            value={(field.options ?? [])
              .map((o) =>
                o.image || o.dynamic ? JSON.stringify(o) : o.label ? JSON.stringify(o) : o.value,
              )
              .join('\n')}
            onChange={(e) => {
              const lines = e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
              const opts = lines.map((line) => {
                if (line.startsWith('{')) {
                  try {
                    return JSON.parse(line)
                  } catch {
                    return { value: line }
                  }
                }
                return { value: line }
              })
              onChange({ options: opts })
            }}
            style={{ ...inputStyle, font: '12px var(--font-mono)', resize: 'vertical' }}
          />
        </FieldRow>
      )}
    </div>
  )
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '6px 8px',
  font: '13px var(--font-ui)',
  color: 'var(--ink)',
  outline: 'none',
}

function coerce(v: string, type: FieldType): FieldValue {
  if (type === 'checkbox') return v === 'true' || v === '1'
  if (type === 'number' || type === 'slider') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return v
}
