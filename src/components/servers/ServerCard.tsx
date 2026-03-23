import { useState, useEffect } from 'react'
import { Server, X, Check, AlertTriangle, FileText, Activity, CheckCircle, XCircle, Clock, LayoutGrid, Cpu, Pencil, GripVertical, Loader2, Bell, BellRing, RotateCcw } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ServerHealthStatus, ServerSystemInfo } from '@/hooks/useServerHealthCheck'
import type { QueueDepth } from '@/services/api/servers'
import { restartServer } from '@/services/api/servers'
import { formatRelativeTime } from '@/utils/dateFormat'

// Ticks relative time every 30s
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

function SysInfoStrip({ info }: { info: ServerSystemInfo }) {
  const hasVram = info.vramTotal != null && info.vramFree != null
  const vramUsed = hasVram ? info.vramTotal! - info.vramFree! : null

  return (
    <div className="server-card-sysinfo">
      {info.comfyVersion && (
        <span className="server-card-version" title="ComfyUI version">{info.comfyVersion}</span>
      )}
      {info.comfyVersion && info.gpuName && <span className="server-card-sysinfo-sep">·</span>}
      {info.gpuName && (
        <span className="server-card-gpu" title="GPU">
          <Cpu size={11} />
          {info.gpuName}
          {hasVram && (
            <span className="server-card-vram">
              {' '}{formatGb(vramUsed!)}/{formatGb(info.vramTotal!)} GB
            </span>
          )}
        </span>
      )}
    </div>
  )
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
  onRemove: (index: number) => void
  onEdit: (url: string) => void
  onViewLogs: (url: string) => void
  onCheck: (url: string) => void
  onViewWorkflows: (url: string) => void
  onViewJobs: (url: string) => void
  onToggleWatch?: (url: string) => void
}

export function ServerCard({
  server, index, serverAliases, serverGroups, health, wfCount, isServerChecking,
  isDuplicate, queueDepth, showDragHandle, isWatched,
  onRemove, onEdit, onViewLogs, onCheck, onViewWorkflows, onViewJobs, onToggleWatch,
}: ServerCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartDone, setRestartDone] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)

  async function handleRestart() {
    if (restarting) return
    setConfirmRestart(false)
    setRestarting(true)
    setRestartDone(false)
    setRestartError(null)
    try {
      await restartServer(norm)
      setRestartDone(true)
      setTimeout(() => setRestartDone(false), 4000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restart failed'
      setRestartError(msg)
      setTimeout(() => setRestartError(null), 6000)
    } finally {
      setRestarting(false)
    }
  }
  const norm = server.replace(/\/$/, '')
  const bareUrl = server.replace(/^https?:\/\//, '')

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

  const queueLabel = queueDepth
    ? [
        queueDepth.running > 0 ? `${queueDepth.running} running` : '',
        queueDepth.pending > 0 ? `${queueDepth.pending} queued` : '',
      ].filter(Boolean).join(' · ')
    : null

  const showSysInfo = health?.healthy === true && health.systemInfo &&
    (health.systemInfo.comfyVersion || health.systemInfo.gpuName)

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
      <div className="server-card-header">
        {showDragHandle && (
          <div className="server-card-drag-handle" {...attributes} {...listeners} title="Drag to reorder">
            <GripVertical size={14} />
          </div>
        )}
        <div className="server-card-status-icon">
          {!health && <Server size={20} className="server-card-icon-default" />}
          {health?.healthy === null && <Clock size={20} className="server-card-icon-checking spin" />}
          {health?.healthy === true && <CheckCircle size={20} className="server-card-icon-healthy" />}
          {health?.healthy === false && <XCircle size={20} className="server-card-icon-unhealthy" />}
        </div>
        <div className="server-card-title-block">
          <span className="server-card-title" title={server}>
            {serverAliases[server] || bareUrl}
          </span>
          <span className="server-card-url" title={server}>
            {bareUrl}
          </span>
        </div>
        {isDuplicate && (
          <span className="server-card-duplicate-badge" title="Duplicate URL">
            <AlertTriangle size={14} />
          </span>
        )}
        <button type="button" className="server-card-edit-btn" onClick={() => onEdit(server)} title="Edit server">
          <Pencil size={13} />
        </button>
        {onToggleWatch && (
          <button
            type="button"
            className={`server-card-watch-btn${isWatched ? ' server-card-watch-btn--active' : ''}`}
            onClick={() => onToggleWatch(server)}
            title={isWatched ? 'Stop monitoring this server' : 'Monitor this server in background'}
          >
            {isWatched ? <BellRing size={13} /> : <Bell size={13} />}
          </button>
        )}
        {confirmRemove ? (
          <div className="server-card-remove-confirm">
            <span className="server-card-remove-label">Remove?</span>
            <button type="button" className="server-card-remove-yes" onClick={() => onRemove(index)} title="Confirm remove">
              <Check size={12} />
            </button>
            <button type="button" className="server-card-remove-no" onClick={() => setConfirmRemove(false)} title="Cancel">
              <X size={12} />
            </button>
          </div>
        ) : (
          <button type="button" className="server-card-remove" onClick={() => setConfirmRemove(true)} title="Remove server">
            <X size={14} />
          </button>
        )}
      </div>

      {(serverGroups[norm] ?? []).length > 0 && (
        <div className="server-card-tags">
          {(serverGroups[norm] ?? []).map((tag) => (
            <span key={tag} className="server-card-group-badge" title={`Tag: ${tag}`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {showSysInfo && <SysInfoStrip info={health!.systemInfo!} />}

      <div className="server-card-footer">
        {wfCount > 0 && (
          <button
            type="button"
            className="server-card-wf-count"
            onClick={() => onViewWorkflows(norm)}
            title={`${wfCount} workflow${wfCount !== 1 ? 's' : ''} use this server — click to view`}
          >
            <LayoutGrid size={13} />
            {wfCount} wf
          </button>
        )}

        {queueLabel && health?.healthy === true && (
          <button
            type="button"
            className="server-card-queue"
            onClick={() => onViewJobs(norm)}
            title="View current jobs on this server"
          >
            {queueLabel}
          </button>
        )}

        {health?.lastChecked ? (
          <span
            className="server-card-meta"
            title={`Last checked: ${new Date(health.lastChecked).toLocaleString()}`}
          >
            <RelativeTime iso={health.lastChecked} />
            {health.latencyMs != null && health.healthy === true && (
              <>
                <span className="server-card-meta-sep">·</span>
                <span className={`server-card-latency ${latencyCls}`}>{health.latencyMs}ms</span>
              </>
            )}
          </span>
        ) : (
          <span className="server-card-meta server-card-meta--unchecked">not checked</span>
        )}

        <div className="server-card-actions">
          <button type="button" className="server-action-btn" onClick={() => onViewLogs(server)} title="View server logs">
            <FileText size={14} />
          </button>
          {confirmRestart ? (
            <div className="server-card-restart-confirm">
              <span className="server-card-restart-label">Restart?</span>
              <button type="button" className="server-card-remove-yes" onClick={handleRestart} title="Confirm restart">
                <Check size={12} />
              </button>
              <button type="button" className="server-card-remove-no" onClick={() => setConfirmRestart(false)} title="Cancel">
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`server-action-btn${restartDone ? ' server-action-btn--done' : ''}`}
              onClick={() => setConfirmRestart(true)}
              disabled={restarting}
              title="Restart ComfyUI (requires ComfyUI Manager)"
            >
              {restarting ? <Loader2 size={14} className="spin" /> : restartDone ? <Check size={14} /> : <RotateCcw size={14} />}
            </button>
          )}
          <button type="button" className="server-action-btn" onClick={() => onCheck(norm)} disabled={isServerChecking} title="Check server health">
            {isServerChecking ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
          </button>
        </div>
      </div>

      {health?.healthy === false && health.error && (
        <div className="server-card-error">{health.error}</div>
      )}
      {restartError && (
        <div className="server-card-error">{restartError}</div>
      )}
    </div>
  )
}
