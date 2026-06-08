import { useState } from 'react'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { type UnifiedJob } from './shared'
import { LiveFeed } from './JobsLiveFeed'
import { History } from './JobsHistory'
import { JobsByError } from './JobsByError'
import type { Page } from '../../types'

// Re-export the unified shapes for downstream consumers that still need to
// reach into the raw row (kept here to avoid touching shared imports).
export type { UnifiedJob }

type NavigateFn = (p: Page, path?: string) => void

/* ─── Page ───────────────────────────────────────────────────────── */
const VALID_TABS = new Set(['live', 'history', 'errors'])

export function JobsPage({ navigate }: { navigate?: NavigateFn }) {
  const [tab, setTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab')
      return t && VALID_TABS.has(t) ? t : 'live'
    } catch {
      return 'live'
    }
  })
  const [liveLen, setLiveLen] = useState<number | undefined>(undefined)

  return (
    <>
      <PageHead
        crumbs={['Brews', 'Jobs']}
        title="Jobs"
        sub="What's running and waiting right now"
      />
      <Tabs
        tabs={[
          { id: 'live', label: 'Live feed', pill: liveLen },
          { id: 'history', label: 'History' },
          { id: 'errors', label: 'By error' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="body">
        {tab === 'live' && <LiveFeed onCount={setLiveLen} navigate={navigate} />}
        {tab === 'history' && <History navigate={navigate} />}
        {tab === 'errors' && <JobsByError />}
      </div>
    </>
  )
}
