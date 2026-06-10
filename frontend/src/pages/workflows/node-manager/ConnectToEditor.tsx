import { useMemo } from 'react'
import { Link2, Plus, Trash2, Unlink } from 'lucide-react'
import { type FieldValue, type ParsedField, type ParsedModel, type ShowWhenRule } from './parser'
import { Section } from './EditNodeModal'
import { FieldRow, inputStyle } from './FieldEditor'

/** Field-level conditional visibility editor — multi-rule.
 *
 *  Each row is one `ShowWhenRule` ({fieldId, equals, inverted?}). The whole
 *  set ORs the positive rules and ANDs the absence of negative rules — see
 *  isVisible() in Preview.tsx for the canonical semantics.
 *
 *  Target field is a Select sourced from the workflow model so users can't
 *  typo an id that doesn't exist. The "Equals" input adapts to the target
 *  field's type (checkbox → true/false, select → options, number → numeric).
 */
type FieldOption = {
  id: string
  title: string
  type: ParsedField['type']
  options?: ParsedField['options']
  group?: string
}

function collectFields(model: ParsedModel | null | undefined, excludeId?: string): FieldOption[] {
  if (!model) return []
  const out: FieldOption[] = []
  for (const sec of model.sections) {
    if (sec.kind === 'field') {
      if (sec.field.id === excludeId) continue
      out.push({
        id: sec.field.id,
        title: sec.field.title,
        type: sec.field.type,
        options: sec.field.options,
      })
    } else {
      for (const f of sec.children) {
        if (f.id === excludeId) continue
        out.push({
          id: f.id,
          title: f.title,
          type: f.type,
          options: f.options,
          group: sec.label,
        })
      }
    }
  }
  return out
}

function parseEquals(raw: string, type: ParsedField['type'] | undefined): FieldValue {
  if (type === 'checkbox') return raw === 'true'
  if (type === 'number' || type === 'slider') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  const n = Number(raw)
  if (Number.isFinite(n) && raw.trim() !== '') return n
  return raw
}

export function ConnectToEditor({
  field,
  model,
  onChange,
}: {
  field: ParsedField | undefined
  model?: ParsedModel | null
  /** Receives the full rule list (or null to clear). */
  onChange: (rules: ShowWhenRule[] | null) => void
}) {
  const rules: ShowWhenRule[] = field?.showWhen ?? []
  const enabled = rules.length > 0

  const fields = useMemo(() => collectFields(model, field?.id), [model, field?.id])
  const grouped = useMemo(() => {
    const m = new Map<string, FieldOption[]>()
    for (const f of fields) {
      const key = f.group ?? '(top-level)'
      const arr = m.get(key) ?? []
      arr.push(f)
      m.set(key, arr)
    }
    return [...m.entries()]
  }, [fields])

  // Editing a rule means producing a new rule list and forwarding it. The
  // editor stays stateless w.r.t. rules — single source of truth lives on
  // the field, which the parent re-reads after each mutation.
  const updateRule = (idx: number, patch: Partial<ShowWhenRule>) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    onChange(next)
  }
  const removeRule = (idx: number) => {
    const next = rules.filter((_, i) => i !== idx)
    onChange(next.length > 0 ? next : null)
  }
  const addRule = () => {
    // Seed a new rule with the first available field's id and a sensible
    // default — true for checkbox/unknown targets, empty string otherwise.
    const tgt = fields[0]
    const seed: ShowWhenRule = {
      fieldId: tgt?.id ?? '',
      equals: tgt?.type === 'checkbox' ? true : '',
    }
    onChange([...rules, seed])
  }
  const enable = () => {
    if (enabled) return
    addRule()
  }
  const disable = () => onChange(null)

  return (
    <Section title="Conditional visibility">
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--surface)',
          cursor: 'default',
        }}
      >
        {enabled ? (
          <Link2 size={15} color="var(--ink-2)" />
        ) : (
          <Unlink size={15} color="var(--ink-3)" />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Enable connection</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            Gate visibility on another field's value. Multiple rules supported — OR for "show when",
            AND-not for "hide when".
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => (e.target.checked ? enable() : disable())}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
        />
      </label>

      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((rule, idx) => (
            <RuleRow
              key={idx}
              rule={rule}
              fields={fields}
              grouped={grouped}
              onChange={(patch) => updateRule(idx, patch)}
              onRemove={() => removeRule(idx)}
            />
          ))}
          <button
            type="button"
            className="btn btn-sm"
            onClick={addRule}
            style={{ alignSelf: 'flex-start' }}
          >
            <Plus size={12} /> Add condition
          </button>
        </div>
      )}
    </Section>
  )
}

function RuleRow({
  rule,
  fields,
  grouped,
  onChange,
  onRemove,
}: {
  rule: ShowWhenRule
  fields: FieldOption[]
  grouped: [string, FieldOption[]][]
  onChange: (patch: Partial<ShowWhenRule>) => void
  onRemove: () => void
}) {
  const targetField = useMemo(
    () => fields.find((f) => f.id === rule.fieldId),
    [fields, rule.fieldId],
  )

  const onTarget = (id: string) => {
    // Reset equals to a sane default for the new target type so the value
    // input doesn't render an out-of-range string into a number field.
    const next = fields.find((f) => f.id === id)
    const seed: FieldValue =
      next?.type === 'checkbox' ? true : next?.type === 'number' || next?.type === 'slider' ? 0 : ''
    onChange({ fieldId: id, equals: seed })
  }

  return (
    <div
      style={{
        padding: 10,
        border: '1px solid var(--line)',
        borderRadius: 8,
        display: 'grid',
        gridTemplateColumns: '120px 1fr 140px 36px',
        gap: 8,
        alignItems: 'end',
      }}
    >
      <FieldRow label="Mode">
        <select
          value={rule.inverted ? 'hiddenWhen' : 'displayedWhen'}
          onChange={(e) => onChange({ inverted: e.target.value === 'hiddenWhen' })}
          style={inputStyle}
        >
          <option value="displayedWhen">Show when</option>
          <option value="hiddenWhen">Hide when</option>
        </select>
      </FieldRow>
      <FieldRow label="Target field">
        {fields.length > 0 ? (
          <select
            value={rule.fieldId}
            onChange={(e) => onTarget(e.target.value)}
            style={inputStyle}
          >
            <option value="">— Pick a field —</option>
            {grouped.map(([groupName, items]) => (
              <optgroup key={groupName} label={groupName}>
                {items.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title || f.id} · {f.type}
                  </option>
                ))}
              </optgroup>
            ))}
            {rule.fieldId && !fields.some((f) => f.id === rule.fieldId) && (
              <option value={rule.fieldId}>{rule.fieldId} (missing)</option>
            )}
          </select>
        ) : (
          <input
            className="mono"
            placeholder="e.g. 220:218#value"
            value={rule.fieldId}
            onChange={(e) => onChange({ fieldId: e.target.value })}
            style={inputStyle}
          />
        )}
      </FieldRow>
      <FieldRow label="Equals">
        <EqualsInput
          value={String(rule.equals)}
          target={targetField}
          onChange={(v) => onChange({ equals: parseEquals(v, targetField?.type) })}
        />
      </FieldRow>
      <button
        type="button"
        className="btn btn-sm btn-icon"
        onClick={onRemove}
        title="Remove this condition"
        style={{ color: 'var(--bad)', alignSelf: 'end' }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

/** Type-aware value input — same rules as the single-row version. */
function EqualsInput({
  value,
  target,
  onChange,
}: {
  value: string
  target: FieldOption | undefined
  onChange: (v: string) => void
}) {
  if (target?.type === 'checkbox') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  if (target?.type === 'select' && target.options && target.options.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        {target.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    )
  }
  if (target?.type === 'number' || target?.type === 'slider') {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    )
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
      placeholder="value"
    />
  )
}
