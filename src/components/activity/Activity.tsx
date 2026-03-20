import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Activity as ActivityIcon, Timer, TimerOff } from 'lucide-react'
import { getQueueStatsWithJobLists } from '@/services/api/stats'
import { useAuth } from '@/features/auth'
import type { ActivityJob, QueueStatsWithJobsResponse } from '@/services/api/stats'
import { formatDateTimeMedium } from '@/utils/dateFormat'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import './Activity.css'

const AUTO_INTERVALS = [5, 30, 60, 300, null] as const
type AutoInterval = 5 | 30 | 60 | 300 | null

const HOVER_FIELD_OPTIONS: { value: 'name' | 'user' | 'server'; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'user', label: 'User' },
  { value: 'server', label: 'Server' },
]

/** Format processedOn timestamp (ms) for display; returns "—" when missing or invalid. */
function formatProcessedOn(processedOn: number | null | undefined): { text: string; title: string } {
  if (processedOn == null) return { text: '—', title: '' }
  const ms = typeof processedOn === 'number' ? processedOn : Number(processedOn)
  if (!Number.isFinite(ms)) return { text: '—', title: '' }
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return { text: '—', title: '' }
  return { text: formatDateTimeMedium(ms), title: d.toISOString() }
}

function JobCard({
  job,
  variant,
  highlightMatch,
  onMouseEnter,
  onMouseLeave,
  onViewServerLogs,
}: {
  job: ActivityJob
  variant: 'active' | 'waiting'
  highlightMatch: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onViewServerLogs: (serverUrl: string) => void
}) {
  const processedOnDisplay = formatProcessedOn(job.processedOn)
  return (
    <div
      className={`activity-job-card activity-job-card--${variant}${highlightMatch ? ' activity-job-card--highlight' : ''}`}
      data-server={job.server}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="activity-job-card-row">
        <span className="activity-job-card-label">Job ID</span>
        <span className="activity-job-card-value activity-job-card-id">{job.id}</span>
      </div>
      <div className="activity-job-card-row">
        <span className="activity-job-card-label">Name</span>
        <span className="activity-job-card-value" title={job.name}>{job.name || '—'}</span>
      </div>
      <div className="activity-job-card-row">
        <span className="activity-job-card-label">User</span>
        <span className="activity-job-card-value" title={job.user}>{job.user}</span>
      </div>
      <div className="activity-job-card-row">
        <span className="activity-job-card-label">Server</span>
        <button
          type="button"
          className="activity-job-card-value activity-job-card-server activity-job-card-server-btn"
          title="View server logs"
          onClick={(e) => {
            e.stopPropagation()
            onViewServerLogs(job.server)
          }}
        >
          {job.server}
        </button>
      </div>
      <div className="activity-job-card-row">
        <span className="activity-job-card-label">Processed on</span>
        <span
          className="activity-job-card-value"
          title={processedOnDisplay.title || undefined}
        >
          {processedOnDisplay.text}
        </span>
      </div>
    </div>
  )
}

function getJobFieldValue(job: ActivityJob, field: 'name' | 'user' | 'server'): string {
  const v = job[field]
  return typeof v === 'string' ? v : (v ?? '')
}

function JobColumn({
  title,
  jobs,
  variant,
  hoverField,
  hoveredValue,
  setHoveredValue,
  onViewServerLogs,
}: {
  title: string
  jobs: ActivityJob[]
  variant: 'active' | 'waiting'
  hoverField: 'name' | 'user' | 'server'
  hoveredValue: string | null
  setHoveredValue: (value: string | null) => void
  onViewServerLogs: (serverUrl: string) => void
}) {
  return (
    <div className={`activity-column activity-column--${variant}`}>
      <h2 className="activity-column-title">{title}</h2>
      <div className="activity-column-cards">
        {jobs.length === 0 ? (
          <p className="activity-column-empty">No jobs</p>
        ) : (
          jobs.map((job) => {
            const fieldValue = getJobFieldValue(job, hoverField)
            const highlightMatch = hoveredValue != null && fieldValue === hoveredValue
            return (
              <JobCard
                key={`${variant}-${job.id}`}
                job={job}
                variant={variant}
                highlightMatch={highlightMatch}
                onMouseEnter={() => setHoveredValue(fieldValue)}
                onMouseLeave={() => setHoveredValue(null)}
                onViewServerLogs={onViewServerLogs}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

type ActivityData = {
  queueRes: QueueStatsWithJobsResponse | null
  error: string | null
}

export function Activity() {
  const { authStatus } = useAuth()
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoverField, setHoverField] = useState<'name' | 'user' | 'server'>('server')
  const [hoveredValue, setHoveredValue] = useState<string | null>(null)
  const [logModalServerUrl, setLogModalServerUrl] = useState<string | null>(null)
  const [autoInterval, setAutoInterval] = useState<AutoInterval>(null)

  const cycleAutoInterval = useCallback(() => {
    setAutoInterval((cur) => {
      const idx = AUTO_INTERVALS.indexOf(cur)
      return AUTO_INTERVALS[(idx + 1) % AUTO_INTERVALS.length]
    })
  }, [])

  const inFlightRef = useRef(false)
  const load = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    try {
      const queueRes = await getQueueStatsWithJobLists()
      setData({ queueRes, error: queueRes.error ?? null })
    } catch (err) {
      setData({
        queueRes: null,
        error: err instanceof Error ? err.message : 'Failed to load',
      })
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus !== 'ok') return
    load()
  }, [load, authStatus])

  // Stable ref so the interval doesn't reset when load changes
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])

  useEffect(() => {
    if (!autoInterval || authStatus !== 'ok') return
    const id = setInterval(() => { loadRef.current() }, autoInterval * 1000)
    return () => clearInterval(id)
  }, [autoInterval, authStatus])

  if (loading && !data) {
    return (
      <div className="activity-page">
        <div className="activity-loading">
          <span className="activity-loading-spinner" />
          <span>data is loading, please wait :)</span>
        </div>
      </div>
    )
  }

  const configured = data?.queueRes?.configured ?? false
  if (data && !configured) {
    return (
      <div className="activity-page">
        <div className="activity-not-configured">
          <p>Activity is not configured.</p>
          <p className="activity-hint">
            Set <code>REDIS_URL</code> (and optionally <code>BULL_QUEUE_NAME</code>) in the server environment.
          </p>
        </div>
      </div>
    )
  }

  const queueRes = data?.queueRes
  const activeJobs = queueRes?.active ?? []
  const waitingJobs = queueRes?.waiting ?? []
  const showSpinner = loading && data != null

  return (
    <div className="activity-page">
      <header className="activity-toolbar page-toolbar">
        <h1 className="page-title">
          <ActivityIcon size={24} />
          Activity
        </h1>
        <div className="activity-toolbar-controls">
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
          <button
            type="button"
            className={`btn btn-toolbar ${autoInterval ? 'btn-toolbar--active' : ''}`}
            onClick={cycleAutoInterval}
            title={autoInterval ? `Auto-refresh every ${autoInterval < 60 ? `${autoInterval}s` : `${autoInterval / 60}m`} — click to cycle` : 'Enable auto-refresh (5s / 30s / 1m)'}
          >
            {autoInterval ? <Timer size={18} /> : <TimerOff size={18} />}
            {autoInterval
              ? autoInterval < 60 ? `Auto ${autoInterval}s` : `Auto ${autoInterval / 60}m`
              : 'Auto'}
          </button>
          <label className="activity-autorefresh-label">
            Hover
            <select
              className="activity-autorefresh-select"
              value={hoverField}
              onChange={(e) => setHoverField(e.target.value as 'name' | 'user' | 'server')}
              disabled={loading}
            >
              {HOVER_FIELD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {showSpinner && (
            <span className="activity-toolbar-loading">
              <span className="activity-loading-spinner activity-loading-spinner--small" />
            </span>
          )}
        </div>
      </header>

      {data?.error && (
        <div className="activity-error">{data.error}</div>
      )}

      <div className="activity-columns">
        <JobColumn
          title="Active jobs"
          jobs={activeJobs}
          variant="active"
          hoverField={hoverField}
          hoveredValue={hoveredValue}
          setHoveredValue={setHoveredValue}
          onViewServerLogs={setLogModalServerUrl}
        />
        <JobColumn
          title="Waiting jobs"
          jobs={waitingJobs}
          variant="waiting"
          hoverField={hoverField}
          hoveredValue={hoveredValue}
          setHoveredValue={setHoveredValue}
          onViewServerLogs={setLogModalServerUrl}
        />
      </div>

      {logModalServerUrl != null && (
        <ServerLogsModal
          serverUrl={logModalServerUrl}
          onClose={() => setLogModalServerUrl(null)}
        />
      )}
    </div>
  )
}
