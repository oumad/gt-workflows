import { useRef, useState } from 'react'
import { GripVertical, AlertCircle } from 'lucide-react'
import type { ParsedModel, AvailableNode } from './parser'
import type { PowerflowConfig, RawWorkflow } from './parser-types'
import { CategoryBlock } from './CategoryBlock'
import { FieldBlock } from './FieldBlock'
import { AddNodeButton } from './AddNodeButton'
import { OutputNodesSection } from './OutputNodesSection'

export type Path = number[]
export type Side = 'before' | 'after'

interface DragCtx {
  fromPath: Path
  overPath: Path | null
  overSide: Side
}

export interface DnD {
  drag: DragCtx | null
  setDrag: (d: DragCtx | null) => void
  onReorder: (fromPath: Path, toParent: Path, toIdx: number) => void
}

function samePath(a: Path, b: Path) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
function sameParent(a: Path, b: Path) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length - 1; i++) if (a[i] !== b[i]) return false
  return true
}

export function NodeBlocks({
  model,
  loading,
  error,
  onReorder,
  onEditNode,
  expanded,
  onToggleExpanded,
  availableNodes,
  onAddNode,
  rawWorkflow,
  powerflowCfg,
  onPowerflowChange,
}: {
  model: ParsedModel | null
  loading: boolean
  error: string | null
  onReorder: (fromPath: Path, toParent: Path, toIdx: number) => void
  onEditNode: (nodeId: string) => void
  expanded: Record<string, boolean>
  onToggleExpanded: (id: string, defaultOpen: boolean) => void
  availableNodes: AvailableNode[]
  onAddNode: (nodeId: string) => void
  /** Raw workflow (workflow.json contents) — used to find candidate output
   *  nodes. Optional so the component still renders pre-load. */
  rawWorkflow?: RawWorkflow | null
  /** Current powerflowConfig (or null if unset) — drives the Outputs
   *  section's tracked state. */
  powerflowCfg?: PowerflowConfig | null
  onPowerflowChange?: (next: PowerflowConfig | null) => void
}) {
  const [drag, setDragState] = useState<DragCtx | null>(null)
  const draggingRef = useRef<DragCtx | null>(null)
  const setDrag = (d: DragCtx | null) => {
    draggingRef.current = d
    setDragState(d)
  }

  const dnd: DnD = { drag, setDrag, onReorder }

  return (
    <div
      style={{
        height: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'auto',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
      }}
      onDragEnd={() => setDrag(null)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
        {loading && <Status>Loading nodes…</Status>}
        {error && (
          <Status>
            <AlertCircle size={14} /> {error}
          </Status>
        )}
        {model && model.sections.length === 0 && <Status>No nodes to display.</Status>}
        {model &&
          model.sections.map((s, i) =>
            s.kind === 'field' ? (
              <FieldBlock
                key={s.field.id + i}
                field={s.field}
                path={[i]}
                dnd={dnd}
                onEditNode={onEditNode}
              />
            ) : (
              <CategoryBlock
                key={s.id + i}
                id={s.id}
                sectionIndex={i}
                label={s.label}
                open={expanded[s.id] ?? s.defaultOpen}
                onToggle={() => onToggleExpanded(s.id, s.defaultOpen)}
                children={s.children}
                dnd={dnd}
                flags={{
                  input: s.input,
                  hidden: s.hidden,
                  parsed: s.parsed,
                  defaulted: s.defaulted,
                  wrapped: s.wrapped,
                }}
                onEditNode={onEditNode}
              />
            ),
          )}
      </div>
      <div style={{ padding: '0 14px 14px' }}>
        <AddNodeButton availableNodes={availableNodes} onAddNode={onAddNode} />
      </div>

      {rawWorkflow && onPowerflowChange && (
        <div style={{ padding: '0 14px 14px' }}>
          <OutputNodesSection
            workflow={rawWorkflow}
            cfg={powerflowCfg ?? null}
            onChange={onPowerflowChange}
          />
        </div>
      )}
    </div>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: 'var(--ink-3)',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </div>
  )
}

/* ── Drag/drop wiring ──────────────────────────────────────────── */

function indicatorStyle(active: boolean, side: Side): React.CSSProperties {
  if (!active) return {}
  const line = '2px solid var(--accent, #d4a373)'
  return side === 'before'
    ? { boxShadow: `inset 0 2px 0 0 var(--accent, #d4a373)`, borderTop: line }
    : { boxShadow: `inset 0 -2px 0 0 var(--accent, #d4a373)`, borderBottom: line }
}

export function useDragHandlers(path: Path, dnd: DnD) {
  const onDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path.join('.'))
    dnd.setDrag({ fromPath: path, overPath: null, overSide: 'before' })
  }

  const onDragOver = (e: React.DragEvent) => {
    const d = dnd.drag
    if (!d) return
    if (!sameParent(d.fromPath, path)) return // only same-parent
    if (samePath(d.fromPath, path)) return // ignore self
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side: Side = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    if (d.overPath && samePath(d.overPath, path) && d.overSide === side) return
    dnd.setDrag({ ...d, overPath: path, overSide: side })
  }

  const onDrop = (e: React.DragEvent) => {
    const d = dnd.drag
    if (!d || !d.overPath) return
    e.preventDefault()
    e.stopPropagation()
    const parent = path.slice(0, -1)
    const baseIdx = d.overPath[d.overPath.length - 1]
    const toIdx = baseIdx + (d.overSide === 'after' ? 1 : 0)
    dnd.onReorder(d.fromPath, parent, toIdx)
    dnd.setDrag(null)
  }

  const isOver = dnd.drag?.overPath && samePath(dnd.drag.overPath, path)
  const isFrom = dnd.drag && samePath(dnd.drag.fromPath, path)

  return {
    handlers: { onDragStart, onDragOver, onDrop },
    indicator: indicatorStyle(Boolean(isOver), dnd.drag?.overSide ?? 'before'),
    isFrom: Boolean(isFrom),
  }
}

export function Grip() {
  return (
    <span
      title="Drag to reorder"
      style={{
        display: 'grid',
        placeItems: 'center',
        cursor: 'grab',
        color: 'var(--ink-3)',
        marginRight: -4,
      }}
    >
      <GripVertical size={14} />
    </span>
  )
}

export function IdChip({ id, title }: { id: string; title?: string }) {
  return (
    <span
      className="mono"
      title={title ?? id}
      style={{
        fontSize: 10.5,
        color: 'var(--ink-3)',
        fontWeight: 500,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        padding: '1px 6px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {id}
    </span>
  )
}
