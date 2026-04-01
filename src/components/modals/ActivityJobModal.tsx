import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, FileText, RefreshCw, Copy, Check } from 'lucide-react'
import { getJobLogs, type ActivityJob } from '@/services/api/stats'

interface ActivityJobModalProps {
  job: ActivityJob
  onClose: () => void
}

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [text])
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 px-2 py-[0.25rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a]"
      onClick={copy}
      title="Copy to clipboard"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

const CLS_LABEL = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted'
const CLS_VALUE = 'text-sm text-primary font-mono break-all'
const CLS_SECTION_TITLE = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted m-0'
const CLS_PRE = 'm-0 px-3 py-[0.6rem] bg-primary border border-default rounded-lg text-sm leading-[1.55] text-primary font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-[260px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm'

export default function ActivityJobModal({ job, onClose }: ActivityJobModalProps) {
  const [logs, setLogs] = useState<string[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [dataOpen, setDataOpen] = useState(false)

  const isActive = job.finishedOn == null
  const statusLabel = job.failedReason ? 'Failed' : isActive ? 'Running' : 'Completed'
  const statusCls = job.failedReason
    ? 'text-semantic-error bg-semantic-error/[0.1] border-semantic-error/25'
    : isActive
      ? 'text-semantic-success bg-semantic-success/[0.1] border-semantic-success/25'
      : 'text-muted bg-tertiary border-default'

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const res = await getJobLogs(job.id)
      if (res.error) setLogsError(res.error)
      else setLogs(res.logs ?? [])
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : 'Failed to load logs')
    } finally {
      setLogsLoading(false)
    }
  }, [job.id])

  // Build a clean display object (omit internal keys)
  const jobDataJson = JSON.stringify(
    job.data ?? {
      id: job.id,
      name: job.name,
      server: job.server,
      user: job.user,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      timestamp: job.timestamp,
      timeout: job.timeout,
      failedReason: job.failedReason,
    },
    null,
    2
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-secondary border border-default rounded-xl flex flex-col overflow-hidden shadow-2xl w-full"
        style={{ maxWidth: 'min(1100px, 96vw)', maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-default shrink-0">
          <FileText size={18} className="text-muted shrink-0" />
          <span className="text-base font-semibold text-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {job.name || 'Job Details'}
          </span>
          <span className="text-sm font-mono text-muted shrink-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap hidden sm:block" title={job.id}>
            #{job.id}
          </span>
          <span className={`inline-flex items-center px-2 py-[0.15rem] rounded-full text-sm font-medium border shrink-0 ${statusCls}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-none text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary shrink-0"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">

          {/* Meta grid */}
          <div className="grid [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {[
              { label: 'Workflow', value: job.name || '—' },
              { label: 'Server', value: job.server || '—' },
              { label: 'User', value: job.user || '—' },
              { label: 'Status', value: statusLabel },
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

          {/* Failed reason */}
          {job.failedReason && (
            <div className="flex flex-col gap-[0.35rem]">
              <div className="flex items-center justify-between gap-2">
                <h3 className={CLS_SECTION_TITLE}>Error</h3>
                <CopyButton text={job.failedReason} />
              </div>
              <pre className={`${CLS_PRE} text-semantic-error border-semantic-error/25 bg-semantic-error/[0.04]`}>
                {job.failedReason}
              </pre>
            </div>
          )}

          {/* Logs */}
          <div className="flex flex-col gap-[0.35rem]">
            <div className="flex items-center justify-between gap-2">
              <h3 className={CLS_SECTION_TITLE}>Logs</h3>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-[0.25rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a] disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={loadLogs}
                disabled={logsLoading}
              >
                <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
                {logs === null && !logsLoading ? 'Load' : 'Refresh'}
              </button>
            </div>
            {logsLoading ? (
              <p className="text-sm text-muted m-0 py-1">Loading logs…</p>
            ) : logsError ? (
              <p className="text-sm text-semantic-error m-0">{logsError}</p>
            ) : logs === null ? (
              <p className="text-sm text-muted m-0">Click Load to fetch job logs.</p>
            ) : logs.length > 0 ? (
              <pre className={CLS_PRE}>{logs.join('\n')}</pre>
            ) : (
              <p className="text-sm text-muted m-0">No log entries.</p>
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
                Job Data {dataOpen ? '▲' : '▼'}
              </h3>
            </button>
            {dataOpen && (
              <pre className={CLS_PRE}>{jobDataJson}</pre>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
