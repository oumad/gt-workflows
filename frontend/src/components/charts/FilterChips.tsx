export type Chippable = { name: string; color: string }

type Props<T extends Chippable> = {
  items: T[]
  selected: string[] // names
  onToggle: (name: string) => void
  onAll?: () => void
  onNone?: () => void
  maxNote?: string // e.g. "selected · max 4"
}

export function FilterChips<T extends Chippable>({
  items,
  selected,
  onToggle,
  onAll,
  onNone,
  maxNote,
}: Props<T>) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {items.map((it) => {
        const on = selected.includes(it.name)
        return (
          <button
            key={it.name}
            onClick={() => onToggle(it.name)}
            className="chip"
            style={{
              cursor: 'pointer',
              border: '1px solid ' + (on ? it.color : 'var(--line)'),
              background: on
                ? `color-mix(in oklab, ${it.color} 14%, var(--surface))`
                : 'var(--surface)',
              color: on ? 'var(--ink)' : 'var(--ink-3)',
              padding: '4px 10px',
              fontSize: 12,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: it.color,
                marginRight: 6,
                opacity: on ? 1 : 0.4,
              }}
            />
            {it.name}
          </button>
        )
      })}
      {(onAll || onNone || maxNote) && (
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          {maxNote && (
            <span style={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
              {maxNote}
            </span>
          )}
          {onAll && (
            <button className="btn btn-xs" onClick={onAll}>
              All
            </button>
          )}
          {onNone && (
            <button className="btn btn-xs" onClick={onNone}>
              None
            </button>
          )}
        </span>
      )}
    </div>
  )
}
