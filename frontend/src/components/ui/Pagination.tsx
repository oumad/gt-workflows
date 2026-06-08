/* Pagination — first / prev / next / last + page indicator.
 *
 * Pulled out of JobsHistory so the Doctor (Failures + Slow jobs) and any
 * future paginated list can share the same control shape and shortcut
 * behaviour. The component is purely presentational: state lives in the
 * caller, which decides whether pagination is client- or server-side.
 *
 * Rendered as a strip sitting inside the bottom border of its parent card,
 * which is why it ships with `borderTop: '1px solid var(--line)'` baked in. */

type Props = {
  page: number
  totalPages: number
  onChange: (p: number) => void
  /** Loading-state lock — disables every nav button so the user can't
   *  queue another fetch on top of an in-flight one. */
  disabled?: boolean
  /** Optional bit of context shown left of the page indicator, e.g.
   *  "2,341 total" or "page" prefix differences. */
  leftLabel?: React.ReactNode
}

export function Pagination({ page, totalPages, onChange, disabled = false, leftLabel }: Props) {
  const safeMax = Math.max(1, totalPages)
  const atFirst = disabled || page <= 1
  const atLast = disabled || page >= safeMax

  return (
    <div
      className="row"
      style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--line)',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {leftLabel != null && (
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{leftLabel}</span>
      )}
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        Page {page} of {safeMax}
      </span>
      <span className="spacer" />
      <button
        className="btn btn-sm"
        onClick={() => onChange(1)}
        disabled={atFirst}
        title="First page"
      >
        ««
      </button>
      <button
        className="btn btn-sm"
        onClick={() => onChange(page - 1)}
        disabled={atFirst}
        title="Previous page"
      >
        «
      </button>
      <button
        className="btn btn-sm"
        onClick={() => onChange(page + 1)}
        disabled={atLast}
        title="Next page"
      >
        »
      </button>
      <button
        className="btn btn-sm"
        onClick={() => onChange(safeMax)}
        disabled={atLast}
        title="Last page"
      >
        »»
      </button>
    </div>
  )
}
