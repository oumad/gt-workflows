import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { loadSession } from '../../lib/storage'

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

/** Operational summary aggregated server-side — counts that change fast enough
 *  to warrant a 5s poll, but slow enough that they shouldn't hammer the DB. */
type StatusSummary = {
  ts: number
  serversDown: number
  servicesInMaintenance: number
  failedJobs5m: number
  slowJobs5m: number
}

// Healthy → relaxed polling. Offline / syncing → check often so the banner
// clears (or appears) promptly.
const POLL_HEALTHY_MS = 20_000
const POLL_BUSY_MS = 5_000
const FETCH_TIMEOUT_MS = 6_000
// Ops summary updates more often than /api/health so the banner reacts to
// new failures and recovered servers without waiting for the next health tick.
const SUMMARY_POLL_MS = 10_000

/**
 * Fixed top strip. Surfaces three things, in priority order:
 *   1. offline   — /api/health unreachable. The app is loaded but the API isn't.
 *   2. syncing   — backend up but the initial Redis→Postgres sync isn't done,
 *                  so data-heavy pages may look empty.
 *   3. ops issues — when healthy, polls /api/status/summary and renders one
 *                   chip per facet (down servers, failed jobs, slow jobs,
 *                   services in maintenance). Each chip routes to its filtered
 *                   view. Hides when every facet is zero.
 *
 * The connection banners take precedence because the summary can't be fetched
 * while the API is unreachable anyway.
 */
export function SystemStatusBanner() {
  const [status, setStatus] = useState<Status>('ok')
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const healthTimer = useRef<number | null>(null)
  const summaryTimer = useRef<number | null>(null)
  const navigate = useNavigate()

  // ── Health poll — gates the rest. Offline ⇒ stop polling summary. ─────
  useEffect(() => {
    let cancelled = false

    async function poll() {
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

    poll()
    return () => {
      cancelled = true
      if (healthTimer.current) window.clearTimeout(healthTimer.current)
    }
  }, [])

  // ── Summary poll — only when healthy. Clears summary on offline/syncing. ─
  useEffect(() => {
    if (status !== 'ok') {
      setSummary(null)
      if (summaryTimer.current) window.clearTimeout(summaryTimer.current)
      return
    }

    let cancelled = false

    async function poll() {
      try {
        const ctl = new AbortController()
        const to = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
        // /api/status/summary is requireAuth-protected; auth in this app is a
        // Bearer JWT from storage (no cookies), so a bare fetch 401s. Mirror
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
          if (!cancelled && body) setSummary(body)
        }
      } catch {
        // Network blip — keep the previous summary; the next /health tick will
        // flip us to 'offline' if the API is really gone.
      }
      if (!cancelled) {
        summaryTimer.current = window.setTimeout(poll, SUMMARY_POLL_MS)
      }
    }

    poll()
    return () => {
      cancelled = true
      if (summaryTimer.current) window.clearTimeout(summaryTimer.current)
    }
  }, [status])

  // ── Connection-status banners take precedence ──────────────────────────
  if (status !== 'ok') {
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

  // ── Ops summary banner (only when at least one facet is non-zero) ──────
  if (!summary) return null
  const hasIssue =
    summary.serversDown > 0 ||
    summary.failedJobs5m > 0 ||
    summary.slowJobs5m > 0 ||
    summary.servicesInMaintenance > 0
  if (!hasIssue) return null

  // Red when something is hard-broken (servers offline or recent failures);
  // amber when it's a softer signal (slow jobs or planned maintenance only).
  const hard = summary.serversDown > 0 || summary.failedJobs5m > 0
  const tone = hard ? 'var(--bad)' : 'var(--warn)'

  const chunks: { label: string; onClick: () => void; key: string }[] = []
  if (summary.serversDown > 0) {
    const n = summary.serversDown
    chunks.push({
      key: 'serversDown',
      label: `${n} server${n === 1 ? '' : 's'} down`,
      onClick: () => navigate('/servers'),
    })
  }
  if (summary.failedJobs5m > 0) {
    const n = summary.failedJobs5m
    chunks.push({
      key: 'failedJobs5m',
      label: `${n} failed job${n === 1 ? '' : 's'} in last 5m`,
      onClick: () => navigate('/doctor?tab=failures'),
    })
  }
  if (summary.slowJobs5m > 0) {
    const n = summary.slowJobs5m
    chunks.push({
      key: 'slowJobs5m',
      label: `${n} job${n === 1 ? '' : 's'} slow`,
      onClick: () => navigate('/jobs?tab=live'),
    })
  }
  if (summary.servicesInMaintenance > 0) {
    const n = summary.servicesInMaintenance
    chunks.push({
      key: 'maintenance',
      label: `${n} service${n === 1 ? '' : 's'} in maintenance`,
      onClick: () => navigate('/services'),
    })
  }

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
        background: tone,
        boxShadow: '0 2px 10px rgba(0,0,0,.25)',
        flexWrap: 'wrap',
      }}
    >
      <AlertTriangle size={14} />
      {chunks.map((chunk, i) => (
        <span key={chunk.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {i > 0 && <span style={{ opacity: 0.55 }}>·</span>}
          <button
            type="button"
            onClick={chunk.onClick}
            title={`Open the filtered view for: ${chunk.label}`}
            style={{
              background: 'transparent',
              border: 0,
              color: 'inherit',
              font: 'inherit',
              padding: 0,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {chunk.label}
          </button>
        </span>
      ))}
    </div>
  )
}
