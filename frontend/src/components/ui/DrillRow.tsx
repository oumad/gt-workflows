/** Clickable list-row helper with a hover background. Used in Doctor
 *  Overview to wrap each "top X" item. Behavior matches the reference's
 *  drill-row pattern: cursor-pointer + soft surface-2 highlight on hover. */
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
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      onMouseEnter={(e) => {
        if (onClick) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
      }}
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
