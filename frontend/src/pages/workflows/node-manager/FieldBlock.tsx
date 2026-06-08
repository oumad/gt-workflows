import {
  Type,
  AlignLeft,
  CheckSquare,
  SlidersHorizontal,
  Hash,
  ChevronsUpDown,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Folder,
  HelpCircle,
  Zap,
} from 'lucide-react'
import type { FieldType, NodeFlags, ParsedField } from './parser'
import { Grip, IdChip, useDragHandlers, type DnD, type Path } from './NodeBlocks'

const TYPE_META: Record<FieldType, { icon: React.ElementType; label: string }> = {
  textField: { icon: Type, label: 'Text' },
  textArea: { icon: AlignLeft, label: 'Text area' },
  checkbox: { icon: CheckSquare, label: 'Checkbox' },
  slider: { icon: SlidersHorizontal, label: 'Slider' },
  number: { icon: Hash, label: 'Number' },
  select: { icon: ChevronsUpDown, label: 'Select' },
  uploadImage: { icon: ImageIcon, label: 'Image' },
  uploadVideo: { icon: Video, label: 'Video' },
  uploadAudio: { icon: Music, label: 'Audio' },
  file: { icon: FileText, label: 'File' },
  folder: { icon: Folder, label: 'Folder' },
  unknown: { icon: HelpCircle, label: 'Unknown' },
}

export function FieldBlock({
  field,
  path,
  dnd,
  nested,
  onEditNode,
}: {
  field: ParsedField
  path: Path
  dnd: DnD
  nested?: boolean
  onEditNode: (nodeId: string) => void
}) {
  const meta = TYPE_META[field.type] ?? TYPE_META.unknown
  const Icon = meta.icon
  const [nodeId] = field.id.split('#')
  const { handlers, indicator, isFrom } = useDragHandlers(path, dnd)

  return (
    <div
      draggable
      {...handlers}
      onClick={() => onEditNode(nodeId)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: nested ? '7px 10px' : '10px 12px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        opacity: isFrom ? 0.4 : field.hidden ? 0.55 : 1,
        cursor: 'pointer',
        ...indicator,
      }}
    >
      <Grip />
      <div
        style={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: 6,
          background: 'var(--surface-2)',
          color: 'var(--ink-2)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Icon size={14} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {field.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', gap: 6, marginTop: 1, alignItems: 'center' }}>
          <span>{meta.label}</span>
          {field.showWhen && field.showWhen.length > 0 && (
            <>
              <span>·</span>
              <span
                title={field.showWhen
                  .map(
                    (r) =>
                      `${r.inverted ? 'Hidden' : 'Visible'} when ${r.fieldId} = ${r.equals}`,
                  )
                  .join('\n')}
              >
                {field.showWhen.length === 1
                  ? 'gated'
                  : `gated · ${field.showWhen.length} rules`}
              </span>
            </>
          )}
          {field.fieldConnectTo && (
            <>
              <span>·</span>
              <span
                title={`Auto-set from ${field.fieldConnectTo.nodeId}#${field.fieldConnectTo.inputField} — managed in params.json, preserved on save.`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '0 5px',
                  height: 14,
                  borderRadius: 3,
                  background: 'color-mix(in oklab, var(--accent) 14%, transparent)',
                  color: 'var(--accent)',
                  fontWeight: 700,
                  fontSize: 9,
                  letterSpacing: '.02em',
                }}
              >
                <Zap size={9} /> AUTO
              </span>
            </>
          )}
        </div>
      </div>
      <Flags flags={{ ...field, wrapped: undefined }} />
      <IdChip id={nodeId} title={field.id} />
    </div>
  )
}

const FLAG_META: Record<keyof NodeFlags, { label: string; full: string; bg: string; fg: string }> =
  {
    input: { label: 'Input', full: 'Input node', bg: '#dbeafe', fg: '#1e3a8a' },
    hidden: {
      label: 'Hidden',
      full: 'Hidden — not shown in preview',
      bg: '#f1f0eb',
      fg: '#5b554a',
    },
    parsed: { label: 'Custom', full: 'Custom parser in params.json', bg: '#dcfce7', fg: '#14532d' },
    defaulted: { label: 'Default', full: 'Default parser applied', bg: '#ede9fe', fg: '#4c1d95' },
    wrapped: { label: 'Wrapped', full: 'Wrapped (collapsed)', bg: '#fef3c7', fg: '#78350f' },
  }
const FLAG_ORDER: (keyof NodeFlags)[] = ['input', 'parsed', 'defaulted', 'wrapped', 'hidden']

export function Flags({ flags }: { flags: NodeFlags }) {
  const active = FLAG_ORDER.filter((k) => flags[k])
  if (active.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {active.map((k) => {
        const m = FLAG_META[k]
        return (
          <span
            key={k}
            title={m.full}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 16,
              padding: '0 6px',
              borderRadius: 4,
              background: m.bg,
              color: m.fg,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '.02em',
            }}
          >
            {m.label}
          </span>
        )
      })}
    </div>
  )
}
