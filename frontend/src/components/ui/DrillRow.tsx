import { clickable } from '../../lib/clickable'

/** Clickable list-row helper with a hover background. Used in Doctor
 *  Overview to wrap each "top X" item. Behavior matches the reference's
 *  drill-row pattern: cursor-pointer + soft surface-2 highlight on hover
 *  (the highlight is a CSS `:hover` rule on `.drill-row`). */
export function DrillRow({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  title?: string
}) {
  return (
    <div
      className={onClick ? 'drill-row' : undefined}
      title={title}
      {...clickable(onClick)}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 8,
        padding: '8px 10px',
        margin: '-8px -10px',
        transition: 'background 120ms ease',
      }}
    >
      {children}
    </div>
  )
}
