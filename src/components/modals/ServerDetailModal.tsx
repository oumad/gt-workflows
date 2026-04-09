import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, Zap, Square, Trash2, Cpu, Activity, Clock, Loader2, FileText, HardDriveDownload, Wind, RotateCcw, MoreHorizontal } from 'lucide-react'
import {
  fetchComfyQueue,
  interruptComfyServer,
  deleteComfyQueueJobs,
  freeComfyServer,
  restartServer,
  type ComfyQueueJob,
} from '@/services/api/servers'
import { getCompletedJobs, getFailedJobs, getUserServerStats, getPromptMap } from '@/services/api/stats'
import type { CompletedJobSummary, FailedJobSummary } from '@/services/api/stats'
import UnifiedJobModal from '@/components/modals/UnifiedJobModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import { fetchWithAuth } from '@/utils/auth'
import { durationColorClass, classifyFailure } from '@/utils/failureClassifier'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'
import { useToast } from '@/contexts/ToastContext'
import { useIncidentTimeline } from '@/contexts/IncidentTimelineContext'

const USER_COLORS = [
  '#6a3fa0', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
]

interface ServerSystemInfo {
  gpuName?: string
  vramTotal?: number
  vramFree?: number
  comfyVersion?: string
}

interface LocalHealth {
  healthy: boolean
  latencyMs?: number
  systemInfo?: ServerSystemInfo
}

interface Props {
  serverUrl: string
  onClose: () => void
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function ElapsedTimer({ startedAtMs }: { startedAtMs: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAtMs)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAtMs), 1000)
    return () => clearInterval(id)
  }, [startedAtMs])
  const s = Math.floor(elapsed / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const fmt = h > 0
    ? `${h}h ${m % 60}m ${s % 60}s`
    : m > 0
      ? `${m}m ${s % 60}s`
      : `${s}s`
  return <span className="tabular-nums">{fmt}</span>
}

function VramBar({ vramTotal, vramFree }: { vramTotal: number; vramFree: number }) {
  const used = vramTotal - vramFree
  const pct = Math.round((used / vramTotal) * 100)
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted">
        <span>VRAM</span>
        <span className="tabular-nums" style={{ color }}>
          {formatBytes(used)} / {formatBytes(vramTotal)} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-[rgba(45,58,74,0.6)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

function JobRow({
  job,
  type,
  onInterrupt,
  onDelete,
  onViewLogs,
  onViewServerLogs,
  bullJobId,
  startedAt,
  actioning,
}: {
  job: ComfyQueueJob
  type: 'running' | 'pending'
  onInterrupt: () => void
  onDelete: (id: string) => void
  onViewLogs?: (job: ComfyQueueJob) => void
  onViewServerLogs?: () => void
  bullJobId?: string
  startedAt: number
  actioning: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-[0.5rem] border-b border-default last:border-b-0 group">
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap" title={job.promptId}>
          {job.name || <span className="text-muted font-mono text-xs">{job.promptId.slice(0, 12)}…</span>}
        </span>
        <span className="text-xs text-muted font-mono">{job.promptId.slice(0, 8)}…</span>
      </div>

      {type === 'running' ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1 text-xs text-muted">
            <Clock size={11} />
            <ElapsedTimer startedAtMs={startedAt} />
          </span>
          <span className="inline-flex items-center gap-1 px-[0.35rem] py-[0.1rem] rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Running
          </span>
          {onViewLogs && (
            <button
              type="button"
              title={bullJobId ? `Bull job ${bullJobId} — click to view logs` : 'Waiting for Bull job correlation…'}
              onClick={() => onViewLogs(job)}
              disabled={!bullJobId}
              className="flex items-center gap-1 px-2 py-[0.25rem] rounded-md text-xs text-muted border border-default bg-tertiary hover:text-primary hover:border-[#4a5d73] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText size={11} />
              Logs
            </button>
          )}
          {onViewServerLogs && (
            <button
              type="button"
              title="View ComfyUI server logs"
              onClick={onViewServerLogs}
              className="flex items-center gap-1 px-2 py-[0.25rem] rounded-md text-xs text-muted border border-default bg-tertiary hover:text-primary hover:border-[#4a5d73] transition-colors cursor-pointer"
            >
              <Activity size={11} />
              Server
            </button>
          )}
          <button
            type="button"
            title="Interrupt this job"
            onClick={onInterrupt}
            disabled={actioning}
            className="flex items-center gap-1 px-2 py-[0.25rem] rounded-md text-xs text-muted border border-default bg-tertiary hover:text-semantic-error hover:border-semantic-error/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {actioning ? <Loader2 size={11} className="animate-spin" /> : <Square size={11} />}
            {actioning ? 'Interrupting…' : 'Interrupt'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted">#{job.position}</span>
          <button
            type="button"
            title="Remove from queue"
            onClick={() => onDelete(job.promptId)}
            className="flex items-center gap-1 px-2 py-[0.25rem] rounded-md text-xs text-muted border border-default bg-tertiary hover:text-semantic-error hover:border-semantic-error/40 transition-colors cursor-pointer opacity-40 group-hover:opacity-100"
          >
            <Trash2 size={11} />
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

type RecentJob = {
  id: string
  name: string
  user: string
  status: 'completed' | 'failed'
  duration: number | null
  finishedOn: number | null
  failedReason?: string | null
}

function formatDur(ms: number | null): string {
  if (ms == null || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatAgo(ts: number | null): string {
  if (ts == null) return '—'
  const elapsed = Date.now() - ts
  if (elapsed < 60_000) return 'just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  return `${Math.floor(elapsed / 86_400_000)}d ago`
}

export default function ServerDetailModal({ serverUrl, onClose }: Props) {
  const { addToast } = useToast()
  const { addEvent } = useIncidentTimeline()
  const aliases = useServerAliases()
  const [running, setRunning] = useState<ComfyQueueJob[]>([])
  const [pending, setPending] = useState<ComfyQueueJob[]>([])
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState(false)
  const [freeing, setFreeing] = useState<'unload' | 'memory' | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const [health, setHealth] = useState<LocalHealth | null>(null)
  const [logsJobId, setLogsJobId] = useState<string | null>(null)
  const [logsServerOpen, setLogsServerOpen] = useState(false)
  /** comfyPromptId → Bull jobId, rebuilt on each queue refresh */
  const [promptToBullMap, setPromptToBullMap] = useState<Record<string, string>>({})
  const loadedAtRef = useRef(Date.now())
  /** Per-promptId start times — preserved across refreshes so timer doesn't reset */
  const startedAtMapRef = useRef<Record<string, number>>({})
  const abortRef = useRef<AbortController | null>(null)

  // Recent job history for this server
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [recentLoading, setRecentLoading] = useState(true)

  // User usage breakdown for this server
  const [userUsage, setUserUsage] = useState<{ user: string; count: number; pct: number }[]>([])
  const [userTotal, setUserTotal] = useState(0)

  const load = useCallback(async (silent = false) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    if (!silent) setLoading(true)
    try {
      const q = await fetchComfyQueue(serverUrl, ctrl.signal)
      if (ctrl.signal.aborted) return
      const now = Date.now()
      loadedAtRef.current = now
      // Record start time for newly-seen running jobs; preserve times for already-known ones
      const nextMap: Record<string, number> = {}
      for (const job of q.running) {
        nextMap[job.promptId] = startedAtMapRef.current[job.promptId] ?? now
      }
      startedAtMapRef.current = nextMap
      setRunning(q.running)
      setPending(q.pending)
      // Fetch promptId → Bull jobId correlation from logs
      if (q.running.length > 0) {
        getPromptMap(serverUrl).then((entries) => {
          const m: Record<string, string> = {}
          for (const { promptId, bullJobId } of entries) m[promptId] = bullJobId
          setPromptToBullMap(m)
        }).catch(() => {})
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      addToast(err instanceof Error ? err.message : 'Failed to load queue', 'error')
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [serverUrl])

  useEffect(() => {
    load()
    const id = setInterval(() => load(true), 5000)
    return () => {
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [load])

  // Fetch health (VRAM, GPU, latency) on open
  useEffect(() => {
    let cancelled = false
    fetchWithAuth('/api/servers/health-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl }),
    })
      .then((r) => r.json())
      .then((h) => {
        if (cancelled) return
        setHealth({
          healthy: h.healthy === true,
          latencyMs: typeof h.latencyMs === 'number' ? h.latencyMs : undefined,
          systemInfo: h.systemInfo ?? undefined,
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [serverUrl])

  // Fetch recent completed + failed jobs for this server
  useEffect(() => {
    let cancelled = false
    setRecentLoading(true)
    const filters = { server: serverUrl }
    Promise.allSettled([
      getCompletedJobs(1, 10, '', undefined, 'finished', 'desc', filters),
      getFailedJobs(1, 10, '', undefined, false, filters),
    ]).then(([completedRes, failedRes]) => {
      if (cancelled) return
      const completed: RecentJob[] = completedRes.status === 'fulfilled'
        ? completedRes.value.jobs.map((j: CompletedJobSummary) => ({
            id: j.id, name: j.name, user: j.user, status: 'completed' as const,
            duration: j.duration, finishedOn: j.finishedOn,
          }))
        : []
      const failed: RecentJob[] = failedRes.status === 'fulfilled'
        ? failedRes.value.jobs.map((j: FailedJobSummary) => ({
            id: j.id, name: j.name, user: j.user, status: 'failed' as const,
            duration: (j.processedOn != null && j.finishedOn != null) ? j.finishedOn - j.processedOn : null,
            finishedOn: j.finishedOn, failedReason: j.failedReason,
          }))
        : []
      // Merge and sort by finishedOn desc, take top 10
      const merged = [...completed, ...failed]
        .sort((a, b) => (b.finishedOn ?? 0) - (a.finishedOn ?? 0))
        .slice(0, 10)
      setRecentJobs(merged)
      setRecentLoading(false)
    })
    return () => { cancelled = true }
  }, [serverUrl])

  // Fetch user usage breakdown for this server (last 30d)
  useEffect(() => {
    let cancelled = false
    getUserServerStats('1m')
      .then((d) => {
        if (cancelled) return
        const entry = d.byServer.find((s) => s.server === serverUrl || s.server.replace(/\/$/, '') === serverUrl.replace(/\/$/, ''))
        if (entry) {
          setUserUsage(entry.users)
          setUserTotal(entry.total)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [serverUrl])

  useEffect(() => {
    if (!showActionsMenu) return
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showActionsMenu])

  const handleInterrupt = useCallback(async () => {
    setActioning(true)
    try {
      await interruptComfyServer(serverUrl)
      // Refresh queue after a short delay to let ComfyUI process the interrupt
      setTimeout(() => {
        load(true)
        addEvent('queue.interrupt', serverUrl)
      }, 1200)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Interrupt failed'
      addToast(message, 'error')
    } finally {
      setActioning(false)
    }
  }, [serverUrl, load, addToast, addEvent])

  const handleFree = useCallback(async (mode: 'unload' | 'memory') => {
    setFreeing(mode)
    const vramBefore = health?.systemInfo?.vramFree
    try {
      await freeComfyServer(serverUrl, {
        unloadModels: mode === 'unload',
        freeMemory: mode === 'memory',
      })
      // Wait for ComfyUI to process, then re-check health to get updated VRAM
      await new Promise((r) => setTimeout(r, 1500))
      let vramAfter: number | undefined
      try {
        const res = await fetchWithAuth('/api/servers/health-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl }),
        })
        if (res.ok) {
          const d = await res.json()
          vramAfter = d.systemInfo?.vramFree
          if (d.systemInfo) setHealth({ healthy: d.healthy, latencyMs: d.latencyMs, systemInfo: d.systemInfo })
        }
      } catch { /* ignore health fetch failure */ }

      const label = mode === 'unload' ? 'Models unloaded' : 'Memory freed'
      let message: string
      if (vramBefore != null && vramAfter != null) {
        const delta = vramAfter - vramBefore
        const deltaStr = delta > 0 ? ` (+${formatBytes(delta)} reclaimed)` : delta < 0 ? ` (${formatBytes(-delta)} more used)` : ''
        message = `${label} — VRAM free: ${formatBytes(vramBefore)} → ${formatBytes(vramAfter)}${deltaStr}`
      } else {
        message = `${label} successfully`
      }
      addToast(message, 'success')
      addEvent('vram.free', mode + ' on ' + displayServerName(serverUrl, aliases))
      load(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed'
      addToast(message, 'error')
    } finally {
      setFreeing(null)
    }
  }, [serverUrl, load, health, addToast, addEvent])

  const handleRestart = useCallback(async () => {
    setRestarting(true)
    try {
      await restartServer(serverUrl)
      addToast('ComfyUI restarting…', 'success')
      addEvent('server.restart', serverUrl)
      // Re-fetch after a short delay to reflect new state
      setTimeout(() => load(true), 3000)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Restart failed', 'error')
    } finally {
      setRestarting(false)
    }
  }, [serverUrl, load, addToast, addEvent])

  const handleDelete = useCallback(async (id: string) => {
    setActioning(true)
    try {
      await deleteComfyQueueJobs(serverUrl, [id])
      setPending((p) => p.filter((j) => j.promptId !== id))
      addEvent('queue.delete', id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      addToast(message, 'error')
    } finally {
      setActioning(false)
    }
  }, [serverUrl, addToast, addEvent])

  const handleViewLogs = useCallback((promptJob: ComfyQueueJob) => {
    const bullJobId = promptToBullMap[promptJob.promptId]
    if (bullJobId) {
      setLogsJobId(bullJobId)
    } else {
      addToast(`No Bull job found for prompt ${promptJob.promptId.slice(0, 8)}… — logs may not be available yet`, 'error')
    }
  }, [promptToBullMap, addToast])

  const sys = health?.systemInfo
  const totalJobs = running.length + pending.length

  const modal = createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-default rounded-xl flex flex-col overflow-hidden shadow-2xl w-full"
        style={{ maxWidth: 'min(680px, 96vw)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-default shrink-0">
          <Activity size={18} className="text-muted shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-primary truncate">{displayServerName(serverUrl, aliases)}</p>
            <p className="text-xs text-muted font-mono truncate">{serverUrl}</p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading || actioning || freeing !== null}
            className="flex items-center gap-1 px-2 py-[0.3rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer hover:text-primary transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setLogsServerOpen(true)}
            className="flex items-center gap-1 px-2 py-[0.3rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer hover:text-primary transition-colors"
          >
            <FileText size={13} />
            Logs
          </button>
          <div ref={actionsMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowActionsMenu((v) => !v)}
              disabled={loading || actioning || freeing !== null || restarting}
              title="Server actions"
              className="flex items-center justify-center w-7 h-7 bg-tertiary border border-default rounded-md text-muted cursor-pointer hover:text-primary hover:bg-[#2a3a4a] transition-colors disabled:opacity-40"
            >
              {(freeing !== null || restarting) ? <Loader2 size={13} className="animate-spin" /> : <MoreHorizontal size={14} />}
            </button>
            {showActionsMenu && (
              <div className="absolute right-0 top-full mt-1 z-10 w-44 bg-secondary border border-default rounded-lg shadow-xl py-1 text-sm">
                <button
                  type="button"
                  onClick={() => { handleFree('unload'); setShowActionsMenu(false) }}
                  disabled={freeing !== null}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-muted hover:text-amber-400 hover:bg-[#2a3a4a] transition-colors disabled:opacity-40"
                >
                  <HardDriveDownload size={13} /> Unload models
                </button>
                <button
                  type="button"
                  onClick={() => { handleFree('memory'); setShowActionsMenu(false) }}
                  disabled={freeing !== null}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-muted hover:text-sky-400 hover:bg-[#2a3a4a] transition-colors disabled:opacity-40"
                >
                  <Wind size={13} /> Free VRAM
                </button>
                <div className="my-1 border-t border-default" />
                <button
                  type="button"
                  onClick={() => { handleRestart(); setShowActionsMenu(false) }}
                  disabled={restarting}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-muted hover:text-orange-400 hover:bg-[#2a3a4a] transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={13} /> Restart ComfyUI
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted hover:bg-tertiary hover:text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">

          {/* System info strip */}
          {sys && (
            <div className="px-5 py-4 border-b border-default flex flex-col gap-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                {sys.gpuName && (
                  <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
                    <Cpu size={13} className="text-muted shrink-0" />
                    <span className="text-sm text-primary truncate" title={sys.gpuName}>{sys.gpuName}</span>
                  </div>
                )}
                {sys.comfyVersion && (
                  <div className="text-sm text-muted">
                    ComfyUI <span className="text-primary">{sys.comfyVersion}</span>
                  </div>
                )}
                {health?.latencyMs != null && (
                  <div className="flex items-center gap-1 text-sm text-muted">
                    <Zap size={12} className="shrink-0" />
                    <span className="text-primary tabular-nums">{health.latencyMs}ms</span>
                  </div>
                )}
              </div>
              {sys.vramTotal && sys.vramFree != null && (
                <VramBar vramTotal={sys.vramTotal} vramFree={sys.vramFree} />
              )}
            </div>
          )}

          {/* Queue */}
          <div className="px-5 pt-4 pb-2 flex items-center gap-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted flex-1">
              Queue
            </span>
            {totalJobs > 0 && (
              <span className="text-xs text-muted tabular-nums">{totalJobs} job{totalJobs !== 1 ? 's' : ''}</span>
            )}
          </div>

          {loading && running.length === 0 && pending.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-muted">Loading…</div>
          ) : totalJobs === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-muted">Queue is empty</div>
          ) : (
            <div className="border border-default rounded-lg mx-5 mb-5 overflow-hidden">
              {running.map((job) => (
                <JobRow
                  key={job.promptId}
                  job={job}
                  type="running"
                  onInterrupt={handleInterrupt}
                  onDelete={handleDelete}
                  onViewLogs={handleViewLogs}
                  onViewServerLogs={() => setLogsServerOpen(true)}
                  bullJobId={promptToBullMap[job.promptId]}
                  startedAt={startedAtMapRef.current[job.promptId] ?? loadedAtRef.current}
                  actioning={actioning}
                />
              ))}
              {pending.map((job) => (
                <JobRow
                  key={job.promptId}
                  job={job}
                  type="pending"
                  onInterrupt={handleInterrupt}
                  onDelete={handleDelete}
                  startedAt={loadedAtRef.current}
                  actioning={actioning}
                />
              ))}
            </div>
          )}

          {/* Recent jobs on this server */}
          <div className="px-5 pt-4 pb-2 flex items-center gap-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted flex-1">
              Recent Jobs
            </span>
            {recentJobs.length > 0 && (
              <span className="text-xs text-muted tabular-nums">last {recentJobs.length}</span>
            )}
          </div>

          {recentLoading ? (
            <div className="flex items-center justify-center h-16 text-sm text-muted">Loading…</div>
          ) : recentJobs.length === 0 ? (
            <div className="flex items-center justify-center h-16 text-sm text-muted mb-4">No recent jobs found</div>
          ) : (
            <div className="border border-default rounded-lg mx-5 mb-5 overflow-hidden">
              {recentJobs.map((job) => {
                const cls = job.status === 'failed' && job.failedReason
                  ? classifyFailure(job.failedReason)
                  : null
                return (
                  <div key={job.id} className="flex items-center gap-3 px-4 py-[0.45rem] border-b border-default last:border-b-0 hover:bg-tertiary/30 transition-colors">
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap">
                        {job.name || '—'}
                      </span>
                      <span className="text-[11px] text-muted">
                        {job.user || '—'} · {formatAgo(job.finishedOn)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs tabular-nums font-medium ${durationColorClass(job.duration)}`}>
                        {formatDur(job.duration)}
                      </span>
                      {job.status === 'failed' ? (
                        cls ? (
                          <span
                            className={`inline-flex items-center gap-[2px] px-[5px] py-[1px] rounded border text-[10px] font-semibold ${cls.colorClass}`}
                            title={job.failedReason ?? undefined}
                          >
                            {cls.icon} {cls.label}
                          </span>
                        ) : (
                          <span className="px-[5px] py-[1px] rounded text-[10px] font-semibold bg-red-400/10 text-red-400 border border-red-400/20">
                            Failed
                          </span>
                        )
                      ) : (
                        <span className="px-[5px] py-[1px] rounded text-[10px] font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                          OK
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* User usage breakdown */}
          {userUsage.length > 0 && (
            <div className="px-5 pt-4 pb-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted flex-1">Usage by User</span>
                <span className="text-xs text-muted tabular-nums">{userTotal.toLocaleString()} jobs · last 30d</span>
              </div>
              <div className="flex flex-col gap-2">
                {userUsage.map((u) => {
                  const colorIdx = Math.abs(u.user.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)) % USER_COLORS.length
                  const color = USER_COLORS[colorIdx]
                  return (
                    <div key={u.user} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap" title={u.user}>
                          {u.user}
                        </span>
                        <span className="text-xs tabular-nums text-muted shrink-0">{u.count.toLocaleString()} · {u.pct}%</span>
                      </div>
                      <div className="h-[5px] rounded-full bg-[rgba(45,58,74,0.5)] overflow-hidden">
                        <div className="h-full rounded-full transition-[width]" style={{ width: `${u.pct}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )

  return (
    <>
      {modal}
      {logsJobId && (
        <UnifiedJobModal
          jobId={logsJobId}
          onClose={() => setLogsJobId(null)}
        />
      )}
      {logsServerOpen && (
        <ServerLogsModal serverUrl={serverUrl} onClose={() => setLogsServerOpen(false)} />
      )}
    </>
  )
}
