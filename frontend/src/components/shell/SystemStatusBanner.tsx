import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { WifiOff, RefreshCw } from 'lucide-react'
import { loadSession } from '../../lib/storage'
import { useNotifications } from '../../context/NotificationsContext'

/* Shape of GET /api/health. `sync` is absent on very old deploys — treat a
 * missing `sync` as "done" so we don't show a stuck banner. */
type HealthSync = {
  firstSyncDone: boolean
  running: boolean
  lastSyncAt: string | null
  lastSyncOk: boolean
  syncCount: number
}
type HealthResponse = {
  ok: boolean
  db?: string
  sync?: HealthSync
}

type Status = 'ok' | 'offline' | 'syncing'

type Ident = { id: string; name: string }

/** Operational summary aggregated server-side. Returns down IDENTITIES (not
 *  just counts) so the client can set-diff between polls — catching a
 *  simultaneous down+recover that a count delta would miss, and naming the
 *  records. Maintenance is excluded from the down sets. */
type StatusSummary = {
  ts: number
  downServers: Ident[]
  downServices: Ident[]
  servicesInMaintenance: number
  failedJobs5m: number
  slowJobs5m: number
}

// Healthy → relaxed polling. Offline / syncing → check often so the banner
// clears (or appears) promptly.
const POLL_HEALTHY_MS = 20_000
const POLL_BUSY_MS = 5_000
const FETCH_TIMEOUT_MS = 6_000
const SUMMARY_POLL_MS = 10_000
const BASELINE_KEY = 'coffee-maker-ops-baseline'

const isVisible = () => document.visibilityState === 'visible'

/**
 * Fixed top strip for CONNECTION state only:
 *   - offline — /api/health unreachable. The app is loaded but the API isn't.
 *   - syncing — backend up but the initial Redis→Postgres sync isn't done,
 *               so data-heavy pages may look empty.
 *
 * Ops issues (servers/services down etc.) are deliberately NOT a banner any
 * more — the standing state lives in the sidebar badges, and OpsTransitionToasts
 * below announces the CHANGES.
 */
export function SystemStatusBanner() {
  const [status, setStatus] = useState<Status>('ok')
  const healthTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      // Skip while the tab is backgrounded — re-polled immediately on return
      // (visibilitychange below). Saves a steady stream of requests nobody
      // is looking at.
      if (!isVisible()) {
        healthTimer.current = window.setTimeout(poll, POLL_HEALTHY_MS)
        return
      }
      let next: Status
      try {
        const ctl = new AbortController()
        const to = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
        const res = await fetch('/api/health', { cache: 'no-store', signal: ctl.signal })
        window.clearTimeout(to)
        const body = (await res.json().catch(() => null)) as HealthResponse | null

        if (!res.ok || !body || body.ok !== true) {
          next = 'offline'
        } else if (body.sync && !body.sync.firstSyncDone) {
          next = 'syncing'
        } else {
          next = 'ok'
        }
      } catch {
        next = 'offline'
      }

      if (cancelled) return
      setStatus(next)
      healthTimer.current = window.setTimeout(poll, next === 'ok' ? POLL_HEALTHY_MS : POLL_BUSY_MS)
    }

    const onVisible = () => {
      if (!isVisible()) return
      if (healthTimer.current) window.clearTimeout(healthTimer.current)
      void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    poll()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (healthTimer.current) window.clearTimeout(healthTimer.current)
    }
  }, [])

  if (status === 'ok') return null

  const offline = status === 'offline'
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10_000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '6px 14px',
        fontSize: 12.5,
        fontWeight: 600,
        color: '#fff',
        background: offline ? 'var(--bad)' : 'var(--accent)',
        boxShadow: '0 2px 10px rgba(0,0,0,.25)',
      }}
    >
      {offline ? (
        <>
          <WifiOff size={14} />
          Lost connection to the server — retrying…
        </>
      ) : (
        <>
          <RefreshCw size={14} className="spin" />
          Initial data sync in progress — some pages may be incomplete.
        </>
      )}
    </div>
  )
}

const namesOf = (arr: Ident[]): string => {
  const shown = arr.slice(0, 5).map((x) => x.name)
  return arr.length > 5 ? `${shown.join(', ')}, +${arr.length - 5} more` : shown.join(', ')
}

/**
 * Renders nothing — polls /api/status/summary and toasts ops TRANSITIONS by
 * set-diffing the down identities between polls: "worker-03 went down" /
 * "2 services recovered". Plus edge-triggered toasts (0 → >0) for failed and
 * slow jobs in the last 5 minutes.
 *
 * Baseline survives reloads via sessionStorage, so a transition that happened
 * while the tab was reloading isn't lost. A brand-new session (no stored
 * baseline) starts silent — standing problems are the sidebar badges' job,
 * not a toast on every load. Mounted inside NotificationsProvider.
 */
export function OpsTransitionToasts() {
  const { notify } = useNotifications()
  const navigate = useNavigate()
  const prevRef = useRef<StatusSummary | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    // Seed from the last persisted summary so a reload diffs against the
    // pre-reload state instead of re-baselining (and missing transitions).
    try {
      const stored = sessionStorage.getItem(BASELINE_KEY)
      if (stored) prevRef.current = JSON.parse(stored) as StatusSummary
    } catch {
      /* corrupt/absent — start from a clean baseline */
    }

    let cancelled = false

    async function poll() {
      if (!isVisible()) {
        timer.current = window.setTimeout(poll, SUMMARY_POLL_MS)
        return
      }
      try {
        const ctl = new AbortController()
        const to = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
        // requireAuth-protected; auth is a Bearer JWT (no cookies), so mirror
        // the header the `api` client attaches on every other call.
        const session = loadSession()
        const res = await fetch('/api/status/summary', {
          cache: 'no-store',
          signal: ctl.signal,
          headers: session ? { Authorization: `Bearer ${session.token}` } : {},
        })
        window.clearTimeout(to)
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as StatusSummary | null
          if (!cancelled && body) handleSummary(body)
        }
      } catch {
        /* network blip — the connection banner covers real outages */
      }
      if (!cancelled) timer.current = window.setTimeout(poll, SUMMARY_POLL_MS)
    }

    function handleSummary(summary: StatusSummary) {
      const prev = prevRef.current
      prevRef.current = summary
      try {
        sessionStorage.setItem(BASELINE_KEY, JSON.stringify(summary))
      } catch {
        /* storage full / disabled — diffing still works in-memory */
      }
      if (!prev) return // first-ever baseline this session

      const announce = (
        kind: 'server' | 'service',
        before: Ident[],
        after: Ident[],
        path: string,
      ) => {
        const beforeIds = new Set(before.map((x) => x.id))
        const afterIds = new Set(after.map((x) => x.id))
        const newlyDown = after.filter((x) => !beforeIds.has(x.id))
        const recovered = before.filter((x) => !afterIds.has(x.id))
        const label = (n: number) => `${n} ${kind}${n === 1 ? '' : 's'}`
        const action = { label: `View ${kind}s`, onClick: () => navigate(path) }
        if (newlyDown.length > 0) {
          notify({
            variant: 'error',
            title: `${label(newlyDown.length)} went down`,
            body: namesOf(newlyDown),
            action,
          })
        }
        if (recovered.length > 0) {
          notify({
            variant: 'success',
            title: `${label(recovered.length)} recovered`,
            body: after.length === 0 ? `All ${kind}s are back up.` : namesOf(recovered),
            action,
          })
        }
      }

      announce('server', prev.downServers, summary.downServers, '/servers')
      announce('service', prev.downServices, summary.downServices, '/services')

      // Edge-trigger (0 → >0) so the rolling 5-min window doesn't re-toast as
      // the count drifts. Resets once the window empties back to 0.
      if (prev.failedJobs5m === 0 && summary.failedJobs5m > 0) {
        const n = summary.failedJobs5m
        notify({
          variant: 'error',
          title: `${n} job${n === 1 ? '' : 's'} failed`,
          body: 'In the last 5 minutes.',
          action: { label: 'View failures', onClick: () => navigate('/doctor?tab=failures') },
        })
      }
      if (prev.slowJobs5m === 0 && summary.slowJobs5m > 0) {
        const n = summary.slowJobs5m
        notify({
          variant: 'warn',
          title: `${n} job${n === 1 ? '' : 's'} running slow`,
          body: 'Past 1.5× the usual duration.',
          action: { label: 'View live', onClick: () => navigate('/jobs?tab=live') },
        })
      }
    }

    const onVisible = () => {
      if (!isVisible()) return
      if (timer.current) window.clearTimeout(timer.current)
      void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    poll()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [notify, navigate])

  return null
}
