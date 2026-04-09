import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Square, Trash2, Clock, Loader2, FileText, Activity } from 'lucide-react'
import {
  fetchComfyQueue,
  interruptComfyServer,
  deleteComfyQueueJobs,
  type ComfyQueueJob,
} from '@/services/api/servers'
import { getPromptMap } from '@/services/api/stats'
import { useToast } from '@/contexts/ToastContext'
import { useIncidentTimeline } from '@/contexts/IncidentTimelineContext'

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

export interface ServerQueuePanelHandle {
  refresh: () => void
}

interface ServerQueuePanelProps {
  serverUrl: string
  onViewLogs: (jobId: string) => void
  onViewServerLogs: () => void
}

export const ServerQueuePanel = forwardRef<ServerQueuePanelHandle, ServerQueuePanelProps>(
  ({ serverUrl, onViewLogs, onViewServerLogs }, ref) => {
    const { addToast } = useToast()
    const { addEvent } = useIncidentTimeline()
    const [running, setRunning] = useState<ComfyQueueJob[]>([])
    const [pending, setPending] = useState<ComfyQueueJob[]>([])
    const [loading, setLoading] = useState(true)
    const [actioning, setActioning] = useState(false)
    const [promptToBullMap, setPromptToBullMap] = useState<Record<string, string>>({})
    const loadedAtRef = useRef(Date.now())
    const startedAtMapRef = useRef<Record<string, number>>({})
    const abortRef = useRef<AbortController | null>(null)

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
    }, [serverUrl, addToast])

    useEffect(() => {
      load()
      const id = setInterval(() => load(true), 5000)
      return () => {
        clearInterval(id)
        abortRef.current?.abort()
      }
    }, [load])

    useImperativeHandle(ref, () => ({ refresh: () => load() }), [load])

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
        onViewLogs(bullJobId)
      } else {
        addToast(`No Bull job found for prompt ${promptJob.promptId.slice(0, 8)}… — logs may not be available yet`, 'error')
      }
    }, [promptToBullMap, onViewLogs, addToast])

    const totalJobs = running.length + pending.length

    return (
      <>
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
                onViewServerLogs={onViewServerLogs}
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
      </>
    )
  }
)

ServerQueuePanel.displayName = 'ServerQueuePanel'
