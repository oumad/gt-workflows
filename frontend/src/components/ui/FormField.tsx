/** Label-above-input wrapper. Matches the uppercase-letter-spaced look the
 *  design system uses for drawer + modal forms. Re-used by Calendar create,
 *  Users edit, and the workflow modals. */
export function FormField({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{hint}</div>}
    </div>
  )
}
