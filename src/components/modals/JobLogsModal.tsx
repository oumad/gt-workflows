import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, FileText, Copy, Check } from 'lucide-react'
import { getJobLogs, type CompletedJobSummary } from '@/services/api/stats'

interface JobLogsModalProps {
  jobId: string
  job?: CompletedJobSummary
  onClose: () => void
}

const CLS_PRE = 'm-0 px-3 py-[0.6rem] bg-primary border border-default rounded-lg text-sm leading-[1.55] text-primary font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-[300px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm'
const CLS_SECTION_TITLE = 'text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted m-0'

export default function JobLogsModal({ jobId, job, onClose }: JobLogsModalProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)

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

  const logText = logs.length > 0 ? logs.join('\n') : 'No log entries.'

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(logText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [logText])

  const jobDataJson = job ? JSON.stringify(job, null, 2) : null

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
              <pre className={CLS_PRE}>{logText}</pre>
            )}
          </div>

          {/* Job data collapsible */}
          {jobDataJson && (
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
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
