import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, FileText, Copy, Check } from 'lucide-react'
import { getJobLogs, getJobFullData, type CompletedJobSummary, type JobFullData } from '@/services/api/stats'
import { durationColorClass } from '@/utils/failureClassifier'
import { SearchableLogLines, ColoredJsonPre } from '@/components/logs/LogPrimitives'
import { shortServerUrl } from '@/utils/serverDisplay'

interface JobLogsModalProps {
  jobId: string
  job?: CompletedJobSummary
  onClose: () => void
}

const CLS_SECTION_TITLE = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted m-0'

export default function JobLogsModal({ jobId, job, onClose }: JobLogsModalProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dataOpen, setDataOpen] = useState(true)
  const [fullData, setFullData] = useState<JobFullData | null>(null)
  const [fullDataLoading, setFullDataLoading] = useState(true)
  const [fullDataError, setFullDataError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getJobLogs(jobId)
      if (res.error) {
        setError(res.error)
        setLogs([])
      } else {
        setLogs(res.logs ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    setFullDataLoading(true)
    setFullDataError(null)
    getJobFullData(jobId)
      .then((d) => { if (!cancelled) setFullData(d) })
      .catch((err) => { if (!cancelled) setFullDataError(err instanceof Error ? err.message : 'Failed to load job data') })
      .finally(() => { if (!cancelled) setFullDataLoading(false) })
    return () => { cancelled = true }
  }, [jobId])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(logs.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [logs])

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
          <span className="text-base font-semibold text-primary flex-1 min-w-0">
            {job?.name ? job.name : 'Job Logs'}
          </span>
          <span
            className="text-sm font-mono text-muted max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap hidden sm:block"
            title={jobId}
          >
            #{jobId}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-[0.3rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleCopy}
            disabled={loading || logs.length === 0}
            title="Copy all logs"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-[0.3rem] bg-tertiary border border-default rounded-md text-muted text-sm cursor-pointer transition-all duration-150 hover:text-primary hover:bg-[#2d3a4a] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={load}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-md bg-transparent border-none text-muted cursor-pointer transition-all duration-150 hover:bg-tertiary hover:text-primary"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Metadata strip */}
        {job && (
          <div className="flex items-center gap-4 px-5 py-[0.55rem] border-b border-default/50 bg-[rgba(36,48,68,0.3)] text-sm flex-wrap shrink-0">
            {job.server && job.server !== '—' && (
              <span className="inline-flex items-center gap-[0.35rem]">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">Server</span>
                <span className="font-mono text-xs text-primary" title={job.server}>{shortServerUrl(job.server)}</span>
              </span>
            )}
            {job.user && job.user !== '—' && (
              <span className="inline-flex items-center gap-[0.35rem]">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">User</span>
                <span className="text-primary">{job.user}</span>
              </span>
            )}
            {job.status && (
              <span className="inline-flex items-center gap-[0.35rem]">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">Status</span>
                <span className={job.status === 'completed' ? 'text-emerald-400' : job.status === 'failed' ? 'text-red-400' : 'text-primary'}>
                  {job.status}
                </span>
              </span>
            )}
            {(() => {
              const total = (job.finishedOn != null && job.timestamp != null) ? job.finishedOn - job.timestamp : null
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
            {job.duration != null && (
              <span className="inline-flex items-center gap-[0.35rem]" title="ComfyUI processing time only">
                <span className="text-muted text-xs uppercase tracking-[0.04em]">Gen</span>
                <span className={`tabular-nums font-medium ${durationColorClass(job.duration)}`}>
                  {job.duration < 1000 ? `${job.duration}ms` : (() => { const s = Math.round(job.duration! / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s` })()}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">

          {/* Logs section */}
          <div className="flex flex-col gap-[0.35rem]">
            <h3 className={CLS_SECTION_TITLE}>Logs</h3>
            {loading && logs.length === 0 ? (
              <p className="text-sm text-muted m-0">Loading logs…</p>
            ) : error ? (
              <p className="text-sm text-semantic-error m-0">{error}</p>
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
