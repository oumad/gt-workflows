import { FileText, Folder, Sparkles, Eye } from 'lucide-react'
import type { FieldValue, ParsedField } from './parser'
import { DARK, inputBase } from './previewStyles'
import { Label, PillButton } from './Preview'
import { SelectField, NumberStepper, UploadBox, BrowseField } from './FieldInputs'

export function FieldView({
  field,
  value,
  onChange,
}: {
  field: ParsedField
  value: FieldValue
  onChange: (v: FieldValue) => void
}) {
  if (field.type === 'checkbox') {
    return (
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'default',
          fontSize: 13,
          color: DARK.ink,
        }}
      >
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: DARK.accent, width: 15, height: 15 }}
        />
        {field.title}
      </label>
    )
  }

  return (
    <div>
      {!field.hideTitle && (
        <Label
          hint={
            field.ai && (
              <div style={{ display: 'flex', gap: 6 }}>
                {field.ai.refine && (
                  <PillButton icon={Sparkles} label="Refine" title="AI: refine prompt" />
                )}
                {field.ai.describeImage && (
                  <PillButton icon={Eye} label="Describe image" title="AI: describe image" />
                )}
              </div>
            )
          }
        >
          {field.title}
        </Label>
      )}

      {field.type === 'textField' && (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={inputBase}
        />
      )}

      {field.type === 'textArea' && (
        <textarea
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputBase, resize: 'vertical', padding: '8px 10px', lineHeight: 1.4 }}
        />
      )}

      {field.type === 'select' && (
        <SelectField
          value={String(value ?? '')}
          options={field.options ?? []}
          onChange={onChange}
        />
      )}

      {field.type === 'slider' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="number"
            value={Number(value ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{
              width: 84,
              background: DARK.bg,
              border: `1px solid ${DARK.line}`,
              color: DARK.ink,
              borderRadius: 6,
              padding: '5px 8px',
              font: '13px var(--font-mono)',
              outline: 'none',
            }}
          />
          <input
            type="range"
            value={Number(value ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: DARK.accent }}
          />
        </div>
      )}

      {field.type === 'number' && (
        <NumberStepper
          fieldName={field.id.split('#')[1] ?? ''}
          value={Number(value ?? 0)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={onChange}
        />
      )}

      {field.type === 'uploadImage' && <UploadBox kind="image" field={field} value={value} />}
      {field.type === 'uploadVideo' && <UploadBox kind="video" field={field} value={value} />}
      {field.type === 'uploadAudio' && <UploadBox kind="audio" field={field} value={value} />}

      {field.type === 'file' && (
        <BrowseField icon={FileText} value={value} onChange={onChange} accept={field.accept} />
      )}
      {field.type === 'folder' && <BrowseField icon={Folder} value={value} onChange={onChange} />}

      {field.type === 'unknown' && (
        <div style={{ fontSize: 11, color: DARK.ink3, fontStyle: 'italic' }}>
          (unsupported field type)
        </div>
      )}
    </div>
  )
}
