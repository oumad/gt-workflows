import { ChevronRight } from 'lucide-react'
import { clickable } from '../../lib/clickable'

export type KpiTone = 'good' | 'warn' | 'bad' | 'info'

/** Single KPI card used across Analytics, Doctor (overview + detail),
 *  GT Users, and a few other places. Was previously open-coded three times
 *  with slightly different signatures. */
export function Kpi({
  label,
  value,
  valueColor,
  valueMono,
  valueSize,
  sub,
  chip,
  chipTone,
  onClick,
}: {
  label: string
  value: React.ReactNode
  valueColor?: string
  valueMono?: boolean
  valueSize?: number
  /** Small muted line rendered under the value. */
  sub?: React.ReactNode
  chip?: React.ReactNode
  chipTone?: KpiTone
  onClick?: () => void
}) {
  return (
    <div
      className="card card-pad"
      {...clickable(onClick)}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="stat-label">{label}</div>
        {onClick && <ChevronRight size={14} color="var(--ink-3)" />}
      </div>
      <div
        className={`stat-value ${valueMono ? 'mono' : ''}`}
        style={{
          color: valueColor,
          fontSize: valueSize ?? (valueMono ? 18 : undefined),
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>}
      {chip && (
        <span className={`chip ${chipTone ? 'chip-' + chipTone : ''}`} style={{ marginTop: 6 }}>
          {chip}
        </span>
      )}
    </div>
  )
}
