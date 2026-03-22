import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Server, RefreshCw } from 'lucide-react'
import { getQueueStatsWithJobLists } from '@/services/api/stats'
import type { ActivityJob } from '@/services/api/stats'
import './ServerJobsModal.css'

function JobMiniCard({ job, variant }: { job: ActivityJob; variant: 'active' | 'waiting' }) {
  return (
    <div className={`server-job-mini-card server-job-mini-card--${variant}`}>
      <span className="server-job-mini-name" title={job.name}>{job.name || '—'}</span>
      <span className="server-job-mini-user" title={job.user}>{job.user}</span>
      <span className="server-job-mini-id" title={`Job ID: ${job.id}`}>{job.id}</span>
    </div>
  )
}

interface ServerJobsModalProps {
  serverUrl: string
  serverAliases: Record<string, string>
  onClose: () => void
}

export default function ServerJobsModal({ serverUrl, serverAliases, onClose }: ServerJobsModalProps) {
  const norm = serverUrl.replace(/\/$/, '')
  const serverName = serverAliases[norm] || serverAliases[serverUrl]
  const bareUrl = norm.replace(/^https?:\/\//, '')

  const [active, setActive] = useState<ActivityJob[]>([])
  const [waiting, setWaiting] = useState<ActivityJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await getQueueStatsWithJobLists()
      if (!res.configured) {
        setError('Activity queue is not configured (set REDIS_URL in server env)')
        return
      }
      const matchesServer = (j: ActivityJob) => j.server?.replace(/\/$/, '') === norm
      setActive((res.active ?? []).filter(matchesServer))
      setWaiting((res.waiting ?? []).filter(matchesServer))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [norm])

  useEffect(() => { load() }, [load])

  const total = active.length + waiting.length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content server-jobs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="server-jobs-title">
            <Server size={20} />
            <div className="server-jobs-title-info">
              {serverName && <span className="server-jobs-title-name">{serverName}</span>}
              <span className="server-jobs-title-url">{bareUrl}</span>
            </div>
            {!loading && !error && (
              <span className="server-jobs-count">{total} job{total !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="server-jobs-header-actions">
            <button type="button" className="btn btn-toolbar" onClick={load} disabled={loading} title="Refresh">
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="server-jobs-body">
          {error ? (
            <div className="server-jobs-error">{error}</div>
          ) : loading && total === 0 ? (
            <div className="server-jobs-loading">
              <span className="server-jobs-spinner" />
            </div>
          ) : (
            <div className="server-jobs-columns">
              <section className="server-jobs-section server-jobs-section--active">
                <h3 className="server-jobs-section-title">
                  Active <span className="server-jobs-section-count">{active.length}</span>
                </h3>
                <div className="server-jobs-list">
                  {active.length === 0
                    ? <p className="server-jobs-empty">No active jobs</p>
                    : active.map((j) => <JobMiniCard key={j.id} job={j} variant="active" />)
                  }
                </div>
              </section>
              <section className="server-jobs-section server-jobs-section--waiting">
                <h3 className="server-jobs-section-title">
                  Waiting <span className="server-jobs-section-count">{waiting.length}</span>
                </h3>
                <div className="server-jobs-list">
                  {waiting.length === 0
                    ? <p className="server-jobs-empty">No waiting jobs</p>
                    : waiting.map((j) => <JobMiniCard key={j.id} job={j} variant="waiting" />)
                  }
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
