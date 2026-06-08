import { ChevronDown, ChevronRight } from 'lucide-react'
import type { NodeFlags, ParsedField } from './parser'
import { Grip, IdChip, useDragHandlers, type DnD } from './NodeBlocks'
import { FieldBlock, Flags } from './FieldBlock'

export function CategoryBlock({
  id,
  sectionIndex,
  label,
  open,
  onToggle,
  children,
  dnd,
  flags,
  onEditNode,
}: {
  id: string
  sectionIndex: number
  label: string
  open: boolean
  onToggle: () => void
  children: ParsedField[]
  dnd: DnD
  flags: NodeFlags
  onEditNode: (nodeId: string) => void
}) {
  const path = [sectionIndex]
  const { handlers, indicator, isFrom } = useDragHandlers(path, dnd)

  return (
    <div
      draggable
      {...handlers}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--surface)',
        overflow: 'hidden',
        opacity: isFrom ? 0.4 : flags.hidden ? 0.55 : 1,
        ...indicator,
      }}
    >
      <div
        onClick={() => onEditNode(id)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          font: '600 13px var(--font-ui)',
          color: 'var(--ink)',
          cursor: 'pointer',
        }}
      >
        <Grip />
        <button
          title={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 22,
            height: 22,
            flexShrink: 0,
            background: 'transparent',
            border: 0,
            padding: 0,
            color: 'var(--ink-2)',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <Flags flags={{ ...flags, wrapped: !open || undefined }} />
        <IdChip id={id} />
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            fontWeight: 500,
            background: 'var(--surface-2)',
            padding: '2px 7px',
            borderRadius: 999,
          }}
        >
          {children.length}
        </span>
      </div>
      {open && (
        <div
          style={{
            padding: '8px 10px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderTop: '1px solid var(--line)',
            background: 'var(--bg)',
          }}
        >
          {children.map((f, j) => (
            <FieldBlock
              key={f.id}
              field={f}
              path={[sectionIndex, j]}
              dnd={dnd}
              nested
              onEditNode={onEditNode}
            />
          ))}
        </div>
      )}
    </div>
  )
}
