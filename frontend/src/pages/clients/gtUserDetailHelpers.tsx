const AVATAR_COLORS = [
  'var(--info)',
  'var(--good)',
  'var(--accent)',
  'var(--pop-purple)',
  'var(--pop-pink)',
  'var(--pop-cyan)',
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
]

export function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export function initials(name: string | null, email: string | null): string {
  const src = name ?? email ?? '?'
  return src
    .split(/[\s@._-]/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Shared "last seen" formatter used across the Clients views. Minute / hour
 *  / day granularity is good enough for the list chip and the detail badge;
 *  the precise timestamp is in the chip's `title` tooltip when needed. */
export function relTime(iso: string | null): { label: string; tone: string } {
  if (!iso) return { label: 'never', tone: 'bad' }
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  const hrs = Math.floor(ms / 3_600_000)
  const days = Math.floor(ms / 86_400_000)
  if (mins < 1) return { label: 'just now', tone: 'good' }
  if (hrs < 1) return { label: `${mins}m ago`, tone: 'good' }
  if (days < 1) return { label: `${hrs}h ago`, tone: 'good' }
  if (days === 1) return { label: 'yesterday', tone: 'good' }
  if (days <= 7) return { label: `${days}d ago`, tone: 'warn' }
  return { label: `${days}d ago`, tone: 'bad' }
}

// Canonical duration formatting lives in lib/format — re-exported under the
// name this helper has historically used.
export { fmtDurationMs as fmtMs } from '../../lib/format'

export function fmtHours(ms: number | null | undefined): string {
  if (!ms) return '—'
  const h = ms / 3_600_000
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 10) return `${h.toFixed(1)}h`
  return `${Math.round(h)}h`
}

export function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

// Canonical relative-time formatting lives in lib/format.
export { fmtRelativeTime as fmtAgo } from '../../lib/format'

export function statusTone(s: string): string {
  if (s === 'completed') return 'good'
  if (s === 'failed') return 'bad'
  if (s === 'active' || s === 'running') return 'warn'
  return ''
}

export function RankChip({ rank, of }: { rank: number | null; of: number }) {
  if (rank == null)
    return (
      <span className="chip" style={{ fontSize: 10 }}>
        —
      </span>
    )
  const top = of > 0 ? Math.round((rank / of) * 100) : 100
  const tone = top <= 10 ? 'good' : top <= 30 ? 'warn' : ''
  return (
    <span className={`chip${tone ? ` chip-${tone}` : ''}`} style={{ fontSize: 10 }}>
      #{rank} <span style={{ opacity: 0.6 }}>of {of}</span>
    </span>
  )
}

export function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
      <div className="bar" style={{ flex: 1 }}>
        <i style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 11, width: 32, textAlign: 'right', flexShrink: 0 }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}
