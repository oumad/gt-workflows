import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, FileText, RefreshCw, Copy, Check } from 'lucide-react'
import { getJobLogs, getJobFullData, type ActivityJob, type CompletedJobSummary, type JobFullData } from '@/services/api/stats'
import { durationColorClass } from '@/utils/failureClassifier'
import { SearchableLogLines, ColoredJsonPre } from '@/components/logs/LogPrimitives'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'

export interface UnifiedJobModalProps {
  // Provide EITHER job (full ActivityJob) OR jobId + optional jobSummary
  job?: ActivityJob           // full job object from Activity view
  jobId?: string              // Bull job ID — used when opening from ServerDetailModal or SlowJobsPanel
  jobSummary?: CompletedJobSummary  // optional summary metadata when only jobId is known
  onClose: () => void
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString()
}

function formatDuration(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null || end == null) return '—'
  const ms = end - start
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatElapsed(processedOn: number | null | undefined): string {
  if (processedOn == null) return '—'
  const elapsed = Date.now() - processedOn
  if (elapsed < 0) return '—'
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s`
  const m = Math.floor(elapsed / 60_000)
  if (m < 60) return `${m}m ${Math.floor((elapsed % 60_000) / 1000)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function formatTimeout(seconds: number | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// ── style constants ───────────────────────────────────────────────────────────

const CLS_LABEL = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted'
const CLS_VALUE = 'text-sm text-primary font-mono break-all'
const CLS_SECTION_TITLE = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted m-0'
const CLS_PRE = 'm-0 px-3 py-[0.6rem] bg-primary border border-default rounded-lg text-sm leading-[1.55] text-primary font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-[260px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm'

// ── main component ────────────────────────────────────────────────────────────

export default function UnifiedJobModal({ job, jobId, jobSummary, onClose }: UnifiedJobModalProps) {
  const resolvedJobId = job?.id ?? jobId ?? ''
  const aliases = useServerAliases()

  // Logs state
  const [logs, setLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logsCopied, setLogsCopied] = useState(false)

  // Full job data state
  const [fullData, setFullData] = useState<JobFullData | null>(null)
  const [fullDataLoading, setFullDataLoading] = useState(true)
  const [fullDataError, setFullDataError] = useState<string | null>(null)
  const [dataOpen, setDataOpen] = useState(true)

  // Load logs
  const loadLogs = useCallback(async () => {
    if (!resolvedJobId) return
    setLogsLoading(true)
    setLogsError(null)
    try {
      const res = await getJobLogs(resolvedJobId)
      if (res.error) {
        setLogsError(res.error)
        setLogs([])
      } else {
        setLogs(res.logs ?? [])
      }
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : 'Failed to load logs')
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }, [resolvedJobId])

  // Auto-load logs on mount
  useEffect(() => { loadLogs() }, [loadLogs])

  // Fetch full job data on mount
  useEffect(() => {
    if (!resolvedJobId) return
    let cancelled = false
    setFullDataLoading(true)
    setFullDataError(null)
    getJobFullData(resolvedJobId)
      .then((d) => { if (!cancelled) setFullData(d) })
      .catch((err) => { if (!cancelled) setFullDataError(err instanceof Error ? err.message : 'Failed to load job data') })
      .finally(() => { if (!cancelled) setFullDataLoading(false) })
    return () => { cancelled = true }
  }, [resolvedJobId])

  const handleCopyLogs = useCallback(() => {
    navigator.clipboard.writeText(logs.join('\n')).then(() => {
      setLogsCopied(true)
      setTimeout(() => setLogsCopied(false), 2000)
    }).catch(() => {})
  }, [logs])

  // Derive status from the full ActivityJob when available
  const isActive = job ? job.finishedOn == null : false
  const statusLabel = job
    ? (job.failedReason ? 'Failed' : isActive ? 'Running' : 'Completed')
    : (jobSummary?.status ?? null)
  const statusCls = job
    ? (job.failedReason
        ? 'text-semantic-error bg-semantic-error/[0.1] border-semantic-error/25'
        : isActive
          ? 'text-semantic-success bg-semantic-success/[0.1] border-semantic-success/25'
          : 'text-muted bg-tertiary border-default')
    : null

  // Display name: prefer job.name, then jobSummary.name, then 'Job Logs'
  const displayName = job?.name || jobSummary?.name || 'Job Logs'

  // Build job data JSON for the collapsible panel
  const jobDataJson = fullData?.data != null
    ? JSON.stringify(fullData.data, null, 2)
    : fullData != null
      ? JSON.stringify(fullData, null, 2)
      : null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-default rounded-xl flex flex-col overflow-hidden shadow-2xl w-full"
        style={{ maxWidth: 'min(1100px, 96vw)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-default shrink-0">
          <FileText size={18} className="text-muted shrink-0" />
          <span className="text-base font-semibold text-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {displayName}
          </span>
          <span
            className="text-sm font-mono text-muted shrink-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap hidden sm:block"
            title={resolvedJobId}
          >
            #{resolvedJobId}
          </span>
          {statusLabel && statusCls && (
            <span className={`inline-flex items-center px-2 py-[0.15rem] rounded-full text-sm font-medium border shrink-0 ${statusCls}`}>
              {statusLabel}
            </span>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-[0.3rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleCopyLogs}
            disabled={logsLoading || logs.length === 0}
            title="Copy all logs"
          >
            {logsCopied ? <Check size={13} /> : <Copy size={13} />}
            {logsCopied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-[0.3rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={loadLogs}
            disabled={logsLoading}
            title="Refresh logs"
          >
            <RefreshCw size={13} className={logsLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-none text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary shrink-0"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Metadata — full 8-field grid when ActivityJob is available */}
        {job && (
          <div className="px-5 pt-5 pb-0">
            <div className="grid [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {[
                { label: 'Workflow', value: job.name || '—' },
                { label: 'Server', value: job.server || '—' },
                { label: 'User', value: job.user || '—' },
                { label: 'Status', value: statusLabel ?? '—' },
                { label: 'Started', value: formatTs(job.processedOn) },
                { label: 'Created', value: formatTs(job.timestamp) },
                { label: 'Timeout', value: formatTimeout(job.timeout) },
                {
                  label: isActive ? 'Elapsed' : 'Duration',
                  value: isActive ? formatElapsed(job.processedOn) : formatDuration(job.processedOn, job.finishedOn),
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-[0.2rem]">
                  <span className={CLS_LABEL}>{label}</span>
                  <span className={CLS_VALUE}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata — compact strip when only summary is available */}
        {!job && jobSummary && (
          <div className="flex items-center gap-4 px-5 py-[0.55rem] border-b border-default/50 bg-[rgba(36,48,68,0.3)] text-sm flex-wrap shrink-0">
            {jobSummary.server && jobSummary.server !== '—' && (
              <span className="inline-flex items-center gap-[0.35rem]">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">Server</span>
                <span className="font-mono text-xs text-primary" title={jobSummary.server}>{displayServerName(jobSummary.server, aliases)}</span>
              </span>
            )}
            {jobSummary.user && jobSummary.user !== '—' && (
              <span className="inline-flex items-center gap-[0.35rem]">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">User</span>
                <span className="text-primary">{jobSummary.user}</span>
              </span>
            )}
            {jobSummary.status && (
              <span className="inline-flex items-center gap-[0.35rem]">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">Status</span>
                <span className={jobSummary.status === 'completed' ? 'text-emerald-400' : jobSummary.status === 'failed' ? 'text-red-400' : 'text-primary'}>
                  {jobSummary.status}
                </span>
              </span>
            )}
            {(() => {
              const total = (jobSummary.finishedOn != null && jobSummary.timestamp != null) ? jobSummary.finishedOn - jobSummary.timestamp : null
              if (total == null) return null
              const s = Math.floor(total / 1000)
              const fmt = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
              return (
                <span className="inline-flex items-center gap-[0.35rem]" title="Queue wait + generation time">
                  <span className="text-muted text-xs uppercase tracking-[0.04em]">Total</span>
                  <span className={`tabular-nums font-medium ${durationColorClass(total)}`}>{fmt}</span>
                </span>
              )
            })()}
            {jobSummary.duration != null && (
              <span className="inline-flex items-center gap-[0.35rem]" title="ComfyUI processing time only">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">Gen</span>
                <span className={`tabular-nums font-medium ${durationColorClass(jobSummary.duration)}`}>
                  {jobSummary.duration < 1000 ? `${jobSummary.duration}ms` : (() => { const s = Math.round(jobSummary.duration! / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s` })()}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">

          {/* Failed reason — only when full ActivityJob is available */}
          {job?.failedReason && (
            <div className="flex flex-col gap-[0.35rem]">
              <div className="flex items-center justify-between gap-2">
                <h3 className={CLS_SECTION_TITLE}>Error</h3>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-[0.25rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a]"
                  onClick={() => navigator.clipboard.writeText(job.failedReason!).catch(() => {})}
                  title="Copy to clipboard"
                >
                  <Copy size={12} />
                </button>
              </div>
              <pre className={`${CLS_PRE} text-semantic-error border-semantic-error/25 bg-semantic-error/[0.04]`}>
                {job.failedReason}
              </pre>
            </div>
          )}

          {/* Logs section */}
          <div className="flex flex-col gap-[0.35rem]">
            <h3 className={CLS_SECTION_TITLE}>Logs</h3>
            {logsLoading && logs.length === 0 ? (
              <p className="text-sm text-muted m-0">Loading logs…</p>
            ) : logsError ? (
              <p className="text-sm text-semantic-error m-0">{logsError}</p>
            ) : (
              <SearchableLogLines lines={logs} maxHeight="360px" autoScroll />
            )}
          </div>

          {/* Job data collapsible */}
          <div className="flex flex-col gap-[0.35rem]">
            <button
              type="button"
              className="flex items-center gap-2 bg-transparent border-none p-0 cursor-pointer text-left"
              onClick={() => setDataOpen((o) => !o)}
            >
              <h3 className={`${CLS_SECTION_TITLE} transition-colors hover:text-secondary`}>
                Job Data {dataOpen ? '▼' : '▶'}
              </h3>
            </button>
            {dataOpen && (
              fullDataLoading ? (
                <p className="text-sm text-muted m-0">Loading…</p>
              ) : fullDataError ? (
                <p className="text-sm text-semantic-error m-0">{fullDataError}</p>
              ) : jobDataJson ? (
                <ColoredJsonPre json={jobDataJson} maxHeight="300px" />
              ) : (
                <p className="text-sm text-muted m-0">No data.</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
