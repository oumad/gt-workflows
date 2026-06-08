import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'

export type SortDir = 'asc' | 'desc'

/** Sortable `<th>` cell. Click cycles the column's sort direction.
 *
 *  Generic over `K extends string` so callers can pass their own enum:
 *
 *      <SortableHeader<MyKey> label="Name" col="name" cur={sort} dir={dir} onSort={set} />
 *
 *  Replaces three separate copies in JobsHistory, GtUsersPage, DoctorList. */
export function SortableHeader<K extends string>({
  label,
  col,
  cur,
  dir,
  onSort,
  num,
  style,
}: {
  label: string
  col: K
  cur: K | null
  dir: SortDir
  onSort: (k: K) => void
  /** Right-align number columns. */
  num?: boolean
  style?: React.CSSProperties
}) {
  const active = cur === col
  return (
    <th
      onClick={() => onSort(col)}
      style={{
        ...style,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        textAlign: num ? 'right' : (style?.textAlign ?? 'left'),
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          width: '100%',
          justifyContent: num ? 'flex-end' : 'flex-start',
        }}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp size={10} />
          ) : (
            <ArrowDown size={10} />
          )
        ) : (
          <ArrowUpDown size={9} style={{ opacity: 0.25 }} />
        )}
      </span>
    </th>
  )
}
