import { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import type {
  PowerflowConfig,
  PowerflowNodeSpec,
  PowerflowFieldSpec,
  RawWorkflow,
} from './parser-types'
import { normalizeField, compactField } from './powerflow'
import { Section } from './EditNodeModal'
import { FieldRow, inputStyle } from './FieldEditor'

/** Editor for the top-level `powerflowConfig` block on params.json. Owns
 *  the modal shell and the per-section editing (enabled/exclusive flags +
 *  inputs[]/outputs[] node lists). The parent NodeManager holds the live
 *  config in state and persists on Save like every other change.
 *
 *  The picker for nodeId / fields is driven by the workflow's actual nodes
 *  so the user can't typo an id that doesn't exist. */

const FIELD_TYPE_OPTIONS = ['text', 'image', 'video', 'audio', 'number', 'boolean'] as const

type Side = 'inputs' | 'outputs'

export function PowerflowConfigModal({
  config,
  workflow,
  onChange,
  onClose,
}: {
  config: PowerflowConfig | null
  workflow: RawWorkflow
  /** Receives the next config or `null` to clear. */
  onChange: (next: PowerflowConfig | null) => void
  onClose: () => void
}) {
  const cfg: PowerflowConfig = config ?? {}
  const enabled = cfg.enabled ?? false
  const exclusive = cfg.exclusive ?? false
  const inputs = cfg.availableConnections?.inputs ?? []
  const outputs = cfg.availableConnections?.outputs ?? []

  // Esc to close — matches EditNodeModal's affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patchFlags = (next: Partial<Pick<PowerflowConfig, 'enabled' | 'exclusive'>>) => {
    onChange({ ...cfg, ...next })
  }

  const patchSide = (side: Side, list: PowerflowNodeSpec[]) => {
    const ac = cfg.availableConnections ?? {}
    onChange({ ...cfg, availableConnections: { ...ac, [side]: list } })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.45)',
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
          width: 'min(760px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg, 0 12px 36px rgba(0,0,0,.18))',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}
            >
              PowerFlow configuration
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              params.json → <span className="mono">powerflowConfig</span>
            </div>
          </div>
          {config != null && (
            <button
              className="btn btn-sm"
              onClick={() => onChange(null)}
              title="Remove the powerflowConfig block entirely"
              style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}
            >
              <Trash2 size={13} /> Remove
            </button>
          )}
          <button onClick={onClose} title="Close" className="btn btn-sm btn-icon">
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            overflowY: 'auto',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <Section title="Flags">
            <ToggleRow
              label="Enabled"
              hint="When off, the integration is wired but inactive."
              checked={enabled}
              onChange={(v) => patchFlags({ enabled: v })}
            />
            <ToggleRow
              label="Exclusive"
              hint="When on, PowerFlow consumes the connections exclusively (no other client can claim them)."
              checked={exclusive}
              onChange={(v) => patchFlags({ exclusive: v })}
            />
          </Section>

          <NodeSpecList
            side="inputs"
            title="Inputs"
            description="Nodes whose input fields are exposed to PowerFlow."
            specs={inputs}
            workflow={workflow}
            onChange={(list) => patchSide('inputs', list)}
          />
          <NodeSpecList
            side="outputs"
            title="Outputs"
            description="Nodes whose outputs are surfaced to PowerFlow."
            specs={outputs}
            workflow={workflow}
            onChange={(list) => patchSide('outputs', list)}
          />
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Node-spec list (inputs or outputs) ─────────────────────────── */

function NodeSpecList({
  title,
  description,
  specs,
  workflow,
  onChange,
}: {
  side: Side
  title: string
  description: string
  specs: PowerflowNodeSpec[]
  workflow: RawWorkflow
  onChange: (list: PowerflowNodeSpec[]) => void
}) {
  const usedIds = useMemo(() => new Set(specs.map((s) => s.nodeId)), [specs])
  const availableNodes = useMemo(() => {
    const out: { id: string; classType: string; title: string }[] = []
    for (const [id, node] of Object.entries(workflow)) {
      if (id.includes(':')) continue // skip subgraph children
      if (node.class_type === 'AppInfo') continue
      if (usedIds.has(id)) continue
      out.push({ id, classType: node.class_type, title: node._meta?.title ?? id })
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }, [workflow, usedIds])

  const [addOpen, setAddOpen] = useState(false)

  const updateSpec = (nodeId: string, patch: Partial<PowerflowNodeSpec>) => {
    onChange(specs.map((s) => (s.nodeId === nodeId ? { ...s, ...patch } : s)))
  }
  const removeSpec = (nodeId: string) => {
    onChange(specs.filter((s) => s.nodeId !== nodeId))
  }
  const addSpec = (nodeId: string) => {
    onChange([...specs, { nodeId, fields: [] }])
    setAddOpen(false)
  }

  return (
    <Section title={title}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{description}</div>
      {specs.length === 0 && (
        <div
          style={{
            padding: '10px 12px',
            border: '1px dashed var(--line)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--ink-3)',
            textAlign: 'center',
          }}
        >
          No nodes tracked yet.
        </div>
      )}
      {specs.map((spec) => (
        <NodeSpecRow
          key={spec.nodeId}
          spec={spec}
          workflow={workflow}
          onChange={(patch) => updateSpec(spec.nodeId, patch)}
          onRemove={() => removeSpec(spec.nodeId)}
        />
      ))}

      {availableNodes.length > 0 &&
        (addOpen ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: 220,
              overflowY: 'auto',
              padding: 6,
              border: '1px solid var(--line)',
              borderRadius: 8,
            }}
          >
            {availableNodes.map((n) => (
              <button
                key={n.id}
                className="row"
                onClick={() => addSpec(n.id)}
                style={{
                  background: 'transparent',
                  border: 0,
                  padding: '6px 8px',
                  borderRadius: 6,
                  fontSize: 12,
                  gap: 8,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="mono" style={{ color: 'var(--ink-3)' }}>
                  {n.id}
                </span>
                <span style={{ flex: 1 }}>{n.title}</span>
                <span className="chip" style={{ fontSize: 10 }}>
                  {n.classType}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => setAddOpen(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            <Plus size={13} /> Add node
          </button>
        ))}
    </Section>
  )
}

/* ── Per-node row inside a list ─────────────────────────────────── */

function NodeSpecRow({
  spec,
  workflow,
  onChange,
  onRemove,
}: {
  spec: PowerflowNodeSpec
  workflow: RawWorkflow
  onChange: (patch: Partial<PowerflowNodeSpec>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)
  const node = workflow[spec.nodeId]
  const title = node?._meta?.title ?? spec.nodeId
  const classType = node?.class_type ?? '—'
  // Suggested field names = the keys on the node's inputs map (workflow.json)
  // — those are the names the Comfy server understands when wired up.
  const knownInputs = useMemo(() => Object.keys(node?.inputs ?? {}), [node])

  const addField = () => {
    const nextName = knownInputs.find(
      (n) =>
        !spec.fields.some((f) => (typeof f === 'string' ? f === n : f.name === n)),
    )
    onChange({ fields: [...spec.fields, nextName ?? 'new_field'] })
  }
  const updateField = (idx: number, next: PowerflowFieldSpec) => {
    const fields = [...spec.fields]
    fields[idx] = next
    onChange({ fields })
  }
  const removeField = (idx: number) => {
    onChange({ fields: spec.fields.filter((_, i) => i !== idx) })
  }

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}
      >
        <button
          className="btn btn-sm btn-icon"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {spec.nodeId}
        </span>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>· {classType}</span>
        <span style={{ flex: 1 }} />
        <span className="chip" style={{ fontSize: 10 }}>
          {spec.fields.length} {spec.fields.length === 1 ? 'field' : 'fields'}
        </span>
        <button
          className="btn btn-sm btn-icon"
          title="Remove this node"
          onClick={onRemove}
          style={{ color: 'var(--bad)' }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {spec.fields.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              No fields tracked. Add at least one.
            </div>
          )}
          {spec.fields.map((f, i) => (
            <FieldRowEditor
              key={i}
              field={f}
              knownInputs={knownInputs}
              onChange={(next) => updateField(i, next)}
              onRemove={() => removeField(i)}
            />
          ))}
          <button
            className="btn btn-sm"
            onClick={addField}
            style={{ alignSelf: 'flex-start' }}
          >
            <Plus size={12} /> Add field
          </button>
        </div>
      )}
    </div>
  )
}

/* ── One field row (string or object shape) ─────────────────────── */

function FieldRowEditor({
  field,
  knownInputs,
  onChange,
  onRemove,
}: {
  field: PowerflowFieldSpec
  knownInputs: string[]
  onChange: (next: PowerflowFieldSpec) => void
  onRemove: () => void
}) {
  const normalized = normalizeField(field)
  const [advanced, setAdvanced] = useState(Boolean(normalized.label || normalized.type))

  const patch = (next: { name?: string; label?: string; type?: string }) => {
    const merged = { ...normalized, ...next }
    // Empty strings should drop back to undefined so compactField re-folds
    // the row to a bare string when nothing custom is set.
    if (merged.label === '') delete merged.label
    if (merged.type === '') delete merged.type
    onChange(compactField(merged))
  }

  return (
    <div
      style={{
        padding: 10,
        border: '1px solid var(--line)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FieldRow label="Field name">
          <input
            list={knownInputs.length ? `pf-inputs-${knownInputs.join(',').length}` : undefined}
            value={normalized.name}
            onChange={(e) => patch({ name: e.target.value })}
            style={inputStyle}
            placeholder="e.g. image"
          />
          {knownInputs.length > 0 && (
            <datalist id={`pf-inputs-${knownInputs.join(',').length}`}>
              {knownInputs.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </FieldRow>
        <button
          className="btn btn-sm btn-icon"
          onClick={() => setAdvanced((v) => !v)}
          title={advanced ? 'Hide overrides' : 'Add label / type overrides'}
          style={{ alignSelf: 'flex-end' }}
        >
          {advanced ? '−' : '+'}
        </button>
        <button
          className="btn btn-sm btn-icon"
          onClick={onRemove}
          title="Remove field"
          style={{ alignSelf: 'flex-end', color: 'var(--bad)' }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {advanced && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FieldRow label="Label">
            <input
              value={normalized.label ?? ''}
              onChange={(e) => patch({ label: e.target.value })}
              style={inputStyle}
              placeholder="Display label (optional)"
            />
          </FieldRow>
          <FieldRow label="Type">
            <select
              value={normalized.type ?? ''}
              onChange={(e) => patch({ type: e.target.value })}
              style={inputStyle}
            >
              <option value="">(default)</option>
              {FIELD_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>
      )}
    </div>
  )
}

/* ── Local toggle row — modeled on the one in EditNodeModal ────── */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
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
