import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../../lib/api'
import { RefreshCw } from 'lucide-react'
import { loadPrefs } from '../preferences/PreferencesPage'
import { loadSession } from '../../lib/storage'
import {
  type UnifiedLiveResponse,
  type Row,
  liveToRow,
  fmtSec,
  avg,
  LiveJobsTables,
  JobModal,
} from './shared'
import { ExpandingToggle } from '../../components/ui/ExpandingToggle'
import { Kpi } from '../../components/ui/Kpi'
import { useServers } from '../../hooks/useServers'
import { downServerIdSet } from '../_shared/serverHelpers'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void

export const KIND_OPTIONS = [
  { value: 'all' as const, label: 'All jobs' },
  { value: 'wf' as const, label: 'Workflows' },
  { value: 'lora' as const, label: 'LoRA' },
]

export const REFRESH_OPTIONS = [
  { value: '5' as const, label: '5s' },
  { value: '30' as const, label: '30s' },
  { value: '60' as const, label: '60s' },
  { value: 'off' as const, label: 'Off' },
]

/* ─── Live feed ──────────────────────────────────────────────────── */
export function LiveFeed({
  onCount,
  navigate,
}: {
  onCount?: (n: number) => void
  navigate?: NavigateFn
}) {
  const [running, setRunning] = useState<Row[]>([])
  const [waiting, setWaiting] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'wf' | 'lora'>('all')
  const [refresh, setRefresh] = useState<'off' | '5' | '30' | '60'>(() => loadPrefs().autoRefresh)
  const [avgDurations, setAvgDurations] = useState<Record<string, number>>({})
  const [openRow, setOpenRow] = useState<Row | null>(null)
  // Read once on mount: the toggle is only meaningful when a GT user has been
  // linked in Preferences. Live filtering is client-side because the /live
  // endpoint doesn't accept a userId query yet.
  const prefs = loadPrefs()
  const myId = prefs.myGtUserId
  const [mineOnly, setMineOnly] = useState(false)

  // Server health (polled ~15s by DataContext) so a running/waiting job whose
  // service — or the host it runs on — is down gets a "Down" marker.
  const { servers } = useServers()
  const downServerIds = useMemo(() => downServerIdSet(servers), [servers])

  // Convert a single payload to the row arrays + invoke onCount.
  const applyPayload = useCallback(
    (res: UnifiedLiveResponse) => {
      const now = Date.now()
      const nextRunning = (res.running ?? []).map((j) => liveToRow(j, 'active', now))
      const nextWaiting = (res.waiting ?? []).map((j) => liveToRow(j, 'waiting', now))
      setRunning(nextRunning)
      setWaiting(nextWaiting)
      onCount?.(nextRunning.length)
    },
    [onCount],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<UnifiedLiveResponse>('/api/jobs/live')
      applyPayload(res)
    } catch {
      /**/
    } finally {
      setLoading(false)
    }
  }, [applyPayload])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    api
      .get<Record<string, number>>('/api/wf-jobs/avg-duration')
      .then(setAvgDurations)
      .catch(() => {})
  }, [])

  // Auto-refresh. When `refresh === '5'` we prefer the SSE stream (push-based,
  // ~2s tick on the server); for longer cadences (30s, 60s) polling is fine
  // and avoids holding a long-lived connection open. 'off' disables both.
  useEffect(() => {
    if (refresh === 'off') return
    if (refresh === '5') {
      // SSE — token passed via ?token=… since EventSource can't set headers.
      const session = loadSession()
      const token = session?.token ?? ''
      const url = '/api/jobs/stream' + (token ? `?token=${encodeURIComponent(token)}` : '')
      const es = new EventSource(url)
      es.addEventListener('live', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as UnifiedLiveResponse
          applyPayload(data)
          setLoading(false)
        } catch {
          /* ignore parse errors */
        }
      })
      es.onerror = () => {
        // The browser auto-reconnects; just surface a brief loading flicker.
        setLoading(true)
      }
      return () => es.close()
    }
    const id = setInterval(load, Number(refresh) * 1000)
    return () => clearInterval(id)
  }, [refresh, load, applyPayload])

  const apply = (rows: Row[]) => {
    let r = filter === 'all' ? rows : rows.filter((x) => x.kind === filter)
    if (mineOnly && myId) r = r.filter((x) => x.clientId === myId)
    return r
  }
  const runWf = running.filter((r) => r.kind === 'wf'),
    runLo = running.filter((r) => r.kind === 'lora')
  const waitWf = waiting.filter((r) => r.kind === 'wf'),
    waitLo = waiting.filter((r) => r.kind === 'lora')

  const wfWaits = waitWf.map((r) => r.waitingSec ?? 0)
  const loraWaits = waitLo.map((r) => r.waitingSec ?? 0)
  const allWaits = [...wfWaits, ...loraWaits]

  const StatCard = ({
    label,
    value,
    color,
    sub,
  }: {
    label: string
    value: string | number
    color?: string
    sub?: React.ReactNode
  }) => <Kpi label={label} value={value} valueColor={color} valueSize={26} sub={sub} />
  const WL = ({ w, l }: { w: number; l: number }) => (
    <span className="row" style={{ gap: 8 }}>
      <span style={{ color: 'var(--pop-purple)' }} title="ComfyUI workflow jobs">
        {w} Workflow
      </span>
      <span style={{ color: 'var(--ink-3)' }}>·</span>
      <span style={{ color: 'var(--pop-pink)' }} title="LoRA training jobs">
        {l} LoRA
      </span>
    </span>
  )

  const visRun = apply(running)
  const visWait = apply(waiting)

  return (
    <>
      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 12 }}>
        <StatCard
          label="Running"
          value={running.length}
          color="var(--accent)"
          sub={<WL w={runWf.length} l={runLo.length} />}
        />
        <StatCard
          label="Waiting"
          value={waiting.length}
          sub={<WL w={waitWf.length} l={waitLo.length} />}
        />
        <StatCard
          label="Avg wait"
          value={fmtSec(avg(allWaits))}
          sub={
            <span className="row" style={{ gap: 8 }}>
              <span style={{ color: 'var(--pop-purple)' }} title="ComfyUI workflow jobs">
                Workflow {fmtSec(avg(wfWaits))}
              </span>
              <span style={{ color: 'var(--ink-3)' }}>·</span>
              <span style={{ color: 'var(--pop-pink)' }} title="LoRA training jobs">
                LoRA {fmtSec(avg(loraWaits))}
              </span>
            </span>
          }
        />
        <StatCard
          label="Avg running"
          value={fmtSec(avg(running.map((r) => r.elapsedSec ?? 0)))}
          sub={
            <span className="row" style={{ gap: 8 }}>
              <span style={{ color: 'var(--pop-purple)' }} title="ComfyUI workflow jobs">
                Workflow {fmtSec(avg(runWf.map((r) => r.elapsedSec ?? 0)))}
              </span>
              <span style={{ color: 'var(--ink-3)' }}>·</span>
              <span style={{ color: 'var(--pop-pink)' }} title="LoRA training jobs">
                LoRA {fmtSec(avg(runLo.map((r) => r.elapsedSec ?? 0)))}
              </span>
            </span>
          }
        />
      </div>

      {/* Kind filter + auto-refresh */}
      <div className="row" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
        <ExpandingToggle options={KIND_OPTIONS} value={filter} onChange={setFilter} />
        {myId && (
          <button
            className={`btn btn-sm ${mineOnly ? 'btn-primary' : ''}`}
            onClick={() => setMineOnly((v) => !v)}
            title={
              mineOnly
                ? `Showing only ${prefs.myGtUserLabel ?? 'your'}'s jobs — click to show all.`
                : `Show only ${prefs.myGtUserLabel ?? 'your'}'s jobs.`
            }
          >
            {mineOnly ? 'Mine only' : 'Mine'}
          </button>
        )}
        <ExpandingToggle
          options={REFRESH_OPTIONS}
          value={refresh}
          onChange={setRefresh}
          prefix={
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                padding: '0 6px 0 4px',
                fontWeight: 600,
              }}
            >
              <RefreshCw
                size={11}
                className={loading && refresh !== 'off' ? 'spin' : ''}
                style={{ marginRight: 4, verticalAlign: 'middle' }}
              />
              Auto
            </span>
          }
        />
        <span className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {visRun.length} running · {visWait.length} waiting
        </span>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} />
        </button>
      </div>

      <LiveJobsTables
        running={visRun}
        waiting={visWait}
        onSelect={setOpenRow}
        loading={loading}
        avgDurations={avgDurations}
        navigate={navigate}
        downServerIds={downServerIds}
      />

      {openRow && <JobModal row={openRow} onClose={() => setOpenRow(null)} />}
    </>
  )
}
