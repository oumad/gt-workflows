import { useState, useEffect, useRef } from 'react'
import { FileText, Activity, Cpu, Pencil, GripVertical, Loader2, Bell, BellRing, RotateCcw, Trash2, MoreHorizontal, Check, AlertTriangle } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ServerHealthStatus } from '@/hooks/useServerHealthCheck'
import type { QueueDepth } from '@/services/api/servers'
import { restartServer } from '@/services/api/servers'
import { formatRelativeTime } from '@/utils/dateFormat'
import { useToast } from '@/contexts/ToastContext'
import { useIncidentTimeline } from '@/contexts/IncidentTimelineContext'

function RelativeTime({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => formatRelativeTime(iso))
  useEffect(() => {
    setLabel(formatRelativeTime(iso))
    const id = setInterval(() => setLabel(formatRelativeTime(iso)), 30_000)
    return () => clearInterval(id)
  }, [iso])
  return <>{label}</>
}

function formatGb(bytes: number): string {
  const gb = bytes / (1024 ** 3)
  return gb >= 10 ? `${Math.round(gb)}` : `${gb.toFixed(1)}`
}

interface ServerCardProps {
  server: string
  index: number
  serverAliases: Record<string, string>
  serverGroups: Record<string, string[]>
  health: ServerHealthStatus | null
  wfCount: number
  isServerChecking: boolean
  isDuplicate?: boolean
  queueDepth?: QueueDepth
  showDragHandle: boolean
  isWatched?: boolean
  activeTag?: string | null
  onRemove: (index: number) => void
  onEdit: (url: string) => void
  onViewLogs: (url: string) => void
  onCheck: (url: string) => void
  onViewWorkflows: (url: string) => void
  onViewJobs: (url: string) => void
  onToggleWatch?: (url: string) => void
  onTagClick?: (tag: string) => void
  onViewDetail?: (url: string) => void
}

export function ServerCard({
  server, index, serverAliases, serverGroups, health, wfCount, isServerChecking,
  isDuplicate, queueDepth, showDragHandle, isWatched, activeTag,
  onRemove, onEdit, onViewLogs, onCheck, onViewWorkflows, onViewJobs, onToggleWatch, onTagClick, onViewDetail,
}: ServerCardProps) {
  const { addToast } = useToast()
  const { addEvent } = useIncidentTimeline()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const showOverlay = confirmRemove || confirmRestart
  const [restarting, setRestarting] = useState(false)
  const [restartDone, setRestartDone] = useState(false)

  const [showMenu, setShowMenu] = useState(false)
  const [menuUp, setMenuUp] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  useEffect(() => {
    if (!showMenu || !menuBtnRef.current) return
    const rect = menuBtnRef.current.getBoundingClientRect()
    setMenuUp(window.innerHeight - rect.bottom < 200)
  }, [showMenu])

  async function handleRestart() {
    if (restarting) return
    setConfirmRestart(false)
    setRestarting(true)
    setRestartDone(false)
    try {
      await restartServer(norm)
      setRestartDone(true)
      addEvent('server.restart', norm)
      setTimeout(() => setRestartDone(false), 4000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restart failed'
      addToast(msg, 'error')
    } finally {
      setRestarting(false)
    }
  }

  const norm = server.replace(/\/$/, '')
  const bareUrl = server.replace(/^https?:\/\//, '')
  const alias = serverAliases[server]
  const hasAlias = Boolean(alias && alias !== bareUrl)
  const tags = serverGroups[norm] ?? []

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: server })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 999 : undefined,
  }

  const healthClass = !health
    ? ''
    : health.healthy === true
      ? 'server-card--healthy'
      : health.healthy === false
        ? 'server-card--unhealthy'
        : 'server-card--checking'

  const dotClass = !health
    ? 'server-card-dot--unchecked'
    : health.healthy === null
      ? 'server-card-dot--checking'
      : health.healthy
        ? 'server-card-dot--healthy'
        : 'server-card-dot--unhealthy'

  const hasQueue = queueDepth && (queueDepth.running > 0 || queueDepth.pending > 0)

  const info = health?.systemInfo
  const showSysInfo = health?.healthy === true && info && (info.comfyVersion || info.gpuName)
  const hasVram = info?.vramTotal != null && info?.vramFree != null
  const vramUsed = hasVram ? info!.vramTotal! - info!.vramFree! : null

  const latencyCls = health?.latencyMs != null
    ? health.latencyMs < 100 ? 'server-card-latency--fast'
    : health.latencyMs < 500 ? 'server-card-latency--slow'
    : 'server-card-latency--error'
    : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`server-card ${healthClass} ${isDuplicate ? 'server-card--duplicate' : ''}`}
    >
      {showOverlay && (
        <div className="server-card-overlay">
          {confirmRestart && (
            <>
              <RotateCcw size={20} className="server-card-overlay-icon server-card-overlay-icon--accent" />
              <p className="server-card-overlay-title">Restart ComfyUI?</p>
              <p className="server-card-overlay-sub">{bareUrl}</p>
              <div className="server-card-overlay-actions">
                <button type="button" className="server-card-overlay-btn server-card-overlay-btn--cancel" onClick={() => setConfirmRestart(false)}>Cancel</button>
                <button type="button" className="server-card-overlay-btn server-card-overlay-btn--confirm" onClick={handleRestart}>
                  <RotateCcw size={13} /> Restart
                </button>
              </div>
            </>
          )}
          {confirmRemove && (
            <>
              <Trash2 size={20} className="server-card-overlay-icon server-card-overlay-icon--danger" />
              <p className="server-card-overlay-title">Remove server?</p>
              <p className="server-card-overlay-sub">{bareUrl}</p>
              <div className="server-card-overlay-actions">
                <button type="button" className="server-card-overlay-btn server-card-overlay-btn--cancel" onClick={() => setConfirmRemove(false)}>Cancel</button>
                <button type="button" className="server-card-overlay-btn server-card-overlay-btn--danger" onClick={() => onRemove(index)}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Main row ── */}
      <div className="server-card-row">
        {showDragHandle && (
          <div className="server-card-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
            <GripVertical size={13} />
          </div>
        )}

        <span className={`server-card-dot ${dotClass}`} />

        <div className="server-card-info">
          <div className="server-card-name-line">
            <span
              className={`server-card-name${onViewDetail ? ' cursor-pointer hover:text-accent-light transition-colors' : ''}`}
              title={onViewDetail ? `${server} — click to view queue & stats` : server}
              onClick={onViewDetail ? (e) => { e.stopPropagation(); onViewDetail(server) } : undefined}
            >
              {hasAlias ? alias : bareUrl}
            </span>
            {queueDepth && queueDepth.running > 0 && (
              <span className="server-card-running-dot" title={`${queueDepth.running} job${queueDepth.running !== 1 ? 's' : ''} running now`} />
            )}
            {isDuplicate && (
              <AlertTriangle size={11} className="server-card-dup-icon" title="Duplicate URL" />
            )}
          </div>
          {hasAlias && (
            <span className="server-card-url" title={server}>{bareUrl}</span>
          )}
          {tags.length > 0 && (
            <div className="server-card-tags">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={`server-card-tag${onTagClick ? ' server-card-tag--clickable' : ''}${activeTag === tag ? ' server-card-tag--active' : ''}`}
                  onClick={onTagClick ? (e) => { e.stopPropagation(); onTagClick(tag) } : undefined}
                  title={onTagClick ? `Filter by tag: ${tag}` : tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div ref={menuRef} className="server-card-menu-wrap">
          <button
            ref={menuBtnRef}
            type="button"
            className="server-card-menu-btn"
            onClick={(e) => { e.stopPropagation(); setShowMenu((o) => !o) }}
            title="Actions"
          >
            <MoreHorizontal size={15} />
          </button>
          {showMenu && (
            <div className={`server-card-menu ${menuUp ? 'server-card-menu--up' : ''}`}>
              <button type="button" className="server-card-menu-item" onClick={() => { onViewLogs(server); setShowMenu(false) }}>
                <FileText size={13} /> View server log
              </button>
              <div className="server-card-menu-divider" />
              <button type="button" className="server-card-menu-item" onClick={() => { onCheck(norm); setShowMenu(false) }} disabled={isServerChecking}>
                {isServerChecking ? <Loader2 size={13} className="spin" /> : <Activity size={13} />}
                Check health
              </button>
              <button type="button" className="server-card-menu-item" onClick={() => { onEdit(server); setShowMenu(false) }}>
                <Pencil size={13} /> Edit
              </button>
              {onToggleWatch && (
                <button
                  type="button"
                  className={`server-card-menu-item${isWatched ? ' server-card-menu-item--active' : ''}`}
                  onClick={() => { onToggleWatch(server); setShowMenu(false) }}
                >
                  {isWatched ? <BellRing size={13} /> : <Bell size={13} />}
                  {isWatched ? 'Stop monitoring' : 'Monitor'}
                </button>
              )}
              <button
                type="button"
                className="server-card-menu-item"
                onClick={() => { setConfirmRestart(true); setShowMenu(false) }}
                disabled={restarting}
              >
                {restarting ? <Loader2 size={13} className="spin" /> : restartDone ? <Check size={13} /> : <RotateCcw size={13} />}
                Restart ComfyUI
              </button>
              <div className="server-card-menu-divider" />
              <button type="button" className="server-card-menu-item server-card-menu-item--danger" onClick={() => { setConfirmRemove(true); setShowMenu(false) }}>
                <Trash2 size={13} /> Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── GPU / version strip ── */}
      {showSysInfo && (
        <div className="server-card-sysinfo">
          {info!.comfyVersion && <span className="server-card-version">{info!.comfyVersion}</span>}
          {info!.comfyVersion && info!.gpuName && <span className="server-card-sysinfo-sep">·</span>}
          {info!.gpuName && (
            <span className="server-card-gpu">
              <Cpu size={10} />
              {info!.gpuName}
              {hasVram && <span className="server-card-vram"> {formatGb(vramUsed!)}/{formatGb(info!.vramTotal!)} GB</span>}
            </span>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="server-card-footer">
        {wfCount > 0 && (
          <button
            type="button"
            className="server-card-badge"
            onClick={() => onViewWorkflows(norm)}
            title={`${wfCount} workflow${wfCount !== 1 ? 's' : ''} — click to view`}
          >
            {wfCount} wf
          </button>
        )}
        {hasQueue && health?.healthy === true && (
          <button
            type="button"
            className="server-card-badge server-card-badge--queue"
            onClick={() => onViewJobs(norm)}
            title="View current jobs"
          >
            {queueDepth!.running > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2em' }}>
                ▶{' '}
                {queueDepth!.runningJobName
                  ? <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}>{queueDepth!.runningJobName}</span>
                  : queueDepth!.running}
              </span>
            )}
            {queueDepth!.running > 0 && queueDepth!.pending > 0 && ' · '}
            {queueDepth!.pending > 0 && `${queueDepth!.pending} queued`}
          </button>
        )}

        <div className="server-card-meta">
          {health?.lastChecked ? (
            <span title={`Last checked: ${new Date(health.lastChecked).toLocaleString()}`}>
              <RelativeTime iso={health.lastChecked} />
              {health.latencyMs != null && health.healthy === true && (
                <span className={`server-card-latency ${latencyCls}`}> · {health.latencyMs}ms</span>
              )}
            </span>
          ) : (
            <span className="server-card-meta--unchecked">not checked</span>
          )}
        </div>
      </div>

      {health?.healthy === false && health.error && (
        <div className="server-card-error">{health.error}</div>
      )}
    </div>
  )
}
