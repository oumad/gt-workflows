import { useMemo } from 'react'
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import type { FieldValue, ParsedField, ParsedModel } from './parser'
import { FieldView } from './FieldView'
import { DARK } from './previewStyles'

export { DARK } from './previewStyles'

export function Preview({
  model,
  loading,
  error,
  expanded,
  onToggleExpanded,
  onFieldChange,
}: {
  model: ParsedModel | null
  loading: boolean
  error: string | null
  expanded: Record<string, boolean>
  onToggleExpanded: (id: string, defaultOpen: boolean) => void
  onFieldChange: (fieldId: string, value: FieldValue) => void
}) {
  return (
    <div
      style={{
        background: DARK.bg,
        border: `1px solid ${DARK.line}`,
        borderRadius: 'var(--radius-lg)',
        color: DARK.ink,
        height: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'auto',
        padding: 20,
      }}
    >
      {loading && <Status>Loading workflow definition…</Status>}
      {error && (
        <Status>
          <AlertCircle size={16} /> {error}
        </Status>
      )}
      {model && (
        <Body
          model={model}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onFieldChange={onFieldChange}
        />
      )}
    </div>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: DARK.ink3,
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {children}
    </div>
  )
}

function Body({
  model,
  expanded,
  onToggleExpanded,
  onFieldChange,
}: {
  model: ParsedModel
  expanded: Record<string, boolean>
  onToggleExpanded: (id: string, defaultOpen: boolean) => void
  onFieldChange: (fieldId: string, value: FieldValue) => void
}) {
  // Flat map of fieldId → current value (from the model)
  const values = useMemo(() => {
    const v: Record<string, FieldValue> = {}
    for (const sec of model.sections) {
      const fields = sec.kind === 'category' ? sec.children : [sec.field]
      for (const f of fields) v[f.id] = f.default
    }
    return v
  }, [model])

  /**
   * Multi-rule visibility — mirrors gt-plugins' auto-node logic:
   *   - any positive (`displayedWhen`-style) rule that matches keeps the
   *     field visible. If no positive rules exist at all, the positive gate
   *     is treated as satisfied (so a block with only hidden-when rules
   *     reads as "visible by default, hidden under conditions").
   *   - any negative (`inverted` / `hiddenWhen`-style) rule that matches
   *     forces the field hidden, regardless of the positive side.
   * The two checks AND together; the field is visible only when both pass.
   */
  const isVisible = (f: ParsedField) => {
    if (f.hidden) return false
    if (!f.showWhen || f.showWhen.length === 0) return true
    const positives = f.showWhen.filter((r) => !r.inverted)
    const negatives = f.showWhen.filter((r) => r.inverted)
    const positiveOk =
      positives.length === 0 || positives.some((r) => values[r.fieldId] === r.equals)
    const negativeOk = !negatives.some((r) => values[r.fieldId] === r.equals)
    return positiveOk && negativeOk
  }

  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 22,
          letterSpacing: '-0.01em',
        }}
      >
        {model.workflowName}
      </h2>

      {model.sections.length === 0 && (
        <div style={{ marginTop: 16, color: DARK.ink3, fontSize: 13 }}>
          No parseable inputs in this workflow.
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {model.sections.map((s, i) => {
          if (s.kind === 'field') {
            if (!isVisible(s.field)) return null
            return (
              <FieldView
                key={s.field.id + i}
                field={s.field}
                value={values[s.field.id]}
                onChange={(v) => onFieldChange(s.field.id, v)}
              />
            )
          }
          if (s.hidden) return null
          return (
            <Category
              key={s.id + i}
              label={s.label}
              open={expanded[s.id] ?? s.defaultOpen}
              onToggle={() => onToggleExpanded(s.id, s.defaultOpen)}
            >
              {s.children.filter(isVisible).map((f) => (
                <FieldView
                  key={f.id}
                  field={f}
                  value={values[f.id]}
                  onChange={(v) => onFieldChange(f.id, v)}
                />
              ))}
            </Category>
          )
        })}
      </div>
    </>
  )
}

function Category({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        border: `1px solid ${DARK.line}`,
        borderRadius: 10,
        background: DARK.surface,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          background: 'transparent',
          border: 0,
          color: DARK.ink,
          font: '600 13px var(--font-ui)',
          cursor: 'default',
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
      </button>
      {open && (
        <div
          style={{
            padding: '4px 12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            borderTop: `1px solid ${DARK.line}`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          color: DARK.ink2,
        }}
      >
        {children}
      </div>
      {hint}
    </div>
  )
}

export { inputBase } from './previewStyles'

export function PillButton({
  icon: Icon,
  label,
  title,
}: {
  icon: React.ElementType
  label: string
  title?: string
}) {
  return (
    <button
      disabled
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: DARK.surface2,
        border: `1px solid ${DARK.line}`,
        color: DARK.ink2,
        borderRadius: 999,
        padding: '3px 9px',
        font: '500 11px var(--font-ui)',
        cursor: 'default',
        opacity: 0.7,
      }}
    >
      <Icon size={11} /> {label}
    </button>
  )
}
