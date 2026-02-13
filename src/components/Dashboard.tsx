import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BarChart3, RefreshCw, AlertCircle, Users, X, ChevronDown, ChevronRight, Server } from 'lucide-react'
import { getQueueStats, getUsageStatsChunked, getUsageStatsTimeRangeChunked } from '../api/stats'
import type { QueueCounts, WorkflowUsageItem, ServerUsageItem, UserActivityItem } from '../api/stats'
import './Dashboard.css'

const JOBS_LIMIT_OPTIONS = [500, 1000, 2000, 3000, 5000] as const
const CHUNK_SIZE = 500
const TIME_RANGES = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '15d', label: 'Last 15 days' },
  { id: '30d', label: 'Last 30 days' },
] as const
type TimeRangeId = (typeof TIME_RANGES)[number]['id']

function getTimeRangeBounds(rangeId: TimeRangeId): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (rangeId === '24h') from.setHours(from.getHours() - 24)
  else if (rangeId === '7d') from.setDate(from.getDate() - 7)
  else if (rangeId === '15d') from.setDate(from.getDate() - 15)
  else from.setDate(from.getDate() - 30)
  return { from: from.toISOString(), to: to.toISOString() }
}

export default function Dashboard() {
  const [queueCounts, setQueueCounts] = useState<QueueCounts | null>(null)
  const [workflowUsage, setWorkflowUsage] = useState<WorkflowUsageItem[]>([])
  const [serverUsage, setServerUsage] = useState<ServerUsageItem[]>([])
  const [userActivity, setUserActivity] = useState<UserActivityItem[]>([])
  const [jobsSampled, setJobsSampled] = useState<number | null>(null)
  const [timeRangeLabel, setTimeRangeLabel] = useState<string | null>(null)
  const [rangeMode, setRangeMode] = useState<'jobs' | 'time'>('jobs')
  const [jobsLimit, setJobsLimit] = useState<number>(2000)
  const [timeRangeId, setTimeRangeId] = useState<TimeRangeId>('7d')
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [serversOpen, setServersOpen] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    setProgress(null)
    try {
      const queueRes = await getQueueStats()
      setConfigured(queueRes.configured)
      if (queueRes.counts) setQueueCounts(queueRes.counts)
      if (queueRes.error) setError(queueRes.error)
      if (!queueRes.configured) {
        setLoading(false)
        return
      }

      const userOpt = selectedUser ? { user: selectedUser } : {}

      if (rangeMode === 'time') {
        const { from, to } = getTimeRangeBounds(timeRangeId)
        const usageRes = await getUsageStatsTimeRangeChunked(
          from,
          to,
          15000,
          userOpt,
          (scanned, total) => setProgress({ current: scanned, total })
        )
        if (usageRes.error) setError(usageRes.error)
        if (usageRes.workflowUsage) setWorkflowUsage(usageRes.workflowUsage)
        if (usageRes.serverUsage) setServerUsage(usageRes.serverUsage)
        if (!selectedUser && usageRes.userActivity) setUserActivity(usageRes.userActivity)
        if (usageRes.jobsSampled != null) setJobsSampled(usageRes.jobsSampled)
        setTimeRangeLabel(usageRes.from && usageRes.to ? `${new Date(usageRes.from).toLocaleDateString()} – ${new Date(usageRes.to).toLocaleDateString()}` : TIME_RANGES.find((r) => r.id === timeRangeId)?.label ?? null)
      } else {
        const usageRes = await getUsageStatsChunked(
          jobsLimit,
          CHUNK_SIZE,
          userOpt,
          (current, total) => setProgress({ current, total })
        )
        if (usageRes.error) setError(usageRes.error)
        if (usageRes.workflowUsage) setWorkflowUsage(usageRes.workflowUsage)
        if (usageRes.serverUsage) setServerUsage(usageRes.serverUsage)
        if (!selectedUser && usageRes.userActivity) setUserActivity(usageRes.userActivity)
        if (usageRes.jobsSampled != null) setJobsSampled(usageRes.jobsSampled)
        setTimeRangeLabel(null)
      }
      setProgress(null)
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Request took too long. Try a smaller range or fewer jobs.'
          : err instanceof Error
            ? err.message
            : 'Failed to load stats'
      setError(message)
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }, [rangeMode, jobsLimit, timeRangeId, selectedUser])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const maxWorkflow = workflowUsage.length ? Math.max(...workflowUsage.map((u) => u.count)) : 1
  const maxServer = serverUsage.length ? Math.max(...serverUsage.map((u) => u.count)) : 1
  const maxUser = userActivity.length ? Math.max(...userActivity.map((u) => u.count)) : 1

  const sampleSubtitle =
    timeRangeLabel != null
      ? `${jobsSampled ?? 0} jobs in period`
      : jobsSampled != null
        ? `Last ${jobsSampled.toLocaleString()} completed jobs`
        : ''

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <Link to="/main" className="back-link">
          <ArrowLeft size={20} />
          Back to Workflows
        </Link>
        <div className="dashboard-toolbar">
          <h1 className="dashboard-title">
            <BarChart3 size={26} />
            Job stats
          </h1>
          <div className="dashboard-controls">
            <div className="dashboard-range-mode">
              <label className="dashboard-radio">
                <input
                  type="radio"
                  name="rangeMode"
                  checked={rangeMode === 'jobs'}
                  onChange={() => setRangeMode('jobs')}
                  disabled={loading}
                />
                <span>By job count</span>
              </label>
              <label className="dashboard-radio">
                <input
                  type="radio"
                  name="rangeMode"
                  checked={rangeMode === 'time'}
                  onChange={() => setRangeMode('time')}
                  disabled={loading}
                />
                <span>By time</span>
              </label>
            </div>
            {rangeMode === 'jobs' && (
              <label className="dashboard-limit-label">
                Last
                <select
                  className="dashboard-limit-select"
                  value={jobsLimit}
                  onChange={(e) => setJobsLimit(Number(e.target.value))}
                  disabled={loading}
                >
                  {JOBS_LIMIT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n.toLocaleString()}
                    </option>
                  ))}
                </select>
                jobs
              </label>
            )}
            {rangeMode === 'time' && (
              <select
                className="dashboard-limit-select"
                value={timeRangeId}
                onChange={(e) => setTimeRangeId(e.target.value as TimeRangeId)}
                disabled={loading}
              >
                {TIME_RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="refresh-btn"
              onClick={loadStats}
              disabled={loading}
              title="Refresh stats"
            >
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
        {configured && queueCounts && (
          <div className="queue-strip">
            <span className="queue-strip-label">Queue</span>
            <span className="queue-strip-item"><em>Waiting</em> {queueCounts.waiting}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Active</em> {queueCounts.active}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Completed</em> {queueCounts.completed}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Failed</em> {queueCounts.failed}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Delayed</em> {queueCounts.delayed}</span>
            {sampleSubtitle && (
              <>
                <span className="queue-strip-sep">·</span>
                <span className="queue-strip-meta">{sampleSubtitle}</span>
              </>
            )}
          </div>
        )}
        {(loading && progress) && (
          <div className="dashboard-progress">
            {rangeMode === 'time'
              ? `Scanning… ${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} jobs`
              : `Loading… ${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} jobs`}
          </div>
        )}
      </header>

      {loading && !queueCounts && !workflowUsage.length && !progress ? (
        <div className="dashboard-loading">Loading stats…</div>
      ) : error ? (
        <div className="dashboard-error">
          <AlertCircle size={20} />
          {error}
        </div>
      ) : configured === false ? (
        <div className="dashboard-not-configured">
          <p>Queue stats are not configured.</p>
          <p className="dashboard-hint">
            Set <code>REDIS_URL</code> (and optionally <code>BULL_QUEUE_NAME</code>) in the server environment.
          </p>
        </div>
      ) : (
        <div className="dashboard-main">
          {/* Left: Users — click to filter workflows */}
          <aside className="dashboard-sidebar">
            <div className="dashboard-sidebar-header">
              <Users size={18} />
              <span>Who&apos;s using</span>
              {selectedUser && (
                <button
                  type="button"
                  className="dashboard-clear-user"
                  onClick={() => setSelectedUser(null)}
                  title="Show all"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {!selectedUser && userActivity.length > 0 && (
              <p className="dashboard-sidebar-total">
                {userActivity.length} user{userActivity.length !== 1 ? 's' : ''} in range
              </p>
            )}
            <div className="dashboard-who-using-body">
              {selectedUser && (
                <div className="dashboard-viewing-badge">
                  Viewing: <strong>{selectedUser}</strong>
                </div>
              )}
              {userActivity.length === 0 ? (
                <p className="dashboard-sidebar-empty">No user data in range.</p>
              ) : (
                <ul className="dashboard-user-list">
                  {userActivity.map((item, index) => (
                    <li key={item.user}>
                      <button
                        type="button"
                        className={`dashboard-user-btn ${selectedUser === item.user ? 'selected' : ''}`}
                        onClick={() => setSelectedUser(item.user)}
                        title="See workflows used by this user"
                      >
                        <span className="dashboard-user-name" title={item.user}>{item.user}{index === 0 ? ' 🏆' : ''}</span>
                        <span className="dashboard-user-count">{item.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Right: Workflows — main focus, updates when user selected */}
          <section className="dashboard-workflows">
            <h2 className="dashboard-workflows-title">
              {selectedUser ? (
                <>Workflows used by <strong>{selectedUser}</strong></>
              ) : (
                'Most used workflows'
              )}
            </h2>
            {loading ? (
              <div className="dashboard-workflows-loading" aria-busy="true">
                <span className="dashboard-workflows-loading-spinner" />
                <span>
                  {selectedUser ? `Loading workflows for ${selectedUser}…` : 'Loading workflows…'}
                </span>
              </div>
            ) : workflowUsage.length === 0 ? (
              <p className="dashboard-empty">
                {selectedUser ? `No workflows in range for ${selectedUser}.` : 'No workflow data in the selected range.'}
              </p>
            ) : (
              <div className="dashboard-workflow-list">
                {workflowUsage.map((item, index) => {
                  const userCount = item.users?.length ?? 0
                  return (
                    <div key={item.name} className="dashboard-workflow-row">
                      <span className="dashboard-workflow-name" title={item.name}>
                        {item.name}{index === 0 ? ' 🏆' : ''}
                      </span>
                      {userCount > 0 && (
                        <span className="dashboard-workflow-users" title="Users who used this workflow">
                          {userCount} user{userCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      <div className="dashboard-workflow-bar-wrap">
                        <div
                          className="dashboard-workflow-bar"
                          style={{ width: `${(item.count / maxWorkflow) * 100}%` }}
                        />
                      </div>
                      <span className="dashboard-workflow-count">{item.count}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Servers: secondary, collapsible */}
            {serverUsage.length > 0 && (
              <div className="dashboard-servers-wrap">
                <button
                  type="button"
                  className="dashboard-servers-toggle"
                  onClick={() => setServersOpen((o) => !o)}
                  aria-expanded={serversOpen}
                >
                  {serversOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Server size={16} />
                  <span>Servers</span>
                  <span className="dashboard-servers-badge">{serverUsage.length}</span>
                </button>
                {serversOpen && (
                  <div className="dashboard-servers-list">
                    {serverUsage.map((item) => (
                      <div key={item.server} className="dashboard-server-row">
                        <span className="dashboard-server-name" title={item.server}>{item.server}</span>
                        <div className="dashboard-server-bar-wrap">
                          <div
                            className="dashboard-server-bar"
                            style={{ width: `${(item.count / maxServer) * 100}%` }}
                          />
                        </div>
                        <span className="dashboard-server-count">{item.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
