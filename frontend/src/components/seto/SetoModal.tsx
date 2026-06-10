import { useEffect, useState } from 'react'
import {
  Bot,
  X,
  AlertTriangle,
  Info,
  AlertCircle,
  Check,
  Send,
  Monitor,
  KeyRound,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationsContext'
import { setoCodeInfo } from './setoCodes'

/* ────────────────────────────────────────────────────────────────────
 * SetoModal — the "Ask Seto" overlay. Runs the backend rule set and
 * renders findings. For job kinds (live-job / history-job) a "Report
 * Issue" section at the bottom lets the user send all findings plus a
 * freeform message to Discord in one shot.
 * ──────────────────────────────────────────────────────────────────── */

export type SetoKind = 'live-job' | 'history-job' | 'service' | 'server' | 'error' | 'workflow'

type Finding = {
  code: string
  severity: 'info' | 'warn' | 'bad'
  title: string
  body: string
}

type CheckResponse = {
  greeting: string
  findings: Finding[]
}

const SEVERITY_STYLE: Record<
  Finding['severity'],
  { color: string; bg: string; icon: typeof Info }
> = {
  info: {
    color: 'var(--info)',
    bg: 'color-mix(in oklab, var(--info) 10%, transparent)',
    icon: Info,
  },
  warn: {
    color: 'var(--warn)',
    bg: 'color-mix(in oklab, var(--warn) 12%, transparent)',
    icon: AlertTriangle,
  },
  bad: {
    color: 'var(--bad)',
    bg: 'color-mix(in oklab, var(--bad) 12%, transparent)',
    icon: AlertCircle,
  },
}

const SUBJECT: Record<SetoKind, string> = {
  'live-job': 'this running job',
  'history-job': 'this past run',
  service: 'this service',
  server: 'this server',
  error: 'this error type',
  workflow: 'this workflow',
}

export function SetoModal({
  kind,
  id,
  label,
  server,
  onClose,
}: {
  kind: SetoKind
  id: string
  /** Optional short label, e.g. the job name or server hostname. */
  label?: string
  /** Server label for the Discord report (job kinds only). */
  server?: string | null
  onClose: () => void
}) {
  const { notify } = useNotifications()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin ?? false
  const [data, setData] = useState<CheckResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [reported, setReported] = useState(false)

  const isJobKind = kind === 'live-job' || kind === 'history-job'
  const isServerKind = kind === 'server' || kind === 'service'

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .post<CheckResponse>('/api/seto/check', { kind, id })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Seto could not complete the check.'))
      .finally(() => setLoading(false))
  }, [kind, id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function sendReport() {
    setSending(true)
    try {
      await api.post(`/api/jobs/${id}/report`, {
        message: message.trim(),
        server: server ?? null,
        findings: data?.findings ?? [],
      })
      notify({ variant: 'success', title: 'Issue reported', autoDismiss: 4000 })
      setReported(true)
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Failed to send report',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          borderRadius: 14,
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          cursor: 'default',
        }}
      >
        {/* Persona header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '18px 20px',
            borderBottom: '1px solid var(--line)',
            background:
              'linear-gradient(135deg, color-mix(in oklab, var(--accent) 9%, transparent), transparent)',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'color-mix(in oklab, var(--accent) 22%, var(--surface))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--accent)',
              border: '1px solid color-mix(in oklab, var(--accent) 35%, transparent)',
            }}
          >
            <Bot size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>
              Seto · the in-app doc
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--ink-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Looking at {SUBJECT[kind]}
              {label ? ` · ${label}` : ''}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            title="Close (Esc)"
            style={{ flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 24, fontSize: 13 }}>
              Seto is taking a look…
            </div>
          ) : error ? (
            <div className="alert alert-error" style={{ fontSize: 13 }}>
              {error}
            </div>
          ) : data ? (
            <>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  marginBottom: 14,
                  color: 'var(--ink-2)',
                  fontStyle: 'italic',
                }}
              >
                {data.greeting}
              </div>

              {data.findings.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '14px 16px',
                    borderRadius: 10,
                    background: 'color-mix(in oklab, var(--good) 10%, transparent)',
                    border: '1px solid color-mix(in oklab, var(--good) 30%, transparent)',
                    color: 'var(--good)',
                  }}
                >
                  <Check size={18} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Everything is running fine.</span>
                </div>
              ) : (
                <div className="col" style={{ gap: 10 }}>
                  {data.findings.map((f, i) => {
                    const st = SEVERITY_STYLE[f.severity]
                    const Icon = st.icon
                    return (
                      <div
                        key={`${f.code}-${i}`}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          padding: '12px 14px',
                          borderRadius: 10,
                          background: st.bg,
                          border: `1px solid color-mix(in oklab, ${st.color} 30%, transparent)`,
                        }}
                      >
                        <Icon size={16} style={{ color: st.color, flexShrink: 0, marginTop: 1 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: st.color,
                              marginBottom: 3,
                            }}
                          >
                            {f.title}
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                            {f.body}
                          </div>
                          <div
                            title={setoCodeInfo(f.code).description}
                            style={{
                              fontSize: 10,
                              color: 'var(--ink-3)',
                              marginTop: 4,
                              fontFamily: 'var(--font-mono)',
                              cursor: 'help',
                              display: 'inline-block',
                              borderBottom: '1px dotted var(--ink-3)',
                            }}
                          >
                            {f.code}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* RDP section — admin only, server/service kinds. Surfaces
               *  ping + services status as a one-line health badge and
               *  exposes an "RDP In" button when ping is OK and credentials
               *  are linked. The button drives a synchronous server-side
               *  xfreerdp probe (~15s hold); we keep the user posted with a
               *  busy state and an inline result panel. */}
              {isServerKind && isAdmin && <RdpSection serverId={id} />}

              {/* Report section — job kinds only */}
              {isJobKind && (
                <div
                  style={{
                    borderTop: '1px solid var(--line)',
                    marginTop: 16,
                    paddingTop: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--ink-2)',
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Send size={12} style={{ color: 'var(--ink-3)' }} />
                    Report issue to Discord
                  </div>
                  {reported ? (
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: 'color-mix(in oklab, var(--good) 10%, transparent)',
                        border: '1px solid color-mix(in oklab, var(--good) 30%, transparent)',
                        color: 'var(--good)',
                        fontSize: 13,
                      }}
                    >
                      <Check size={14} style={{ flexShrink: 0 }} />
                      Report sent — Seto findings and your message were included.
                    </div>
                  ) : (
                    <>
                      <textarea
                        className="input"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Add context or describe the problem…"
                        style={{
                          width: '100%',
                          minHeight: 80,
                          fontFamily: 'inherit',
                          fontSize: 13,
                          lineHeight: 1.6,
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                      />
                      <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={sendReport}
                          disabled={!message.trim() || sending}
                        >
                          <Send size={12} />
                          {sending ? 'Sending…' : 'Report Issue'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="row" style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            Thresholds adjustable in <strong>Admin → Seto</strong>.
          </span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── RDP section ───────────────────────────────────────────────
 * Admin-only panel rendered inside the SetoModal for server/service kinds.
 * Two API touchpoints:
 *   - GET /api/servers/:id/rdp/status — cheap preflight (ping, services,
 *     credential link). Drives the badge + button state.
 *   - POST /api/servers/:id/rdp/connect — synchronous ~15s call that runs
 *     xfreerdp inside the API container. We block the UI on it because the
 *     hold window is short enough that polling would be busywork.
 * The connect result is rendered inline (ok / not ok + stderr tail) so the
 * admin can copy the failure into a ticket without leaving the modal. */
type RdpStatus = {
  reachable: boolean
  pingOk: boolean
  servicesOk: boolean
  credentialId: string | null
  rdpHost: string | null
}

type RdpConnectResult = {
  ok: boolean
  exitCode: number | null
  signal: string | null
  rdpHost: string
  durationMs: number
  stderrTail: string
}

function RdpSection({ serverId }: { serverId: string }) {
  const [status, setStatus] = useState<RdpStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [result, setResult] = useState<RdpConnectResult | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<RdpStatus>(`/api/servers/${serverId}/rdp/status`)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch((e) => {
        if (!cancelled)
          setStatusError(e instanceof Error ? e.message : 'Could not load RDP status.')
      })
    return () => {
      cancelled = true
    }
  }, [serverId])

  async function connect() {
    setConnecting(true)
    setResult(null)
    setConnectError(null)
    try {
      const r = await api.post<RdpConnectResult>(`/api/servers/${serverId}/rdp/connect`, {})
      setResult(r)
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'RDP connect failed.')
    } finally {
      setConnecting(false)
    }
  }

  const canConnect = !!status && status.pingOk && !!status.credentialId && !connecting

  return (
    <div
      style={{
        borderTop: '1px solid var(--line)',
        marginTop: 16,
        paddingTop: 14,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-2)',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Monitor size={12} style={{ color: 'var(--ink-3)' }} />
        Remote access
      </div>

      {statusError ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--bad)',
            padding: '8px 10px',
            border: '1px solid color-mix(in oklab, var(--bad) 30%, transparent)',
            borderRadius: 8,
            background: 'color-mix(in oklab, var(--bad) 8%, transparent)',
          }}
        >
          {statusError}
        </div>
      ) : !status ? (
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Checking status…</div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 10px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--surface)',
              flexWrap: 'wrap',
              fontSize: 12.5,
            }}
          >
            <StatusPip ok={status.pingOk} label={status.pingOk ? 'Ping OK' : 'Ping down'} />
            <span style={{ color: 'var(--ink-3)' }}>·</span>
            <StatusPip
              ok={status.servicesOk}
              label={status.servicesOk ? 'Services OK' : 'Services degraded'}
            />
            <span style={{ color: 'var(--ink-3)' }}>·</span>
            {status.credentialId ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <KeyRound size={12} style={{ color: 'var(--good)' }} /> Credential linked
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <KeyRound size={12} style={{ color: 'var(--warn)' }} /> No credential
              </span>
            )}
            {status.rdpHost && (
              <>
                <span style={{ color: 'var(--ink-3)' }}>·</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {status.rdpHost}
                </span>
              </>
            )}
            <span className="spacer" />
            <button
              className="btn btn-sm btn-primary"
              onClick={connect}
              disabled={!canConnect}
              title={
                !status.pingOk
                  ? 'Refused: ping is down. Re-check the server first.'
                  : !status.credentialId
                    ? 'Add a credential and link it to this server in /credentials.'
                    : 'Open a virtual RDP session for ~15 seconds to verify the login works.'
              }
            >
              <Monitor size={13} /> {connecting ? 'Connecting…' : 'RDP In'}
            </button>
          </div>

          {connectError && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: 'var(--bad)',
                padding: '8px 10px',
                border: '1px solid color-mix(in oklab, var(--bad) 30%, transparent)',
                borderRadius: 8,
                background: 'color-mix(in oklab, var(--bad) 8%, transparent)',
              }}
            >
              {connectError}
            </div>
          )}

          {result && <RdpResultPanel result={result} />}
        </>
      )}
    </div>
  )
}

function StatusPip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ok ? 'var(--good)' : 'var(--bad)',
        }}
      />
      {label}
    </span>
  )
}

function RdpResultPanel({ result }: { result: RdpConnectResult }) {
  const color = result.ok ? 'var(--good)' : 'var(--bad)'
  const Icon = result.ok ? Check : AlertCircle
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
        borderRadius: 8,
        background: `color-mix(in oklab, ${color} 8%, transparent)`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: 13 }}>
        <Icon size={14} />
        <strong>
          {result.ok
            ? `Connected — session held ${Math.round(result.durationMs / 1000)}s on ${result.rdpHost}`
            : `RDP probe failed (exit ${result.exitCode ?? 'null'} / signal ${result.signal ?? 'none'})`}
        </strong>
      </div>
      {result.stderrTail && (
        <pre
          style={{
            margin: 0,
            padding: '6px 8px',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--ink-2)',
            maxHeight: 160,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {result.stderrTail}
        </pre>
      )}
    </div>
  )
}
