import { useState, useCallback, type ReactElement } from 'react'
import { X, FileText, RefreshCw, Copy, Check } from 'lucide-react'
import { getJobLogs, type FailedJobSummary } from '@/services/api/stats'
import { SearchableLogLines, ColoredJsonPre } from '@/components/logs/LogPrimitives'

interface FailedJobModalProps {
  job: FailedJobSummary
  onClose: () => void
}

function formatTs(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString()
}

function formatDuration(start: number | null, end: number | null): string {
  if (start == null || end == null) return '—'
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function CopyButton({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button type="button" className="btn btn-toolbar btn-sm" onClick={copy} title="Copy to clipboard">
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

export default function FailedJobModal({ job, onClose }: FailedJobModalProps): ReactElement {
  const [logs, setLogs] = useState<string[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

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

  const errorText = job.failedReason ?? ''
  const stackText = job.stacktrace.join('\n')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content failed-job-modal" onClick={(e) => e.stopPropagation()}>
        <div className="failed-job-modal-header">
          <div className="failed-job-modal-title">
            <FileText size={20} />
            <span>{job.name || 'Failed Job'}</span>
            <span className="failed-job-modal-id" title={job.id}>#{job.id}</span>
          </div>
          <button type="button" className="failed-job-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="failed-job-modal-body">
          <div className="failed-job-meta-grid">
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Workflow</span>
              <span className="failed-job-meta-value">{job.name || '—'}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Server</span>
              <span className="failed-job-meta-value">{job.server}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">User</span>
              <span className="failed-job-meta-value">{job.user}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Attempts</span>
              <span className="failed-job-meta-value">{job.attemptsMade}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Created</span>
              <span className="failed-job-meta-value">{formatTs(job.timestamp)}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Started</span>
              <span className="failed-job-meta-value">{formatTs(job.processedOn)}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Failed at</span>
              <span className="failed-job-meta-value">{formatTs(job.finishedOn)}</span>
            </div>
            <div className="failed-job-meta-item">
              <span className="failed-job-meta-label">Duration</span>
              <span className="failed-job-meta-value">{formatDuration(job.processedOn, job.finishedOn)}</span>
            </div>
          </div>

          {errorText && (
            <div className="failed-job-section">
              <div className="failed-job-section-header">
                <h3 className="failed-job-section-title">Error</h3>
                <CopyButton text={errorText} />
              </div>
              <pre className="failed-job-pre failed-job-pre--error">{errorText}</pre>
            </div>
          )}

          {job.stacktrace.length > 0 && (
            <div className="failed-job-section">
              <div className="failed-job-section-header">
                <h3 className="failed-job-section-title">Stacktrace</h3>
                <CopyButton text={stackText} />
              </div>
              <pre className="failed-job-pre">{stackText}</pre>
            </div>
          )}

          <div className="failed-job-section">
            <div className="failed-job-section-header">
              <h3 className="failed-job-section-title">Logs</h3>
              <button type="button" className="btn btn-toolbar btn-sm" onClick={loadLogs} disabled={logsLoading}>
                <RefreshCw size={14} className={logsLoading ? 'spin' : ''} />
                {logs === null && !logsLoading ? 'Load' : ''}
              </button>
            </div>
            {logsLoading ? (
              <div className="failed-job-logs-loading">Loading logs…</div>
            ) : logsError ? (
              <div className="failed-job-logs-error">{logsError}</div>
            ) : logs === null ? (
              <p className="failed-job-logs-empty">Click load to fetch job logs.</p>
            ) : logs.length > 0 ? (
              <SearchableLogLines lines={logs} maxHeight="240px" autoScroll />
            ) : (
              <p className="failed-job-logs-empty">No log entries.</p>
            )}
          </div>

          <details className="failed-job-section">
            <summary className="failed-job-section-title failed-job-details-summary">Job Data</summary>
            <ColoredJsonPre json={JSON.stringify(job.data, null, 2)} maxHeight="240px" />
          </details>
        </div>
      </div>
    </div>
  )
}
