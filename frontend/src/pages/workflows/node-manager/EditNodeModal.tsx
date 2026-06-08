import { useEffect, useMemo, useState } from 'react'
import { X, Eye, EyeOff, Package, PackageOpen, Trash2, Zap } from 'lucide-react'
import {
  findNodeFields,
  findCategoryForNode,
  setNodeHidden,
  setNodeConnectTo,
  toggleWrap,
  updateFieldInModel,
  updateCategoryInModel,
  type ParsedModel,
} from './parser'
import { FieldEditor, FieldRow, inputStyle } from './FieldEditor'
import { ConnectToEditor } from './ConnectToEditor'

type RawNode = {
  inputs?: Record<string, unknown>
  class_type?: string
  _meta?: { title?: string }
}

export function EditNodeModal({
  nodeId,
  model,
  rawNode,
  onClose,
  onChange,
  onDelete,
}: {
  nodeId: string
  model: ParsedModel
  rawNode: RawNode | null
  onClose: () => void
  onChange: (updater: (m: ParsedModel) => ParsedModel) => void
  onDelete: () => void
}) {
  const fields = useMemo(() => findNodeFields(model, nodeId), [model, nodeId])
  const category = useMemo(() => findCategoryForNode(model, nodeId), [model, nodeId])
  const isHidden = category?.section.hidden ?? fields[0]?.hidden ?? false
  const isWrapped = category?.section.wrapped ?? fields[0]?.wrapped ?? false
  const isSubgraph = !!category?.section.children.some((f) => !f.id.startsWith(nodeId + '#'))

  const classType = rawNode?.class_type ?? '—'
  const title = category?.section.label ?? fields[0]?.title ?? rawNode?._meta?.title ?? nodeId
  const rawInputs = rawNode?.inputs ?? {}
  const [confirmDel, setConfirmDel] = useState(false)

  // ── Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: 12,
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg, 0 12px 36px rgba(0,0,0,.18))',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              <span className="mono">{nodeId}</span> · {classType}
            </div>
          </div>
          <button onClick={onClose} title="Close" className="btn btn-sm btn-icon">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            overflowY: 'auto',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {category && (
            <Section title="Category">
              <FieldRow label="Label">
                <input
                  value={category.section.label}
                  onChange={(e) =>
                    onChange((m) => updateCategoryInModel(m, nodeId, { label: e.target.value }))
                  }
                  style={inputStyle}
                />
              </FieldRow>
            </Section>
          )}

          {/* Visibility */}
          <Section title="State">
            <ToggleRow
              icon={isHidden ? EyeOff : Eye}
              label={isHidden ? 'Hidden' : 'Visible'}
              hint="Hides this node from the preview."
              checked={isHidden}
              onChange={(v) => onChange((m) => setNodeHidden(m, nodeId, v))}
            />
            <ToggleRow
              icon={isWrapped ? Package : PackageOpen}
              label={
                isSubgraph
                  ? isWrapped
                    ? 'Collapsed by default'
                    : 'Expanded by default'
                  : isWrapped
                    ? 'Wrapped (as category)'
                    : 'Unwrapped (inline)'
              }
              hint={
                isSubgraph
                  ? 'Whether the subgraph starts collapsed.'
                  : 'Wraps the node into a collapsible category.'
              }
              checked={isWrapped}
              onChange={() => onChange((m) => toggleWrap(m, nodeId))}
            />
          </Section>

          {/* Conditional visibility */}
          <ConnectToEditor
            field={fields[0]}
            model={model}
            onChange={(sw) => onChange((m) => setNodeConnectTo(m, nodeId, sw))}
          />

          {/* Field-level "auto-set" connections — read-only badge. The user
           *  can't edit these from coffee-maker (the schema is owned by
           *  gt-plugins) but we surface them so the round-trip is observable. */}
          {fields.some((f) => f.fieldConnectTo) && (
            <Section title="Auto-set connections">
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                Read-only — managed in <span className="mono">params.json</span>. These rules
                auto-set this node's field values when a source field changes; coffee-maker
                preserves them on save but doesn't edit them.
              </div>
              {fields
                .filter((f) => f.fieldConnectTo)
                .map((f) => {
                  const spec = f.fieldConnectTo!
                  const conds = spec.conditions ?? []
                  return (
                    <div
                      key={f.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 10px',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        background: 'var(--surface-2)',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                      >
                        <Zap size={13} color="var(--accent)" />
                        <strong style={{ fontSize: 12 }}>{f.title}</strong>
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>follows</span>
                        <span className="mono" style={{ fontSize: 11 }}>
                          {spec.nodeId}#{spec.inputField}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span className="chip" style={{ fontSize: 10 }}>
                          {conds.length} {conds.length === 1 ? 'rule' : 'rules'}
                        </span>
                      </div>
                      {conds.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                            fontSize: 11,
                            color: 'var(--ink-2)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {conds.map((c, i) => (
                            <div key={i}>
                              when <strong>{String(c.whenValue)}</strong> → set{' '}
                              <strong>{String(c.value)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
            </Section>
          )}

          {/* Fields */}
          {fields.length > 0 && (
            <Section title={fields.length === 1 ? 'Field' : 'Fields'}>
              {fields.map((f) => (
                <FieldEditor
                  key={f.id}
                  field={f}
                  onChange={(patch) => onChange((m) => updateFieldInModel(m, f.id, patch))}
                />
              ))}
            </Section>
          )}

          {/* Available inputs */}
          <Section title="Available inputs (raw)">
            {Object.keys(rawInputs).length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>No inputs on this node.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(rawInputs).map(([name, raw]) => {
                const isConn = Array.isArray(raw)
                const rendered = fields.some((f) => f.id === `${nodeId}#${name}`)
                const status = isConn ? 'connection' : rendered ? 'rendered' : 'hidden'
                return (
                  <div
                    key={name}
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      fontSize: 12,
                      padding: '5px 8px',
                      borderRadius: 6,
                      background: 'var(--surface-2)',
                    }}
                  >
                    <span className="mono">{name}</span>
                    <span style={{ color: 'var(--ink-3)' }}>
                      {status}
                      {isConn && Array.isArray(raw) ? ` → ${raw[0]}[${raw[1]}]` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {!confirmDel ? (
            <button
              className="btn btn-sm"
              onClick={() => setConfirmDel(true)}
              style={{
                color: 'var(--red, #dc2626)',
                borderColor: 'var(--red, #dc2626)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Trash2 size={13} /> Remove node
            </button>
          ) : (
            <>
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Remove this node?</span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  onDelete()
                  onClose()
                }}
                style={{
                  background: 'var(--red, #dc2626)',
                  color: '#fff',
                  borderColor: 'var(--red, #dc2626)',
                }}
              >
                Yes, remove
              </button>
              <button className="btn btn-sm" onClick={() => setConfirmDel(false)}>
                Cancel
              </button>
            </>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Subcomponents ──────────────────────────────────────────── */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: 'var(--ink-3)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  )
}

function ToggleRow({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ElementType
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
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
      <Icon size={15} color="var(--ink-2)" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{hint}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
      />
    </label>
  )
}
