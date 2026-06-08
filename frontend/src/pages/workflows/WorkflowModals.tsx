import { useState, useEffect, useRef, useMemo } from 'react'
import { Play, X, Shield, Stethoscope } from 'lucide-react'
import { api } from '../../lib/api'
import { loadSession } from '../../lib/storage'
import type { Workflow } from '../../types'

/* ─── Shared helpers ─────────────────────────────────────────── */
function fmtClock(ts: number) {
  const d = new Date(ts)
  return (
    [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':') +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0').slice(0, 2)
  )
}

/* ─── StatusGlyph ────────────────────────────────────────────── */
function StatusGlyph({ status }: { status: string }) {
  const box: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
  }
  if (status === 'pass')
    return (
      <span style={{ ...box, background: 'var(--good)', color: 'white', fontSize: 11 }}>✓</span>
    )
  if (status === 'fail')
    return <span style={{ ...box, background: 'var(--bad)', color: 'white', fontSize: 11 }}>✗</span>
  if (status === 'running')
    return (
      <span
        style={{
          ...box,
          border: '2px solid var(--accent)',
          borderTopColor: 'transparent',
          animation: 'wm-spin .8s linear infinite',
        }}
      />
    )
  if (status === 'stopped')
    return (
      <span
        style={{ ...box, background: 'var(--warn)', color: 'white', fontSize: 10, fontWeight: 700 }}
      >
        !
      </span>
    )
  if (status === 'skipped')
    return (
      <span style={{ ...box, background: 'var(--line)', color: 'var(--ink-3)', fontSize: 10 }}>
        –
      </span>
    )
  return <span style={{ ...box, border: '1.5px dashed var(--line)' }} />
}

/* ─── SubTab ─────────────────────────────────────────────────── */
function SubTab({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="row"
      style={{
        appearance: 'none',
        border: 0,
        background: 'transparent',
        padding: '10px 12px',
        fontSize: 12,
        fontWeight: 500,
        gap: 6,
        color: active ? 'var(--ink)' : 'var(--ink-3)',
        borderBottom: '2px solid ' + (active ? 'var(--accent)' : 'transparent'),
        marginBottom: -1,
        cursor: 'default',
      }}
    >
      {children}
    </button>
  )
}

/* ─── InfoRow ─────────────────────────────────────────────────── */
function InfoRow({
  label,
  children,
  first,
}: {
  label: string
  children: React.ReactNode
  first?: boolean
}) {
  return (
    <div
      className="row"
      style={{
        padding: '10px 14px',
        gap: 12,
        alignItems: 'center',
        borderTop: first ? 0 : '1px solid var(--line)',
        background: 'var(--surface)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          width: 70,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--ink)' }}>{children}</span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TEST WORKFLOW MODAL
   ═══════════════════════════════════════════════════════════════ */

type LiveNode = {
  id: string
  name: string // class_type
  status: 'queued' | 'running' | 'pass' | 'fail' | 'stopped' | 'skipped'
  duration: number | null
}
type LogLine = { t: number; level: 'info' | 'debug' | 'warn' | 'error'; msg: string }

const LOG_COLORS: Record<string, string> = {
  info: '#d6d2c4',
  debug: '#8a8674',
  warn: '#f4c97a',
  error: '#f48b8b',
}
const NODE_STATUS_META: Record<string, { color: string; bg: string; label: string }> = {
  queued: { color: 'var(--ink-3)', bg: 'var(--surface-2)', label: 'queued' },
  running: { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'running' },
  pass: {
    color: 'var(--good)',
    bg: 'color-mix(in oklab, var(--good) 14%, var(--surface))',
    label: 'passed',
  },
  fail: {
    color: 'var(--bad)',
    bg: 'color-mix(in oklab, var(--bad) 14%, var(--surface))',
    label: 'failed',
  },
  stopped: {
    color: 'var(--warn)',
    bg: 'color-mix(in oklab, var(--warn) 14%, var(--surface))',
    label: 'stopped',
  },
  skipped: { color: 'var(--ink-3)', bg: 'var(--surface-2)', label: 'skipped' },
}

function NodeRow({ n, active }: { n: LiveNode; active: boolean }) {
  const s = NODE_STATUS_META[n.status] ?? NODE_STATUS_META['queued']
  return (
    <div
      className="row"
      style={{
        gap: 12,
        padding: '10px 18px',
        borderBottom: '1px solid var(--line)',
        background: active
          ? 'color-mix(in oklab, var(--accent) 6%, var(--surface))'
          : 'transparent',
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink-3)',
          width: 28,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        #{n.id}
      </span>
      <StatusGlyph status={n.status} />
      <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{n.name}</span>
      {n.duration != null && (
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {(n.duration / 1000).toFixed(2)}s
        </span>
      )}
      <span className="chip" style={{ background: s.bg, color: s.color, fontWeight: 600 }}>
        {s.label}
      </span>
    </div>
  )
}

export function TestWorkflowModal({ wf, onClose }: { wf: Workflow; onClose: () => void }) {
  // Workflow nodes loaded from the workflow.json file
  const [wfNodes, setWfNodes] = useState<{ id: string; name: string }[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Execution state
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [subtab, setSubtab] = useState<'nodes' | 'logs'>('nodes')
  const [nodes, setNodes] = useState<LiveNode[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [serverUrl, setServerUrl] = useState<string>(wf.serverUrls[0] ?? '')

  const abortRef = useRef<AbortController | null>(null)
  const logsRef = useRef<HTMLDivElement>(null)
  const nodeTimers = useRef<Record<string, number>>({})

  // Load real node list from the workflow JSON file on mount
  useEffect(() => {
    api
      .get<Record<string, { class_type: string }>>(`/api/workflows/${wf.id}/files/workflow`)
      .then((json) => {
        const entries = Object.entries(json)
          .filter(([, n]) => n && n.class_type)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([id, n]) => ({ id, name: n.class_type }))
        setWfNodes(entries)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load workflow'
        // The backend returns 404 with `{ error: 'Workflow file not found', ... }`
        // when there's no ComfyUI JSON (script-type workflows).
        setLoadErr(
          /not found/i.test(msg)
            ? 'No workflow file found. This may be a script-type workflow.'
            : msg,
        )
      })
  }, [wf.id])

  // Elapsed timer while running
  useEffect(() => {
    if (phase !== 'running') return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - t0), 100)
    return () => clearInterval(id)
  }, [phase])

  // Auto-scroll logs
  useEffect(() => {
    if (subtab === 'logs' && logsRef.current)
      logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs, subtab])

  const pushLog = (level: LogLine['level'], msg: string) =>
    setLogs((L) => [...L, { t: Date.now(), level, msg }])

  const start = async () => {
    if (!wfNodes) return
    const capturedNodes = wfNodes

    setPhase('running')
    setNodes(capturedNodes.map((n) => ({ ...n, status: 'queued', duration: null })))
    setLogs([])
    setActiveId(null)
    nodeTimers.current = {}

    const ac = new AbortController()
    abortRef.current = ac

    try {
      // Streaming NDJSON — can't use api.post (which parses JSON eagerly).
      // We still need the Bearer token though, otherwise requireAuth 401s us.
      const session = loadSession()
      const qs = serverUrl ? `?server=${encodeURIComponent(serverUrl)}` : ''
      const res = await fetch(`/api/workflows/${wf.id}/test${qs}`, {
        method: 'POST',
        signal: ac.signal,
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        pushLog('error', err.error ?? `Server error ${res.status}`)
        setPhase('done')
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let finished = false

      const handleEv = (ev: Record<string, unknown>) => {
        switch (ev['event'] as string) {
          case 'status':
            pushLog('info', ev['message'] as string)
            break
          case 'submitted':
            pushLog('info', `Submitted — prompt ${ev['promptId']}`)
            break
          case 'connected':
            pushLog('info', 'WebSocket connected, waiting for execution…')
            break
          case 'executing': {
            const nid = ev['node'] as string
            setActiveId(nid)
            nodeTimers.current[nid] = Date.now()
            setNodes((curr) => curr.map((n) => (n.id === nid ? { ...n, status: 'running' } : n)))
            const name = capturedNodes.find((n) => n.id === nid)?.name ?? nid
            pushLog('info', `► #${nid} ${name}`)
            break
          }
          case 'executed': {
            const nid = ev['node'] as string
            const dur =
              nodeTimers.current[nid] != null ? Date.now() - nodeTimers.current[nid] : null
            setNodes((curr) =>
              curr.map((n) => (n.id === nid ? { ...n, status: 'pass', duration: dur } : n)),
            )
            const name = capturedNodes.find((n) => n.id === nid)?.name ?? nid
            pushLog(
              'info',
              `  ✓ ${name}${dur != null ? ' · ' + (dur / 1000).toFixed(2) + 's' : ''}`,
            )
            break
          }
          case 'progress':
            // node-level progress — could update a progress bar, skip for now
            break
          case 'done':
            setActiveId(null)
            if (ev['success']) {
              pushLog('info', 'All nodes passed. Workflow OK.')
            } else {
              const failId = ev['nodeId'] as string | undefined
              if (failId) {
                setNodes((curr) =>
                  curr.map((n) =>
                    n.id === failId
                      ? { ...n, status: 'fail' }
                      : n.status === 'queued'
                        ? { ...n, status: 'skipped' }
                        : n,
                  ),
                )
              }
              pushLog('error', `Test failed: ${ev['error'] ?? 'unknown error'}`)
            }
            finished = true
            setPhase('done')
            break
          case 'error':
            pushLog('error', ev['message'] as string)
            finished = true
            setPhase('done')
            break
        }
      }

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handleEv(JSON.parse(line) as Record<string, unknown>)
          } catch {}
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        pushLog('error', err instanceof Error ? err.message : 'Connection error')
      }
      setPhase('done')
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setNodes((curr) =>
      curr.map((n) =>
        n.status === 'running'
          ? { ...n, status: 'stopped' }
          : n.status === 'queued'
            ? { ...n, status: 'skipped' }
            : n,
      ),
    )
    setActiveId(null)
    pushLog('warn', '✋ Stopped by user.')
    setPhase('done')
  }

  const reset = () => {
    setPhase('setup')
    setNodes([])
    setLogs([])
    setElapsed(0)
    setActiveId(null)
  }

  const summary = useMemo(() => {
    const c: Record<string, number> = {}
    nodes.forEach((n) => {
      c[n.status] = (c[n.status] ?? 0) + 1
    })
    return c
  }, [nodes])

  const blockClose = phase === 'running'

  return (
    <div className="modal-stage" onClick={blockClose ? undefined : onClose}>
      <style>{`@keyframes wm-pulse{0%,100%{opacity:1}50%{opacity:.35}} @keyframes wm-spin{to{transform:rotate(360deg)}}`}</style>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 92vw)' }}
      >
        {/* Head */}
        <div className="modal-head">
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
              color: 'white',
            }}
          >
            <Stethoscope size={14} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
              Test workflow
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {wf.name}
            </div>
          </div>
          <span className="spacer" />
          {phase === 'running' && (
            <span
              className="chip"
              style={{
                background: 'color-mix(in oklab, var(--accent) 12%, var(--surface))',
                color: 'var(--accent-ink)',
              }}
            >
              <span
                className="dot"
                style={{ background: 'var(--accent)', animation: 'wm-pulse 1.2s infinite' }}
              />
              Running · {(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          {phase === 'done' && (
            <span
              className={`chip ${(summary['fail'] ?? 0) > 0 || (summary['stopped'] ?? 0) > 0 ? 'chip-bad' : 'chip-good'}`}
            >
              {(summary['fail'] ?? 0) > 0 || (summary['stopped'] ?? 0) > 0
                ? '✗ failed'
                : '✓ passed'}
            </span>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            disabled={blockClose}
            style={{ opacity: blockClose ? 0.3 : 1 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Setup phase */}
        {phase === 'setup' && (
          <>
            <div className="modal-body col" style={{ gap: 14 }}>
              {loadErr ? (
                <div
                  style={{
                    padding: '16px',
                    background: 'color-mix(in oklab, var(--bad) 10%, var(--surface))',
                    borderRadius: 8,
                    color: 'var(--bad)',
                    fontSize: 13,
                  }}
                >
                  {loadErr}
                </div>
              ) : !wfNodes ? (
                <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading workflow…</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                    Dry-run this workflow against its assigned worker to verify every node executes
                    successfully. No artifacts are persisted.
                  </div>
                  <div
                    style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}
                  >
                    <InfoRow label="Server" first>
                      {wf.serverUrls.length > 1 ? (
                        <select
                          className="input mono"
                          value={serverUrl}
                          onChange={(e) => setServerUrl(e.target.value)}
                          style={{ height: 28, fontSize: 12, maxWidth: '100%' }}
                        >
                          {wf.serverUrls.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="mono" style={{ fontSize: 12 }}>
                          {serverUrl || 'No server configured'}
                        </span>
                      )}
                    </InfoRow>
                    <InfoRow label="Nodes">
                      <span style={{ fontSize: 12 }}>
                        <strong>{wfNodes.length}</strong> nodes will be exercised
                      </span>
                    </InfoRow>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {wf.serverUrls.length > 1
                      ? 'This workflow has several servers — pick which one to test against.'
                      : 'Server is set by the workflow configuration. Edit it on the Config tab.'}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
                onClick={start}
                disabled={!wfNodes || !!loadErr}
              >
                <Play size={11} /> Start test
              </button>
            </div>
          </>
        )}

        {/* Running / done */}
        {phase !== 'setup' && (
          <>
            <div
              style={{
                padding: '8px var(--pad)',
                borderBottom: '1px solid var(--line)',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                background: 'var(--surface-2)',
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                {serverUrl || 'unknown'}
              </span>
              <span className="spacer" />
              <div className="row" style={{ gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
                {(summary['pass'] ?? 0) > 0 && (
                  <span>
                    <b style={{ color: 'var(--good)' }}>{summary['pass']}</b> passed
                  </span>
                )}
                {(summary['fail'] ?? 0) > 0 && (
                  <span>
                    <b style={{ color: 'var(--bad)' }}>{summary['fail']}</b> failed
                  </span>
                )}
                {(summary['stopped'] ?? 0) > 0 && (
                  <span>
                    <b style={{ color: 'var(--warn)' }}>{summary['stopped']}</b> stopped
                  </span>
                )}
                {(summary['skipped'] ?? 0) > 0 && (
                  <span>
                    <b>{summary['skipped']}</b> skipped
                  </span>
                )}
                {(summary['running'] ?? 0) > 0 && (
                  <span>
                    <b style={{ color: 'var(--accent)' }}>{summary['running']}</b> running
                  </span>
                )}
                {(summary['queued'] ?? 0) > 0 && (
                  <span>
                    <b>{summary['queued']}</b> queued
                  </span>
                )}
              </div>
            </div>
            <div
              style={{
                borderBottom: '1px solid var(--line)',
                display: 'flex',
                padding: '0 var(--pad)',
              }}
            >
              <SubTab active={subtab === 'nodes'} onClick={() => setSubtab('nodes')}>
                Nodes <span className="pill">{nodes.length}</span>
              </SubTab>
              <SubTab active={subtab === 'logs'} onClick={() => setSubtab('logs')}>
                Logs <span className="pill">{logs.length}</span>
              </SubTab>
            </div>
            <div
              className="modal-body"
              style={{ padding: 0, background: subtab === 'logs' ? '#15140f' : 'var(--surface)' }}
            >
              {subtab === 'nodes' && (
                <div style={{ padding: '6px 0' }}>
                  {nodes.map((n) => (
                    <NodeRow key={n.id} n={n} active={n.id === activeId} />
                  ))}
                </div>
              )}
              {subtab === 'logs' && (
                <div
                  ref={logsRef}
                  className="mono"
                  style={{
                    padding: '10px 14px',
                    color: '#d6d2c4',
                    fontSize: 12,
                    lineHeight: 1.55,
                    maxHeight: 360,
                    overflowY: 'auto',
                  }}
                >
                  {logs.length === 0 && <div style={{ color: '#6b6657' }}>Awaiting output…</div>}
                  {logs.map((l, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10 }}>
                      <span style={{ color: '#6b6657', flexShrink: 0 }}>{fmtClock(l.t)}</span>
                      <span
                        style={{ color: LOG_COLORS[l.level] ?? '#d6d2c4', whiteSpace: 'pre-wrap' }}
                      >
                        {l.msg}
                      </span>
                    </div>
                  ))}
                  {phase === 'running' && <div style={{ color: 'var(--accent)' }}>▌</div>}
                </div>
              )}
            </div>
            <div className="modal-foot">
              {phase === 'running' ? (
                <>
                  <span className="spacer" />
                  <button
                    className="btn"
                    style={{ background: 'var(--bad)', color: 'white', borderColor: 'var(--bad)' }}
                    onClick={stop}
                  >
                    <X size={11} /> Stop run
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={reset}>
                    Back
                  </button>
                  <span className="spacer" />
                  <button className="btn" onClick={onClose}>
                    Close
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
                    onClick={start}
                  >
                    Run again
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   AUDIT DEPENDENCIES MODAL
   ═══════════════════════════════════════════════════════════════ */

type AuditStatus = 'idle' | 'checking' | 'ok' | 'missing' | 'outdated'
type AuditItem = {
  id: string
  name: string
  type?: string
  size?: string
  ver?: string
  repo?: string
  status: AuditStatus
}

type AuditResponse = {
  serverName: string
  serverUrl: string
  nodes: Array<{ classType: string; status: 'ok' | 'missing' }>
  models: Array<{
    nodeId: string
    classType: string
    inputName: string
    value: string
    status: 'ok' | 'missing'
  }>
}

const AUDIT_STATUS_META: Record<string, { color: string; bg: string; label: string }> = {
  idle: { color: 'var(--ink-3)', bg: 'var(--surface-2)', label: 'not checked' },
  checking: { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'checking' },
  ok: {
    color: 'var(--good)',
    bg: 'color-mix(in oklab, var(--good) 14%, var(--surface))',
    label: 'ok',
  },
  missing: {
    color: 'var(--bad)',
    bg: 'color-mix(in oklab, var(--bad) 14%, var(--surface))',
    label: 'missing',
  },
  outdated: {
    color: 'var(--warn)',
    bg: 'color-mix(in oklab, var(--warn) 14%, var(--surface))',
    label: 'outdated',
  },
}
const TYPE_COLORS: Record<string, string> = {
  checkpoint: 'var(--pop-purple)',
  vae: 'var(--pop-cyan)',
  lora: 'var(--pop-pink)',
  upscaler: 'var(--good)',
  depth: 'var(--info)',
  clip: 'var(--accent)',
  controlnet: 'var(--pop-yellow)',
  image: 'var(--pop-purple)',
  mask: 'var(--pop-pink)',
  text: 'var(--ink-2)',
  config: 'var(--ink-3)',
  folder: 'var(--warn)',
}

function AuditTabBtn({
  id,
  active,
  setTab,
  list,
  label,
  count,
}: {
  id: string
  active: string
  setTab: (id: string) => void
  list: AuditItem[]
  label: string
  count: number
}) {
  const t: Record<string, number> = {}
  list.forEach((x) => {
    t[x.status] = (t[x.status] ?? 0) + 1
  })
  const dot = t['missing']
    ? 'var(--bad)'
    : t['outdated']
      ? 'var(--warn)'
      : t['checking']
        ? 'var(--accent)'
        : (t['ok'] ?? 0) > 0
          ? 'var(--good)'
          : null
  return (
    <button
      onClick={() => setTab(id)}
      className="row"
      style={{
        appearance: 'none',
        border: 0,
        background: 'transparent',
        padding: '10px 12px',
        fontSize: 13,
        fontWeight: 500,
        gap: 8,
        color: active === id ? 'var(--ink)' : 'var(--ink-3)',
        borderBottom: '2px solid ' + (active === id ? 'var(--accent)' : 'transparent'),
        marginBottom: -1,
        cursor: 'default',
      }}
    >
      {dot && (
        <span
          className="dot"
          style={{ background: dot, animation: t['checking'] ? 'wm-pulse 1.2s infinite' : 'none' }}
        />
      )}
      {label}
      <span className="pill">{count}</span>
    </button>
  )
}

function AuditRow({ kind, it }: { kind: string; it: AuditItem }) {
  const s = AUDIT_STATUS_META[it.status] ?? AUDIT_STATUS_META['idle']
  const tColor = TYPE_COLORS[it.type ?? ''] ?? 'var(--ink-3)'
  const glyphStatus =
    it.status === 'checking'
      ? 'running'
      : it.status === 'ok'
        ? 'pass'
        : it.status === 'missing'
          ? 'fail'
          : it.status === 'outdated'
            ? 'stopped'
            : 'queued'
  return (
    <div
      className="row"
      style={{
        gap: 12,
        padding: '10px 18px',
        borderBottom: '1px solid var(--line)',
        background:
          it.status === 'checking'
            ? 'color-mix(in oklab, var(--accent) 5%, var(--surface))'
            : 'transparent',
      }}
    >
      <StatusGlyph status={glyphStatus} />
      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <div
          className="mono"
          style={{
            fontSize: 12.5,
            color: 'var(--ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {it.name}
        </div>
        <div className="row" style={{ gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
          {kind === 'nodes' && it.ver && it.repo && (
            <>
              <span>v{it.ver}</span>
              <span>·</span>
              <span className="mono">{it.repo}</span>
            </>
          )}
          {kind === 'models' && it.type && (
            <>
              <span
                className="chip"
                style={{
                  background: `color-mix(in oklab, ${tColor} 14%, var(--surface))`,
                  color: tColor,
                  fontWeight: 600,
                }}
              >
                {it.type}
              </span>
              {it.size && (
                <>
                  <span>·</span>
                  <span className="mono">{it.size}</span>
                </>
              )}
            </>
          )}
          {it.status === 'missing' && (
            <span style={{ color: 'var(--bad)' }}>not found on server</span>
          )}
          {it.status === 'outdated' && (
            <span style={{ color: 'var(--warn)' }}>server has older version</span>
          )}
        </div>
      </div>
      <span className="chip" style={{ background: s.bg, color: s.color, fontWeight: 600 }}>
        {s.label}
      </span>
    </div>
  )
}

export function AuditDependenciesModal({ wf, onClose }: { wf: Workflow; onClose: () => void }) {
  const [nodes, setNodes] = useState<AuditItem[]>([])
  const [models, setModels] = useState<AuditItem[]>([])
  const [tab, setTab] = useState('nodes')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [auditErr, setAuditErr] = useState<string | null>(null)
  const [serverUrl, setServerUrl] = useState<string>(wf.serverUrls[0] ?? '')

  useEffect(() => {
    if (phase !== 'running') return
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - t0), 100)
    return () => clearInterval(id)
  }, [phase])

  const runAudit = async () => {
    setPhase('running')
    setAuditErr(null)
    setElapsed(0)

    try {
      const qs = serverUrl ? `?server=${encodeURIComponent(serverUrl)}` : ''
      const data = await api.post<AuditResponse>(`/api/workflows/${wf.id}/audit${qs}`, {})

      setNodes(
        data.nodes.map((n, i) => ({
          id: 'cn-' + (i + 1),
          name: n.classType,
          status: n.status,
        })),
      )

      setModels(
        data.models.map((m, i) => ({
          id: 'm-' + (i + 1),
          name: m.value,
          type: m.inputName,
          size: '—',
          status: m.status,
        })),
      )

      setPhase('done')
    } catch (err) {
      setAuditErr(err instanceof Error ? err.message : 'Network error')
      setPhase('idle')
    }
  }

  const lists: Record<string, AuditItem[]> = { nodes, models }
  const active = lists[tab] ?? []

  const grand = useMemo(() => {
    const c: Record<string, number> = {}
    ;[...nodes, ...models].forEach((x) => {
      c[x.status] = (c[x.status] ?? 0) + 1
    })
    return c
  }, [nodes, models])

  const blockClose = phase === 'running'

  return (
    <div className="modal-stage" onClick={blockClose ? undefined : onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(820px, 94vw)' }}
      >
        {/* Head */}
        <div className="modal-head">
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
              color: 'white',
            }}
          >
            <Shield size={14} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
              Audit dependencies
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {wf.name}
            </div>
          </div>
          <span className="spacer" />
          {phase === 'running' && (
            <span
              className="chip"
              style={{
                background: 'color-mix(in oklab, var(--accent) 12%, var(--surface))',
                color: 'var(--accent-ink)',
              }}
            >
              <span
                className="dot"
                style={{ background: 'var(--accent)', animation: 'wm-pulse 1.2s infinite' }}
              />
              Auditing · {(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          {phase === 'done' && (
            <span
              className={`chip ${grand['missing'] ? 'chip-bad' : grand['outdated'] ? 'chip-warn' : 'chip-good'}`}
            >
              {grand['missing']
                ? `✗ ${grand['missing']} missing`
                : grand['outdated']
                  ? `⚑ ${grand['outdated']} outdated`
                  : '✓ all dependencies OK'}
            </span>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            disabled={blockClose}
            style={{ opacity: blockClose ? 0.3 : 1 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Server bar */}
        <div
          style={{
            padding: '8px var(--pad)',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            background: 'var(--surface-2)',
          }}
        >
          {wf.serverUrls.length > 1 ? (
            <select
              className="input mono"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={phase === 'running'}
              style={{ height: 26, fontSize: 11 }}
            >
              {wf.serverUrls.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
              {serverUrl || 'No server configured'}
            </span>
          )}
          <span className="spacer" />
          {phase !== 'idle' && (
            <div className="row" style={{ gap: 10, fontSize: 11, color: 'var(--ink-3)' }}>
              {(grand['ok'] ?? 0) > 0 && (
                <span>
                  <b style={{ color: 'var(--good)' }}>{grand['ok']}</b> ok
                </span>
              )}
              {(grand['missing'] ?? 0) > 0 && (
                <span>
                  <b style={{ color: 'var(--bad)' }}>{grand['missing']}</b> missing
                </span>
              )}
              {(grand['checking'] ?? 0) > 0 && (
                <span>
                  <b style={{ color: 'var(--accent)' }}>{grand['checking']}</b> checking
                </span>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div
          style={{
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            padding: '0 var(--pad)',
          }}
        >
          <AuditTabBtn
            id="nodes"
            active={tab}
            setTab={setTab}
            list={nodes}
            label="Nodes"
            count={nodes.length}
          />
          <AuditTabBtn
            id="models"
            active={tab}
            setTab={setTab}
            list={models}
            label="Models"
            count={models.length}
          />
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: 0, maxHeight: 420 }}>
          {phase === 'idle' && nodes.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              {auditErr ? (
                <span style={{ color: 'var(--bad)' }}>{auditErr}</span>
              ) : (
                'Click "Audit" to check dependencies against the server.'
              )}
            </div>
          ) : phase === 'running' ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              Querying server…
            </div>
          ) : active.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              No {tab} found in this workflow.
            </div>
          ) : (
            active.map((it) => <AuditRow key={it.id} kind={tab} it={it} />)
          )}
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <button
            className="btn"
            onClick={onClose}
            disabled={blockClose}
            style={{ opacity: blockClose ? 0.3 : 1 }}
          >
            Close
          </button>
          <span className="spacer" />
          <button
            className="btn btn-primary"
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
            onClick={runAudit}
            disabled={phase === 'running'}
          >
            <Shield size={11} /> {phase === 'done' ? 'Re-audit' : 'Audit'}
          </button>
        </div>
      </div>
    </div>
  )
}
