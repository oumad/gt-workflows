import { CheckCircle, XCircle, HelpCircle } from 'lucide-react'
import type { TabCounts } from './types'

interface DependencyAuditTabBadgeProps {
  counts: TabCounts
  soft?: boolean
}

export function DependencyAuditTabBadge({
  counts,
  soft = false,
}: DependencyAuditTabBadgeProps): React.ReactElement | null {
  if (counts.total === 0) return null
  if (counts.missing > 0) {
    return (
      <span className={`dep-audit-tab-badge ${soft ? 'warn' : 'missing'}`}>
        {counts.missing}
      </span>
    )
  }
  if (counts.unknown > 0) {
    return <span className="dep-audit-tab-badge unknown">{counts.unknown}</span>
  }
  return <span className="dep-audit-tab-badge available">{counts.available}</span>
}

type SummaryVariant = 'nodes' | 'models' | 'inputs'

const SUMMARY_LABELS: Record<
  SummaryVariant,
  { available: string; missing: string; unknown: string }
> = {
  nodes: { available: 'Available', missing: 'Missing', unknown: 'Unknown' },
  models: { available: 'Available', missing: 'Missing', unknown: 'Unknown' },
  inputs: { available: 'Found', missing: 'Not found', unknown: '' },
}

interface DependencyAuditSummaryProps {
  counts: TabCounts
  variant: SummaryVariant
}

export function DependencyAuditSummary({
  counts,
  variant,
}: DependencyAuditSummaryProps): React.ReactElement {
  const labels = SUMMARY_LABELS[variant]
  return (
    <div className="dep-audit-summary">
      {counts.available > 0 && (
        <div className="dep-audit-summary-item available">
          <CheckCircle size={16} />
          <span>{counts.available} {labels.available}</span>
        </div>
      )}
      {counts.missing > 0 && (
        <div className={`dep-audit-summary-item ${variant === 'inputs' ? 'warn' : 'missing'}`}>
          {variant === 'inputs' ? <HelpCircle size={16} /> : <XCircle size={16} />}
          <span>{counts.missing} {labels.missing}</span>
        </div>
      )}
      {counts.unknown > 0 && variant !== 'inputs' && (
        <div className="dep-audit-summary-item unknown">
          <HelpCircle size={16} />
          <span>{counts.unknown} {labels.unknown}</span>
        </div>
      )}
    </div>
  )
}
