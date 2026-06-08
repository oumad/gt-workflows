/**
 * Compact label / value row — an uppercase muted key on the left, arbitrary
 * content on the right. Used for the at-a-glance metadata rows on workflow
 * cards and similar summary panels.
 */
export function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="row"
      style={{ justifyContent: 'space-between', gap: 6, fontSize: 11.5, alignItems: 'center' }}
    >
      <span
        style={{
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          fontWeight: 600,
          fontSize: 10,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}
