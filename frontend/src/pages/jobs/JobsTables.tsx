import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  MoreVertical,
  User,
  Boxes as ServerIcon,
  Workflow as WorkflowIcon,
  Bot,
  ServerOff,
} from 'lucide-react'
import type { Row } from './jobs-types'
import { fmtSec, fmtCompleted } from './jobs-utils'
import { JobKindBadge, JobName, StatusPill, SlowChip } from './JobsModal'
import { SetoModal } from '../../components/seto/SetoModal'
import { STATUS_TONE, STATUS_LABEL } from '../_shared/serverHelpers'
import type { Page } from '../../types'
import { classifyError, errorCodeTone, ERROR_CODE_LABEL } from '../analytics/analyticsHelpers'

type NavigateFn = (p: Page, path?: string) => void

/* ─── Wait time color ───────────────────────────────────────────── */
function waitColor(sec: number | null | undefined): string | undefined {
  if (sec == null) return undefined
  if (sec >= 1800) return 'var(--bad)'
  if (sec >= 600) return 'color-mix(in oklab, var(--bad) 60%, var(--warn))'
  if (sec >= 300) return 'var(--warn)'
  return undefined
}

/* ─── Row dot menu ──────────────────────────────────────────────
 * Shared by live + history tables. The only difference between them is the
 * Seto modal's `kind` (live-job vs history-job), which the caller passes in.
 * Previously this was forked into two near-identical 100-line components. */
export function JobRowMenu({
  r,
  navigate,
  setoKind = 'live-job',
}: {
  r: Row
  navigate?: NavigateFn
  setoKind?: 'live-job' | 'history-job'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [setoOpen, setSeto] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  const Item = ({
    icon: Icon,
    label,
    onClick,
    danger,
  }: {
    icon: React.ElementType
    label: string
    onClick: () => void
    danger?: boolean
  }) => (
    <button
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        onClick()
      }}
      className="row"
      style={{
        width: '100%',
        padding: '7px 12px',
        background: 'transparent',
        border: 0,
        fontSize: 12,
        color: danger ? 'var(--bad)' : 'var(--ink)',
        cursor: 'default',
        gap: 8,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={13} style={{ color: danger ? 'var(--bad)' : 'var(--ink-3)', flexShrink: 0 }} />
      {label}
    </button>
  )

  return (
    <td style={{ width: 32, padding: '0 4px' }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        className="btn btn-ghost"
        style={{ width: 26, height: 26, padding: 0, border: 0, color: 'var(--ink-3)' }}
        onClick={toggle}
        title="Actions"
      >
        <MoreVertical size={13} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              width: 200,
              zIndex: 9999,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
              fontSize: 12,
            }}
          >
            {/* Only offer "Show user" when we know the user id — without it the
              link is useless (it'd just open the bare list). */}
            {r.who !== '—' && r.clientId && navigate && (
              <Item
                icon={User}
                label={`Show user: ${r.who}`}
                onClick={() => navigate('clients', `/gt-users/${r.clientId}`)}
              />
            )}
            {/* Server present + linked → open detail. Server present but linked
              row is gone → offer to create one pre-filled with the URL. */}
            {r.server && r.serverId && navigate && (
              <Item
                icon={ServerIcon}
                label={`Show service: ${r.server}`}
                onClick={() => navigate('servers', `/servers/${r.serverId}`)}
              />
            )}
            {r.server && !r.serverId && navigate && (
              <Item
                icon={ServerIcon}
                label={`Create service: ${r.server}`}
                onClick={() =>
                  navigate('servers', `/servers?addUrl=${encodeURIComponent(`http://${r.server}`)}`)
                }
              />
            )}
            {/* Workflow row — only link when the underlying workflow id is known. */}
            {r.kind === 'wf' &&
              navigate &&
              (() => {
                const wfId = (r.raw as { workflowId?: string | null } | null)?.workflowId
                if (!wfId) return null
                return (
                  <Item
                    icon={WorkflowIcon}
                    label={`Show workflow: ${r.name}`}
                    onClick={() => navigate('workflows', `/workflows/${wfId}`)}
                  />
                )
              })()}
            {(r.clientId ||
              r.serverId ||
              (r.kind === 'wf' &&
                (r.raw as { workflowId?: string | null } | null)?.workflowId)) && (
              <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />
            )}
            <Item icon={Bot} label="Ask Seto" onClick={() => setSeto(true)} />
          </div>,
          document.body,
        )}

      {setoOpen && (
        <SetoModal
          kind={setoKind}
          id={r.rawId}
          label={r.name}
          server={r.server}
          onClose={() => setSeto(false)}
        />
      )}
    </td>
  )
}

/* ─── Job history table (reusable) ─────────────────────────────── */
export function JobHistoryTable({
  rows,
  loading,
  onSelect,
  hideServer = false,
  avgDurations,
  navigate,
}: {
  rows: Row[]
  loading?: boolean
  onSelect: (r: Row) => void
  hideServer?: boolean
  /** Workflow-name → avg seconds, used to flag slow runs inline. Optional —
   *  when absent, slow chips are simply not rendered. */
  avgDurations?: Record<string, number>
  navigate?: NavigateFn
}) {
  const hasDotMenu = !!navigate
  const cols = (hideServer ? 8 : 9) + (hasDotMenu ? 1 : 0)
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 44 }}>Type</th>
          <th style={{ width: 100 }}>Job ID</th>
          <th>Name</th>
          <th style={{ width: 130 }}>User</th>
          {!hideServer && <th style={{ width: 110 }}>Service</th>}
          <th style={{ width: 90 }}>Total</th>
          <th style={{ width: 100 }}>Wait</th>
          <th style={{ width: 155 }}>Completed</th>
          <th style={{ width: 115 }}>Status</th>
          {hasDotMenu && <th style={{ width: 32 }}></th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            style={{
              background:
                r.kind === 'lora'
                  ? 'color-mix(in oklab, var(--accent) 5%, transparent)'
                  : 'color-mix(in oklab, var(--pop-purple) 3%, transparent)',
              cursor: 'pointer',
            }}
            onClick={() => onSelect(r)}
          >
            <td>
              <JobKindBadge kind={r.kind} />
            </td>
            <td>
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                {r.id}
              </span>
            </td>
            <td>
              {r.arch ? (
                <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                  <strong>{r.name}</strong>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    · {r.arch}
                  </span>
                </span>
              ) : (
                <strong>{r.name}</strong>
              )}
            </td>
            <td style={{ color: r.who === '—' ? 'var(--ink-3)' : undefined }}>{r.who}</td>
            {!hideServer && (
              <td className="mono" style={{ color: !r.server ? 'var(--ink-3)' : undefined }}>
                {r.server ?? '—'}
              </td>
            )}
            <td className="mono">
              {fmtSec(r.totalSec)}
              <SlowChip row={r} avgSec={avgDurations?.[r.name]} />
            </td>
            <td className="mono" style={{ color: waitColor(r.waitTimeSec) }}>
              {fmtSec(r.waitTimeSec)}
            </td>
            <td style={{ color: 'var(--ink-2)', fontSize: 12 }}>{fmtCompleted(r.completedAt)}</td>
            <td>
              <StatusPill tone={r.statusTone}>{r.statusLabel}</StatusPill>
            </td>
            {hasDotMenu && <JobRowMenu r={r} navigate={navigate} />}
          </tr>
        ))}
        {rows.length === 0 && !loading && (
          <tr>
            <td colSpan={cols} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
              No jobs found.
            </td>
          </tr>
        )}
        {loading && (
          <tr>
            <td colSpan={cols} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
              Loading…
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/* ─── Live job tables (Running + Waiting) ───────────────────────── */
const progressColor = (pct: number) =>
  pct > 100 ? 'var(--bad)' : pct > 85 ? 'var(--warn)' : 'var(--accent)'

/** Compact marker shown on a live job whose service (or its host) is currently
 *  down — a heads-up that the job likely won't finish. Informational only; it
 *  never stops or alters the job. */
function ServerDownBadge() {
  return (
    <span
      className={`chip chip-${STATUS_TONE.down}`}
      title="This job's service or host is down — it may not finish."
      style={{ flexShrink: 0, gap: 3 }}
    >
      <ServerOff size={11} /> {STATUS_LABEL.down}
    </span>
  )
}

/** Service cell content: the server URL, plus a "Down" badge when this job's
 *  server is in `downServerIds`. The URL truncates so the badge stays visible. */
function ServiceCell({ row, down }: { row: Row; down: boolean }) {
  const label = row.server ?? '—'
  if (!down) return label
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center', minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <ServerDownBadge />
    </span>
  )
}

const rowStyle = (r: Row, hovered: boolean): React.CSSProperties => {
  if (hovered) return { background: 'color-mix(in oklab, var(--ink) 6%, transparent)' }
  return r.kind === 'lora'
    ? { background: 'color-mix(in oklab, var(--accent) 5%, transparent)' }
    : { background: 'color-mix(in oklab, var(--pop-purple) 3%, transparent)' }
}

export function LiveJobsTables({
  running,
  waiting,
  onSelect,
  loading = false,
  hideServer = false,
  avgDurations,
  navigate,
  downServerIds,
}: {
  running: Row[]
  waiting: Row[]
  onSelect: (row: Row) => void
  loading?: boolean
  hideServer?: boolean
  avgDurations?: Record<string, number>
  navigate?: NavigateFn
  /** Server ids whose service or host is currently down. Rows on these servers
   *  get a "Down" marker. Omitted by callers that don't track health. */
  downServerIds?: Set<string>
}) {
  const isServerDown = (r: Row) => !!(r.serverId && downServerIds?.has(r.serverId))
  const [hover, setHover] = useState<{ kind: string; value: string } | null>(null)

  const rowHovered = (r: Row) =>
    hover
      ? (hover.kind === 'name' && r.name === hover.value) ||
        (hover.kind === 'who' && r.who === hover.value) ||
        (hover.kind === 'server' && (r.server ?? '—') === hover.value)
      : false

  const Cell = ({
    kind,
    value,
    children,
    className,
    style,
  }: {
    kind: string
    value: string
    children: React.ReactNode
    className?: string
    style?: React.CSSProperties
  }) => {
    const isHover = hover?.kind === kind && hover?.value === value
    return (
      <td
        className={className}
        style={{
          ...style,
          background: isHover ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : undefined,
          boxShadow: isHover
            ? 'inset 0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent)'
            : undefined,
          borderRadius: isHover ? 4 : undefined,
          transition: 'background .12s, box-shadow .12s',
        }}
        onMouseEnter={() => setHover({ kind, value })}
        onMouseLeave={() => setHover(null)}
      >
        {children}
      </td>
    )
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="card-title">
            <span className="dot dot-pulse" style={{ color: 'var(--accent)' }} /> Running
          </div>
          <span className="chip chip-accent">{running.length}</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Type</th>
              <th style={{ width: 110 }}>Job ID</th>
              <th style={{ width: 200 }}>Name</th>
              <th style={{ width: 110 }}>User</th>
              {!hideServer && <th style={{ width: 130 }}>Service</th>}
              <th style={{ width: 90 }}>Started</th>
              <th style={{ width: 90 }}>Wait time</th>
              <th style={{ width: 230 }}>Elapsed / Timeout</th>
              {avgDurations && <th style={{ width: 105 }}>ETA</th>}
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {running.map((r) => {
              const pct =
                r.elapsedSec != null
                  ? Math.min(110, Math.round((r.elapsedSec / r.timeoutSec) * 100))
                  : 0
              const over = r.elapsedSec != null && r.elapsedSec > r.timeoutSec
              const wColor = waitColor(r.waitTimeSec)
              return (
                <tr
                  key={r.key}
                  style={{ ...rowStyle(r, rowHovered(r)), cursor: 'pointer' }}
                  onClick={() => onSelect(r)}
                >
                  <td>
                    <JobKindBadge kind={r.kind} />
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                      {r.id}
                    </span>
                  </td>
                  <Cell kind="name" value={r.name} style={{ overflow: 'hidden', maxWidth: 200 }}>
                    <div
                      className="row"
                      style={{ gap: 6, alignItems: 'center', overflow: 'hidden' }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                        }}
                      >
                        {r.arch ? `${r.name} · ${r.arch}` : r.name}
                      </span>
                      {r.phase === 'generating' && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'color-mix(in oklab, var(--info) 15%, transparent)',
                            color: 'var(--info)',
                            fontFamily: 'var(--font-mono)',
                            flexShrink: 0,
                          }}
                        >
                          GEN
                        </span>
                      )}
                      {r.phase === 'comfyui-wait' && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'color-mix(in oklab, var(--warn) 15%, transparent)',
                            color: 'var(--warn)',
                            fontFamily: 'var(--font-mono)',
                            flexShrink: 0,
                          }}
                        >
                          WAIT
                        </span>
                      )}
                    </div>
                  </Cell>
                  <Cell kind="who" value={r.who}>
                    {r.who}
                  </Cell>
                  {!hideServer && (
                    <Cell kind="server" value={r.server ?? '—'} className="mono">
                      <ServiceCell row={r} down={isServerDown(r)} />
                    </Cell>
                  )}
                  <td>{r.startedLabel ?? '—'}</td>
                  <td
                    className="mono"
                    style={{ fontSize: 12, color: wColor, fontWeight: wColor ? 600 : undefined }}
                  >
                    {fmtSec(r.waitTimeSec)}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="bar" style={{ flex: 1 }}>
                        <i
                          style={{ width: pct + '%', background: progressColor(over ? 101 : pct) }}
                        />
                      </div>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          width: 110,
                          textAlign: 'right',
                          color: over ? 'var(--bad)' : undefined,
                        }}
                      >
                        {fmtSec(r.elapsedSec)} / {fmtSec(r.timeoutSec)}
                      </span>
                      <SlowChip row={r} avgSec={avgDurations?.[r.name]} />
                    </div>
                  </td>
                  {avgDurations &&
                    (() => {
                      const avg = avgDurations[r.name]
                      if (avg == null || r.elapsedSec == null) {
                        return (
                          <td className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                            —
                          </td>
                        )
                      }
                      const eta = avg - r.elapsedSec
                      if (eta > 30)
                        return (
                          <td className="mono" style={{ fontSize: 12, color: 'var(--good)' }}>
                            ~{fmtSec(eta)}
                          </td>
                        )
                      if (eta > 0)
                        return (
                          <td className="mono" style={{ fontSize: 12, color: 'var(--warn)' }}>
                            ~{fmtSec(eta)}
                          </td>
                        )
                      return (
                        <td className="mono" style={{ fontSize: 12, color: 'var(--bad)' }}>
                          +{fmtSec(-eta)}
                        </td>
                      )
                    })()}
                  <JobRowMenu r={r} navigate={navigate} />
                </tr>
              )
            })}
            {running.length === 0 && (
              <tr>
                <td
                  colSpan={(hideServer ? 7 : 8) + (avgDurations ? 1 : 0) + 1}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 18 }}
                >
                  {loading ? 'Loading…' : 'No running jobs.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Waiting</div>
          <span className="chip">{waiting.length}</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Type</th>
              <th style={{ width: 110 }}>Job ID</th>
              <th>Name</th>
              <th style={{ width: 110 }}>User</th>
              {!hideServer && <th style={{ width: 130 }}>Service</th>}
              <th>Wait time</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {waiting.map((r) => {
              const wColor = waitColor(r.waitTimeSec)
              return (
                <tr
                  key={r.key}
                  style={{ ...rowStyle(r, rowHovered(r)), cursor: 'pointer' }}
                  onClick={() => onSelect(r)}
                >
                  <td>
                    <JobKindBadge kind={r.kind} />
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                      {r.id}
                    </span>
                  </td>
                  <Cell kind="name" value={r.name}>
                    <JobName row={r} />
                  </Cell>
                  <Cell kind="who" value={r.who}>
                    {r.who}
                  </Cell>
                  {!hideServer && (
                    <Cell kind="server" value={r.server ?? '—'} className="mono">
                      <ServiceCell row={r} down={isServerDown(r)} />
                    </Cell>
                  )}
                  <td>
                    <span
                      className="mono"
                      style={{ color: wColor, fontWeight: wColor ? 600 : undefined }}
                    >
                      {fmtSec(r.waitTimeSec)}
                    </span>
                    {wColor && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: `color-mix(in oklab, ${wColor} 15%, transparent)`,
                          color: wColor,
                          fontWeight: 700,
                        }}
                      >
                        {(r.waitTimeSec ?? 0) >= 1800
                          ? '30m+'
                          : (r.waitTimeSec ?? 0) >= 600
                            ? '10m+'
                            : '5m+'}
                      </span>
                    )}
                  </td>
                  <JobRowMenu r={r} navigate={navigate} />
                </tr>
              )
            })}
            {waiting.length === 0 && (
              <tr>
                <td
                  colSpan={hideServer ? 6 : 7}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 18 }}
                >
                  {loading ? 'Loading…' : 'Nothing waiting.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ─── Failed jobs table (WF + LoRA merged; same shape as history minus
 *     status, with Error type instead). Used by the Doctor Failures tab.
 *     Trailing dot-menu column matches the Jobs page tables so "Ask Seto"
 *     etc. is one click from the failures list. */
export function FailedJobsTable({
  rows,
  onSelect,
  onErrClick,
  navigate,
}: {
  rows: Row[]
  onSelect: (r: Row) => void
  onErrClick?: (code: string, e: React.MouseEvent) => void
  navigate?: NavigateFn
}) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 44 }}>Type</th>
          <th style={{ width: 100 }}>Job ID</th>
          <th>Name</th>
          <th style={{ width: 130 }}>User</th>
          <th style={{ width: 110 }}>Service</th>
          <th style={{ width: 90 }}>Total</th>
          <th style={{ width: 100 }}>Wait</th>
          <th style={{ width: 155 }}>Completed</th>
          <th style={{ width: 200 }}>Error</th>
          <th style={{ width: 32 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const code = classifyError(r.failedReason)
          const tone = errorCodeTone(code)
          return (
            <tr
              key={r.key}
              style={{
                background:
                  r.kind === 'lora'
                    ? 'color-mix(in oklab, var(--accent) 5%, transparent)'
                    : 'color-mix(in oklab, var(--pop-purple) 3%, transparent)',
                cursor: 'pointer',
              }}
              onClick={() => onSelect(r)}
              title="View logs and stacktrace"
            >
              <td>
                <JobKindBadge kind={r.kind} />
              </td>
              <td>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {r.id}
                </span>
              </td>
              <td>
                {r.arch ? (
                  <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                    <strong>{r.name}</strong>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                      · {r.arch}
                    </span>
                  </span>
                ) : (
                  <strong>{r.name}</strong>
                )}
              </td>
              <td style={{ color: r.who === '—' ? 'var(--ink-3)' : undefined }}>{r.who}</td>
              <td className="mono" style={{ color: !r.server ? 'var(--ink-3)' : undefined }}>
                {r.server ?? '—'}
              </td>
              <td className="mono">{fmtSec(r.totalSec)}</td>
              <td className="mono" style={{ color: waitColor(r.waitTimeSec) }}>
                {fmtSec(r.waitTimeSec)}
              </td>
              <td style={{ color: 'var(--ink-2)', fontSize: 12 }}>{fmtCompleted(r.completedAt)}</td>
              <td>
                <span
                  onClick={
                    onErrClick
                      ? (e) => {
                          e.stopPropagation()
                          onErrClick(code, e)
                        }
                      : undefined
                  }
                  style={{ cursor: onErrClick ? 'pointer' : 'default' }}
                  title={onErrClick ? 'Open error detail' : undefined}
                >
                  <span className={`chip chip-${tone}`} style={{ fontSize: 10, marginRight: 6 }}>
                    {code}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {ERROR_CODE_LABEL[code] ?? (r.failedReason ?? '').slice(0, 60)}
                </span>
              </td>
              <JobRowMenu r={r} navigate={navigate} setoKind="history-job" />
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={10} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
              No failures in this range.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/* ─── Slow jobs table — sortable columns. Each numeric/timestamp column
 *     is sortable; clicking the active column toggles direction. */
type SlowSortKey = 'wait' | 'dur' | 'created' | 'started' | 'exec' | 'done'
function fmtAbs(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  // Compact format: "May 18 14:23"
  const month = d.toLocaleString('en', { month: 'short' })
  const day = String(d.getDate())
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${month} ${day} ${h}:${m}`
}
function tsValue(ts: string | null | undefined): number {
  if (!ts) return -Infinity
  return new Date(ts).getTime()
}

export function SlowJobsTable({ rows, onSelect }: { rows: Row[]; onSelect: (r: Row) => void }) {
  const [sortKey, setSortKey] = useState<SlowSortKey>('dur')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const keyed = rows.map((r) => ({
      r,
      wait: r.waitTimeSec ?? -Infinity,
      dur: r.totalSec ?? -Infinity,
      created: tsValue(r.createdAt),
      started: tsValue(r.processedAt),
      exec: tsValue(r.execAt),
      done: tsValue(r.finishedAt),
    }))
    keyed.sort((a, b) => (sortDir === 'asc' ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]))
    return keyed.map((x) => x.r)
  }, [rows, sortKey, sortDir])

  const onSort = (k: SlowSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const Th = ({
    label,
    col,
    width,
    num,
  }: {
    label: string
    col: SlowSortKey
    width?: number
    num?: boolean
  }) => {
    const active = sortKey === col
    return (
      <th
        onClick={() => onSort(col)}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          width,
          textAlign: num ? 'right' : 'left',
        }}
      >
        {label}{' '}
        <span style={{ color: active ? 'var(--accent)' : 'var(--ink-3)', fontSize: 9 }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </th>
    )
  }

  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 44 }}>Type</th>
          <th style={{ width: 100 }}>Job ID</th>
          <th>Name</th>
          <th style={{ width: 130 }}>User</th>
          <th style={{ width: 110 }}>Service</th>
          <Th label="Wait" col="wait" width={90} num />
          <Th label="Duration" col="dur" width={100} num />
          <Th label="Created" col="created" width={130} />
          <Th label="Started" col="started" width={130} />
          <Th label="Exec" col="exec" width={130} />
          <Th label="Done" col="done" width={130} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const wColor = waitColor(r.waitTimeSec)
          const over = r.totalSec != null && r.totalSec > r.timeoutSec
          return (
            <tr
              key={r.key}
              style={{
                background:
                  r.kind === 'lora'
                    ? 'color-mix(in oklab, var(--accent) 5%, transparent)'
                    : 'color-mix(in oklab, var(--pop-purple) 3%, transparent)',
                cursor: 'pointer',
              }}
              onClick={() => onSelect(r)}
              title="View logs"
            >
              <td>
                <JobKindBadge kind={r.kind} />
              </td>
              <td>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {r.id}
                </span>
              </td>
              <td>
                {r.arch ? (
                  <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                    <strong>{r.name}</strong>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                      · {r.arch}
                    </span>
                  </span>
                ) : (
                  <strong>{r.name}</strong>
                )}
              </td>
              <td style={{ color: r.who === '—' ? 'var(--ink-3)' : undefined }}>{r.who}</td>
              <td className="mono" style={{ color: !r.server ? 'var(--ink-3)' : undefined }}>
                {r.server ?? '—'}
              </td>
              <td
                className="mono"
                style={{ textAlign: 'right', color: wColor, fontWeight: wColor ? 600 : undefined }}
              >
                {fmtSec(r.waitTimeSec)}
              </td>
              <td
                className="mono"
                style={{
                  textAlign: 'right',
                  color: over ? 'var(--bad)' : undefined,
                  fontWeight: over ? 600 : undefined,
                }}
              >
                {fmtSec(r.totalSec)}
              </td>
              <td className="mono" style={{ fontSize: 11 }}>
                {fmtAbs(r.createdAt)}
              </td>
              <td
                className="mono"
                style={{ fontSize: 11, color: r.processedAt ? undefined : 'var(--ink-3)' }}
              >
                {fmtAbs(r.processedAt)}
              </td>
              <td
                className="mono"
                style={{ fontSize: 11, color: r.execAt ? undefined : 'var(--ink-3)' }}
              >
                {fmtAbs(r.execAt)}
              </td>
              <td
                className="mono"
                style={{ fontSize: 11, color: r.finishedAt ? undefined : 'var(--ink-3)' }}
              >
                {fmtAbs(r.finishedAt)}
              </td>
            </tr>
          )
        })}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={11} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
              No slow jobs.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
