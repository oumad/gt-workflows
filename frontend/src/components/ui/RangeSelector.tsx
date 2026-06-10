import { type Range } from '../../pages/analytics/analyticsHelpers'

const LABELS: Record<Range, string> = { '24h': '24h', '7d': '7d', '30d': '30d', all: 'All' }
const RANGES: Range[] = ['24h', '7d', '30d', 'all']

export function RangeSelector({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  return (
    <div className="toggle-group">
      {RANGES.map((r) => (
        <button key={r} className={range === r ? 'active' : ''} onClick={() => onChange(r)}>
          {LABELS[r]}
        </button>
      ))}
    </div>
  )
}
