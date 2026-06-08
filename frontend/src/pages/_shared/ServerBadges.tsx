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
  if (status !== 'service-down') {
    return <StatusChip status={status} style={style} />
  }
  // Host is reachable (ICMP/TCP ok) but the service isn't answering — show both
  // tiers: a red chip for the dead service, a green one for the live host.
  const serviceLabel = server.type === 'lora' ? 'AI-Toolkit' : 'ComfyUI'
  return (
    <span className="row" style={{ gap: 5 }}>
      <span className="chip chip-bad" style={style}>
        <span className="dot" /> {serviceLabel} down
      </span>
      <span className="chip chip-good" style={style}>
        <span className="dot" /> Ping
      </span>
    </span>
  )
}
