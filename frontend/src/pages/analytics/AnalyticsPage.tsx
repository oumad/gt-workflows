import { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { type Range } from './analyticsHelpers'
import { useTabWithUrl } from '../../hooks/useTabWithUrl'
import { RangeSelector } from '../../components/ui/RangeSelector'
import { OverviewTab } from './tabs/OverviewTab'
import { PerformanceTab } from './tabs/PerformanceTab'
import { UsageTab } from './tabs/UsageTab'
import { DistributionTab } from './tabs/DistributionTab'
import { ComparisonTab } from './tabs/ComparisonTab'

/* ────────────────────────────────────────────────────────────────────
 *  Analytics page — five tabs (Overview, Performance, Usage,
 *  Distribution, Side-by-side). Range selector lives in the PageHead and
 *  each tab refetches when it changes. Each tab is its own file under
 *  ./tabs/ — see analyticsShared.tsx for Loading/Error placeholders.
 *
 *  A freshness timestamp next to the controls tells users when the page
 *  last refetched. Each tab change / range change resets the clock; the
 *  numbers in view are at most a few seconds older than that timestamp.
 *  (The server-side analytics cache adds up to ~60s on top of that — the
 *  tooltip on the freshness label calls this out.)
 * ──────────────────────────────────────────────────────────────────── */

function FreshnessLabel({ refreshedAt }: { refreshedAt: number }) {
  // Tick once a minute so the relative label drifts in step with reality.
  // No interval below 60s — a 30s clock would re-render the whole page head
  // for no user value.
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const ageSec = Math.max(0, Math.round((Date.now() - refreshedAt) / 1000))
  const label =
    ageSec < 45
      ? 'just now'
      : ageSec < 90
        ? '1m ago'
        : ageSec < 3600
          ? `${Math.round(ageSec / 60)}m ago`
          : `${Math.round(ageSec / 3600)}h ago`

  return (
    <span
      title={`Refetched at ${new Date(refreshedAt).toLocaleTimeString()}. The backend caches analytics aggregates for up to 60s, so figures may reflect data slightly older than the timestamp shown.`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: 'var(--ink-3)',
        padding: '0 6px',
        cursor: 'help',
      }}
    >
      <Clock size={11} /> Updated {label}
    </span>
  )
}

export function AnalyticsPage() {
  const [tab, setTab] = useTabWithUrl('overview', [
    'overview',
    'performance',
    'usage',
    'distribution',
    'comparison',
  ])
  const [range, setRange] = useState<Range>('7d')
  // Bumped on every tab or range change. Each tab refetches on those, so
  // this approximates "when the visible data was last loaded" without
  // needing the tabs to call back into the shell.
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now())
  useEffect(() => {
    setRefreshedAt(Date.now())
  }, [tab, range])

  return (
    <>
      <PageHead
        crumbs={['Brews', 'Analytics']}
        title="Analytics"
        sub="Numbers, distributions, and time-series across the hub"
        actions={
          <>
            <FreshnessLabel refreshedAt={refreshedAt} />
            <RangeSelector range={range} onChange={setRange} />
          </>
        }
      />
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'performance', label: 'Performance' },
          { id: 'usage', label: 'Usage' },
          { id: 'distribution', label: 'Distribution' },
          // Renamed from "Comparison" — that label was opaque about what was
          // being compared. "Side-by-side" reads as a verb and the tab's own
          // header explains the grouping options.
          { id: 'comparison', label: 'Side-by-side' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="body">
        {tab === 'overview' && <OverviewTab range={range} />}
        {tab === 'performance' && <PerformanceTab range={range} />}
        {tab === 'usage' && <UsageTab range={range} />}
        {tab === 'distribution' && <DistributionTab range={range} />}
        {tab === 'comparison' && <ComparisonTab range={range} />}
      </div>
    </>
  )
}
