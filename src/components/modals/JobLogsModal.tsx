import { useState, useEffect, useCallback } from 'react'
import { X, RefreshCw, FileText } from 'lucide-react'
import { getJobLogs } from '@/services/api/stats'
import './JobLogsModal.css'

interface JobLogsModalProps {
  jobId: string
  onClose: () => void
}

export default function JobLogsModal({ jobId, onClose }: JobLogsModalProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    load()
  }, [load])

  const logText = logs.length > 0 ? logs.join('\n') : 'No log entries.'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content job-logs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="job-logs-header">
          <div className="job-logs-title">
            <FileText size={20} />
            <span>Job logs</span>
            <span className="job-logs-job-id" title={jobId}>{jobId}</span>
          </div>
          <div className="job-logs-actions">
            <button
              type="button"
              className="btn btn-toolbar"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button type="button" className="job-logs-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="job-logs-body">
          {loading && logs.length === 0 ? (
            <div className="job-logs-loading">Loading logs…</div>
          ) : error ? (
            <div className="job-logs-error">{error}</div>
          ) : (
            <pre className="job-logs-pre">{logText}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
