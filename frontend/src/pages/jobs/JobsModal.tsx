import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, X, Download, Square, Bot } from 'lucide-react'
import { api } from '../../lib/api'
import { copyToClipboard } from '../../lib/clipboard'
import { useNotifications } from '../../context/NotificationsContext'
import { SetoModal } from '../../components/seto/SetoModal'
import type { Tone, Row } from './jobs-types'
import { fmtSec, fmtTime } from './jobs-utils'
import {
  fmtAgo,
  classifyError,
  ERROR_CODE_LABEL,
  errorCodeTone,
} from '../analytics/analyticsHelpers'

/* ─── Shared display components ─────────────────────────────────── */
export function JobKindBadge({ kind, size = 22 }: { kind: 'wf' | 'lora'; size?: number }) {
  const color = kind === 'wf' ? 'var(--pop-purple)' : 'var(--accent)'
  return (
    <span
      title={kind === 'wf' ? 'Workflow job' : 'LoRA training job'}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: 6,
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 40%, transparent)`,
        color,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {kind === 'wf' ? 'W' : 'L'}
    </span>
  )
}

export function JobName({ row }: { row: Row }) {
  if (row.arch) {
    return (
      <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
        <strong>{row.name}</strong>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
          · {row.arch}
        </span>
      </div>
    )
  }
  return <strong>{row.name}</strong>
}

/** Slow-job indicator. Renders nothing unless the job's actual duration is
 *  ≥ SLOW_THRESHOLD × the workflow's historical avg. ≥ VERY_SLOW_THRESHOLD
 *  flips it to red. Tooltip surfaces the numbers behind the chip.
 *
 *  Skips failed/aborted jobs — "took 5× the avg" isn't meaningful for a job
 *  that errored 10s in. Compares against elapsed time for running jobs and
 *  totalSec/genSec for completed ones. */
const SLOW_THRESHOLD = 1.5
const VERY_SLOW_THRESHOLD = 2

export function SlowChip({ row, avgSec }: { row: Row; avgSec: number | undefined }) {
  if (!avgSec || avgSec <= 0) return null
  // Don't pass judgment on a run that didn't complete cleanly.
  if (row.status === 'failed' || row.status === 'cancelled') return null

  const running = row.status === 'active' || row.status === 'running'
  const actual = running ? row.elapsedSec : (row.genSec ?? row.totalSec)
  if (actual == null || actual <= 0) return null

  const ratio = actual / avgSec
  if (ratio < SLOW_THRESHOLD) return null

  const veryStrong = ratio >= VERY_SLOW_THRESHOLD
  const tone = veryStrong ? 'bad' : 'warn'
  const label = veryStrong ? 'very slow' : 'slow'
  return (
    <span
      className={`chip chip-${tone}`}
      style={{ fontSize: 10, marginLeft: 6 }}
      title={`actual: ${fmtSec(actual)} · avg: ${fmtSec(avgSec)} (${ratio.toFixed(1)}× avg)`}
    >
      {label}
    </span>
  )
}

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const C = {
    good: {
      bg: 'color-mix(in oklab, var(--good) 14%, transparent)',
      fg: 'var(--good)',
      dot: 'var(--good)',
    },
    bad: {
      bg: 'color-mix(in oklab, var(--bad) 14%, transparent)',
      fg: 'var(--bad)',
      dot: 'var(--bad)',
    },
    warn: {
      bg: 'color-mix(in oklab, var(--warn) 18%, transparent)',
      fg: 'var(--warn)',
      dot: 'var(--warn)',
    },
    info: {
      bg: 'color-mix(in oklab, var(--info) 14%, transparent)',
      fg: 'var(--info)',
      dot: 'var(--info)',
    },
    muted: {
      bg: 'color-mix(in oklab, var(--ink) 7%, transparent)',
      fg: 'var(--ink-2)',
      dot: 'var(--ink-3)',
    },
  }[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        background: C.bg,
        color: C.fg,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.5,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.dot }} />
      {children}
    </span>
  )
}

/* ─── JSON syntax highlighter for the modal Data tab ───────────── */
function JsonHighlight({ text, highlight }: { text: string; highlight: string }) {
  const COLORS: Record<string, string> = {
    key: 'var(--pop-purple)',
    string: 'var(--good)',
    number: 'var(--info)',
    bool: 'var(--warn)',
    null: 'var(--ink-3)',
    punct: 'var(--ink-2)',
  }
  const tokenize = (line: string) => {
    const out: Array<{ t: string; v: string }> = []
    const re =
      /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false)\b|\b(null)\b|([{}[\],])/g
    let i = 0,
      m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      if (m.index > i) out.push({ t: 'raw', v: line.slice(i, m.index) })
      if (m[1] && m[2]) {
        out.push({ t: 'key', v: m[1] })
        out.push({ t: 'punct', v: m[2] })
      } else if (m[1]) out.push({ t: 'string', v: m[1] })
      else if (m[3]) out.push({ t: 'number', v: m[3] })
      else if (m[4]) out.push({ t: 'bool', v: m[4] })
      else if (m[5]) out.push({ t: 'null', v: m[5] })
      else if (m[6]) out.push({ t: 'punct', v: m[6] })
      i = re.lastIndex
    }
    if (i < line.length) out.push({ t: 'raw', v: line.slice(i) })
    return out
  }
  const hl = (str: string, color: string) => {
    if (!highlight) return <span style={{ color }}>{str}</span>
    const idx = str.toLowerCase().indexOf(highlight.toLowerCase())
    if (idx === -1) return <span style={{ color }}>{str}</span>
    return (
      <span style={{ color }}>
        {str.slice(0, idx)}
        <mark
          style={{
            background: 'color-mix(in oklab, var(--warn) 35%, transparent)',
            color: 'inherit',
            padding: '0 1px',
            borderRadius: 2,
          }}
        >
          {str.slice(idx, idx + highlight.length)}
        </mark>
        {str.slice(idx + highlight.length)}
      </span>
    )
  }
  return (
    <>
      {text.split('\n').map((line, li) => (
        <div key={li}>
          {tokenize(line).map((tok, ti) =>
            tok.t === 'raw' ? (
              <span key={ti}>{tok.v}</span>
            ) : (
              <Fragment key={ti}>{hl(tok.v, COLORS[tok.t] ?? 'inherit')}</Fragment>
            ),
          )}
        </div>
      ))}
    </>
  )
}

/* Extract failedReason + stacktrace from the detail response.
 * For WF jobs: redis.failedReason + redis.stacktrace (array). For LoRA: failedReason on the row, no trace. */
function extractStack(
  detail: unknown,
  fallbackReason: string | null,
): {
  reason: string | null
  trace: string[]
} {
  if (!detail || typeof detail !== 'object') return { reason: fallbackReason, trace: [] }
  const d = detail as Record<string, unknown>
  const redis = (d['redis'] ?? null) as Record<string, unknown> | null
  const reason =
    (typeof redis?.['failedReason'] === 'string' ? (redis['failedReason'] as string) : null) ??
    (typeof d['failedReason'] === 'string' ? (d['failedReason'] as string) : null) ??
    fallbackReason
  const raw = redis?.['stacktrace']
  const trace = Array.isArray(raw)
    ? (raw as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return { reason, trace }
}

/* ─── Job detail modal ──────────────────────────────────────────── */
export function JobModal({ row, onClose }: { row: Row; onClose: () => void }) {
  // Failures land directly on the Stacktrace tab — that's the most useful view
  // when triaging a failed job. Everything else opens to Logs.
  const [tab, setTab] = useState<'logs' | 'data' | 'stack'>(
    row.statusTone === 'bad' ? 'stack' : 'logs',
  )
  const [search, setSearch] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [detail, setDetail] = useState<unknown>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [relTime, setRelTime] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [setoOpen, setSetoOpen] = useState(false)
  const { notify } = useNotifications()

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const fetchData = useCallback(() => {
    setLogs([])
    setDetail(null)
    if (row.kind === 'wf') {
      api
        .get<{ logs: string[] }>(`/api/wf-jobs/${row.rawId}/logs`)
        .then((r) => setLogs(r.logs ?? []))
        .catch(() => {})
      api
        .get<unknown>(`/api/wf-jobs/${row.rawId}`)
        .then(setDetail)
        .catch(() => {})
    } else {
      api
        .get<unknown>(`/api/lora-jobs/${row.rawId}`)
        .then(setDetail)
        .catch(() => {})
    }
  }, [row])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Stop button — visible only when this is a WF job that's still running.
  // The backend refuses already-terminal jobs but we hide the affordance
  // anyway so users don't click a doomed action. Terminal states match the
  // set in services/wfJobStop.ts.
  const isStoppable =
    row.kind === 'wf' &&
    row.status !== 'completed' &&
    row.status !== 'failed' &&
    row.status !== 'cancelled'

  const onStop = useCallback(async () => {
    if (!isStoppable || stopping) return
    if (
      !window.confirm(
        `Stop this job?\n\n${row.name}\n\nComfyUI will be told to interrupt the prompt. An audit entry will be added to the job log.`,
      )
    )
      return
    setStopping(true)
    try {
      const res = await api.post<{
        comfyPromptId: string
        state: 'running' | 'pending' | 'unknown'
        confirmedDone: boolean
      }>(`/api/wf-jobs/${row.rawId}/stop`, {})
      notify({
        variant: res.confirmedDone ? 'success' : 'warn',
        title: res.confirmedDone ? 'Job stopped' : 'Stop requested',
        body: res.confirmedDone
          ? `ComfyUI confirmed prompt ${res.comfyPromptId.slice(0, 8)}… is no longer running.`
          : `ComfyUI accepted the cancel for prompt ${res.comfyPromptId.slice(0, 8)}… but did not confirm completion within the wait window. Refresh in a few seconds to verify.`,
      })
      fetchData()
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Stop failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setStopping(false)
    }
  }, [isStoppable, stopping, row.rawId, row.name, notify, fetchData])

  const filteredLogs = useMemo(
    () => (!search ? logs : logs.filter((l) => l.toLowerCase().includes(search.toLowerCase()))),
    [logs, search],
  )

  const dataJson = useMemo(() => (detail ? JSON.stringify(detail, null, 2) : '{}'), [detail])
  const filteredJson = useMemo(
    () =>
      !search
        ? dataJson
        : dataJson
            .split('\n')
            .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
            .join('\n'),
    [dataJson, search],
  )

  const copy = async (kind: 'logs' | 'data' | 'stack', text: string) => {
    // copyToClipboard falls back to execCommand on non-HTTPS contexts
    // (ZeroTier / LAN IPs). The original navigator.clipboard?.writeText path
    // was a silent no-op on insecure origins, so the "Copied" chip would
    // appear but nothing landed in the clipboard.
    const ok = await copyToClipboard(text)
    if (!ok) return
    setCopied(kind)
    setTimeout(() => setCopied(null), 1400)
  }

  const headerName = row.arch ? `${row.name} · ${row.arch}` : row.name
  const statusColor =
    row.statusTone === 'info'
      ? 'var(--accent)'
      : row.statusTone === 'good'
        ? 'var(--good)'
        : row.statusTone === 'bad'
          ? 'var(--bad)'
          : 'var(--ink-3)'

  // The job-list endpoint only sees Postgres values, but the detail fetch
  // also returns the BullMQ hash (`redis`) — which is the ground truth for
  // when the job was queued / picked up / finished. Prefer those when present
  // and fall back to the row (LoRA jobs, evicted Redis entries) otherwise.
  const redis =
    detail &&
    typeof detail === 'object' &&
    'redis' in detail &&
    (detail as { redis: unknown }).redis
      ? (
          detail as {
            redis: { timestamp?: number; processedOn?: number | null; finishedOn?: number | null }
          }
        ).redis
      : null
  const asIso = (ms: number | null | undefined): string | null =>
    typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null
  const createdAt = asIso(redis?.timestamp) ?? row.createdAt
  const processedAt = asIso(redis?.processedOn) ?? row.processedAt
  const finishedAt = asIso(redis?.finishedOn) ?? row.finishedAt
  const execAt = row.execAt // not in the BullMQ hash — lives in liveTracker / Postgres

  const relLabel = (
    from: string | null | undefined,
    to: string | null | undefined,
    fromLabel: string,
  ): string => {
    if (!from || !to) return '—'
    const s = Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000)
    if (s < 0) return '—'
    return `+${fmtSec(s)} from ${fromLabel}`
  }

  // Relative-to-now label for the "Created at" field; the others are framed
  // relative to a previous timestamp in the lifecycle. fmtAgo gives "5h ago",
  // "160d ago", etc. — see lib/format.
  const relSince = (when: string | null | undefined): string => {
    if (!when) return '—'
    return fmtAgo(when)
  }

  const Field = ({
    label,
    children,
    mono,
    onClick,
  }: {
    label: string
    children: React.ReactNode
    mono?: boolean
    onClick?: () => void
  }) => (
    <div className="col" style={{ gap: 2, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          color: 'var(--ink-3)',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        className={mono ? 'mono' : ''}
        onClick={onClick}
        style={{
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(onClick ? { cursor: 'pointer' } : {}),
        }}
      >
        {children}
      </div>
    </div>
  )

  const toggle = () => setRelTime((r) => !r)

  return (
    <div className="modal-stage" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(780px, 94vw)' }}
      >
        <div className="modal-head">
          <JobKindBadge kind={row.kind} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 15 }}>{headerName}</strong>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {row.id}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: statusColor,
                  marginRight: 4,
                }}
              />
              {row.statusLabel} · {row.who} · {row.server ?? '—'}
            </div>
          </div>
          {isStoppable && (
            <button
              className="btn btn-sm"
              onClick={onStop}
              disabled={stopping}
              title="Cancel this job on ComfyUI"
              style={{
                color: 'var(--bad)',
                borderColor: 'color-mix(in oklab, var(--bad) 40%, transparent)',
              }}
            >
              <Square size={12} /> {stopping ? 'Pulling…' : 'Pull the plug'}
            </button>
          )}
          {/* Ask Seto from the modal — gives every job, regardless of entry
              point (Live, History, Slow, By error), a path to Seto without
              needing a separate row menu on each table. */}
          <button
            className="btn btn-sm"
            onClick={() => setSetoOpen(true)}
            title="Ask Seto to analyse this job"
          >
            <Bot size={13} /> Ask Seto
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fetchData} title="Refresh">
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            style={{ width: 28, height: 28 }}
          >
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--line)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
            background: 'var(--surface-2)',
          }}
        >
          <Field label="Type">{row.kind === 'wf' ? 'Workflow' : 'LoRA training'}</Field>
          <Field label="User">{row.who}</Field>
          <Field label="Service" mono>
            {row.server ?? '—'}
          </Field>
          <Field label="Status">
            <span style={{ color: statusColor }}>{row.statusLabel}</span>
          </Field>
          {/* Each timestamp can be toggled between absolute and relative form
           * by clicking. Clicks are disabled when the underlying value is
           * null — otherwise toggling on an empty "Done at" would surface a
           * misleading time pulled from a sibling field. */}
          <Field label="Created at" mono onClick={createdAt ? toggle : undefined}>
            {relTime ? relSince(createdAt) : fmtTime(createdAt)}
          </Field>
          <Field label="Started at" mono onClick={processedAt ? toggle : undefined}>
            {relTime ? relLabel(createdAt, processedAt, 'creation') : fmtTime(processedAt)}
          </Field>
          <Field label="Exec at" mono onClick={row.kind !== 'lora' && execAt ? toggle : undefined}>
            {row.kind === 'lora' ? (
              <span style={{ color: 'var(--ink-3)' }}>N/A</span>
            ) : relTime ? (
              relLabel(processedAt ?? createdAt, execAt, processedAt ? 'started' : 'creation')
            ) : (
              fmtTime(execAt)
            )}
          </Field>
          <Field label="Done at" mono onClick={finishedAt ? toggle : undefined}>
            {relTime
              ? relLabel(
                  execAt ?? processedAt ?? createdAt,
                  finishedAt,
                  execAt ? 'exec' : processedAt ? 'started' : 'creation',
                )
              : fmtTime(finishedAt)}
          </Field>
        </div>

        <CmAuditLogStrip detail={detail} />

        {(() => {
          const { reason, trace } = extractStack(detail, row.failedReason)
          const stackText = [reason ?? '', ...trace].filter(Boolean).join('\n')
          const filteredStack = !search
            ? trace
            : trace.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
          const hasStack = trace.length > 0 || reason
          const copyTarget =
            tab === 'logs' ? filteredLogs.join('\n') : tab === 'data' ? dataJson : stackText
          return (
            <>
              <div
                className="row"
                style={{
                  padding: '10px 18px',
                  borderBottom: '1px solid var(--line)',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <div className="toggle-group">
                  <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
                    Logs <span style={{ opacity: 0.5, marginLeft: 4 }}>{logs.length}</span>
                  </button>
                  <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>
                    Job data
                  </button>
                  <button
                    className={tab === 'stack' ? 'active' : ''}
                    onClick={() => setTab('stack')}
                    title={hasStack ? 'Error and stack trace' : 'No stack trace recorded'}
                    style={{
                      color: hasStack && row.statusTone === 'bad' ? 'var(--bad)' : undefined,
                    }}
                  >
                    Stack trace
                    {trace.length > 0 && (
                      <span style={{ opacity: 0.5, marginLeft: 4 }}>{trace.length}</span>
                    )}
                  </button>
                </div>
                <div className="search" style={{ flex: 1, maxWidth: 320 }}>
                  <span className="search-icon">
                    <Search size={13} />
                  </span>
                  <input
                    className="input"
                    placeholder={
                      tab === 'logs'
                        ? 'Search log lines…'
                        : tab === 'data'
                          ? 'Search JSON…'
                          : 'Search stack frames…'
                    }
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => copy(tab, copyTarget)}>
                  <Download size={12} />{' '}
                  {copied === tab
                    ? 'Copied'
                    : `Copy ${tab === 'logs' ? 'logs' : tab === 'data' ? 'data' : 'stack'}`}
                </button>
              </div>

              <div
                className="modal-body"
                style={{ padding: 0, background: 'var(--surface-2)', minHeight: 180 }}
              >
                {tab === 'logs' && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: 14 }}>
                    {filteredLogs.length === 0 ? (
                      <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
                        {row.kind === 'lora'
                          ? 'No log endpoint for LoRA jobs.'
                          : logs.length === 0
                            ? 'No logs available.'
                            : 'No entries match.'}
                      </div>
                    ) : (
                      filteredLogs.map((l, i) => (
                        <div key={i} style={{ padding: '3px 6px', lineHeight: 1.5 }}>
                          {l}
                        </div>
                      ))
                    )}
                  </div>
                )}
                {tab === 'data' && (
                  <pre
                    style={{
                      margin: 0,
                      padding: 14,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {filteredJson ? (
                      <JsonHighlight text={filteredJson} highlight={search} />
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>No matching lines.</span>
                    )}
                  </pre>
                )}
                {tab === 'stack' && (
                  <div style={{ padding: 14 }}>
                    {!hasStack ? (
                      <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 24 }}>
                        No stack trace recorded for this job.
                      </div>
                    ) : (
                      <>
                        {reason &&
                          (() => {
                            // Plain-English headline + raw technical detail.
                            // Designers reading this don't have to grok stderr
                            // to know what broke; engineers still see the raw
                            // message below for grep / triage.
                            const code = classifyError(reason)
                            const label = ERROR_CODE_LABEL[code] ?? null
                            return (
                              <div style={{ marginBottom: 12 }}>
                                {label && (
                                  <div
                                    className="row"
                                    style={{
                                      gap: 8,
                                      marginBottom: 6,
                                      alignItems: 'center',
                                    }}
                                  >
                                    <span
                                      className={`chip chip-${errorCodeTone(code)}`}
                                      style={{ fontSize: 10 }}
                                    >
                                      {code}
                                    </span>
                                    <strong style={{ fontSize: 13 }}>{label}</strong>
                                  </div>
                                )}
                                <div
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 12.5,
                                    lineHeight: 1.55,
                                    padding: '10px 12px',
                                    borderRadius: 6,
                                    background: 'color-mix(in oklab, var(--bad) 8%, transparent)',
                                    border:
                                      '1px solid color-mix(in oklab, var(--bad) 25%, transparent)',
                                    color: 'var(--bad)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {reason}
                                </div>
                              </div>
                            )
                          })()}
                        {trace.length === 0 ? (
                          <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                            No stack frames — only the error message is available.
                          </div>
                        ) : (
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11.5,
                              lineHeight: 1.55,
                            }}
                          >
                            {filteredStack.length === 0 ? (
                              <div style={{ color: 'var(--ink-3)' }}>No frames match.</div>
                            ) : (
                              filteredStack.map((frame, i) => (
                                <pre
                                  key={i}
                                  style={{
                                    margin: 0,
                                    padding: '4px 8px',
                                    borderLeft:
                                      '2px solid color-mix(in oklab, var(--bad) 35%, transparent)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    background:
                                      i % 2 === 0
                                        ? 'transparent'
                                        : 'color-mix(in oklab, var(--ink) 3%, transparent)',
                                  }}
                                >
                                  {frame}
                                </pre>
                              ))
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-foot">
                <span style={{ fontSize: 11, color: 'var(--ink-3)', marginRight: 'auto' }}>
                  {tab === 'logs'
                    ? `${filteredLogs.length} of ${logs.length} entries`
                    : tab === 'data'
                      ? `${dataJson.split('\n').length} lines`
                      : `${trace.length} stack frames`}
                </span>
                <button className="btn btn-sm" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )
        })()}
      </div>
      {setoOpen && (
        <SetoModal
          kind={row.status === 'active' || row.status === 'running' ? 'live-job' : 'history-job'}
          id={row.rawId}
          label={row.name}
          server={row.server}
          onClose={() => setSetoOpen(false)}
        />
      )}
    </div>
  )
}

/* ─── CM audit-log strip ────────────────────────────────────────
 * Renders a slim banner listing every coffee-maker-originated action on the
 * job — currently just "manual_stop" but the shape supports future actions
 * (retry, requeue) without an API change. Keeps users from having to dig
 * into the raw data tab to see who did what.
 */
type CmAuditEntry = {
  at?: string
  who?: string
  action?: string
  message?: string
  extra?: Record<string, unknown>
}

function CmAuditLogStrip({ detail }: { detail: unknown }) {
  const entries = useMemo<CmAuditEntry[]>(() => {
    if (!detail || typeof detail !== 'object') return []
    const raw = (detail as { cmAuditLog?: unknown }).cmAuditLog
    if (!Array.isArray(raw)) return []
    return raw.filter((e): e is CmAuditEntry => !!e && typeof e === 'object')
  }, [detail])

  if (entries.length === 0) return null

  return (
    <div
      style={{
        padding: '10px 18px',
        borderBottom: '1px solid var(--line)',
        background: 'color-mix(in oklab, var(--accent) 6%, var(--surface))',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: 'var(--ink-3)',
        }}
      >
        Coffee-maker events ({entries.length})
      </div>
      {entries.map((e, i) => (
        <div
          key={i}
          style={{
            fontSize: 12,
            color: 'var(--ink-2)',
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>
            {e.at ? new Date(e.at).toLocaleString() : '—'}
          </span>
          <span>{e.message ?? `${e.action ?? 'event'} by ${e.who ?? 'unknown'}`}</span>
        </div>
      ))}
    </div>
  )
}
