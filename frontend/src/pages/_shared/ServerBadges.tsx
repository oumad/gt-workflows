import type { Server as ServerType } from '../../types'
import { serverStatus, STATUS_TONE, STATUS_LABEL } from './serverHelpers'

export function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="row"
      style={{ justifyContent: 'space-between', gap: 6, fontSize: 12, alignItems: 'center' }}
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

/* ─── Status chip ───────────────────────────── */
export function StatusChip({ status, style }: { status: string; style?: React.CSSProperties }) {
  const tone = STATUS_TONE[status] ?? 'bad'
  const label = STATUS_LABEL[status] ?? status
  return (
    <span className={`chip chip-${tone}`} style={style}>
      <span className={`dot${status === 'busy' ? ' dot-pulse' : ''}`} /> {label}
    </span>
  )
}

export function ServerStatusBadge({
  server,
  style,
}: {
  server: ServerType
  style?: React.CSSProperties
}) {
  const status = serverStatus(server)
  return <StatusChip status={status} style={style} />
}
