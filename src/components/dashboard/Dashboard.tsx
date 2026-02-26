import React, { useState, useCallback, useEffect, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, RefreshCw, AlertCircle, Users, X, ChevronDown, ChevronRight, Server, List, UserX, Search } from 'lucide-react'
import { ROUTES } from '@/app/routes'
import { useAuth } from '@/features/auth'
import { useJobStats, JOBS_LIMIT_OPTIONS, TIME_RANGES, type TimeRangeId } from '@/features/dashboard'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import type { ActivityJob } from '@/services/api/stats'
import { anonymiseUserName } from '@/utils/anonymise'
import './Dashboard.css'

function formatJobTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })
}

function formatDuration(processedOn: number | undefined, finishedOn: number | undefined): string {
  if (processedOn == null || finishedOn == null || !Number.isFinite(processedOn) || !Number.isFinite(finishedOn)) return '—'
  const sec = Math.round((finishedOn - processedOn) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const s = sec % 60
  if (min < 60) return `${min}m ${s}s`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h ${m}m ${s}s`
}

export function Dashboard(): React.ReactElement {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const [rangeMode, setRangeMode] = useState<'jobs' | 'time'>('jobs')
  const [jobsLimit, setJobsLimit] = useState<number>(2000)
  const [timeRangeId, setTimeRangeId] = useState<TimeRangeId>('7d')
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [userDetailsOpen, setUserDetailsOpen] = useState(false)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [anonymiseUsers, setAnonymiseUsers] = useState(false)
  const [workflowSearch, setWorkflowSearch] = useState('')

  const {
    queueCounts,
    workflowUsage,
    serverUsage,
    userActivity,
    jobsSampled,
    timeRangeLabel,
    configured,
    loading,
    error,
    progress,
    userJobs,
    userJobsLoading,
    loadStats,
  } = useJobStats({ rangeMode, jobsLimit, timeRangeId, selectedUser })

  useEffect(() => {
    setExpandedJobId(null)
  }, [selectedUser])

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        setAnonymiseUsers(prefs.anonymiseUsers)
        setUserDetailsOpen(prefs.userDetailsOpen)
      })
      .catch(() => {})
  }, [])

  const filteredWorkflowUsage = useMemo(() => {
    const q = workflowSearch.trim().toLowerCase()
    if (!q) return workflowUsage
    return workflowUsage.filter((item) => item.name.toLowerCase().includes(q))
  }, [workflowUsage, workflowSearch])

  const maxWorkflow = filteredWorkflowUsage.length ? Math.max(...filteredWorkflowUsage.map((u) => u.count)) : 1
  const maxServer = serverUsage.length ? Math.max(...serverUsage.map((u) => u.count)) : 1
  const maxUser = userActivity.length ? Math.max(...userActivity.map((u) => u.count)) : 1

  const getDisplayName = useCallback(
    (userId: string | null): string => {
      if (!userId) return 'All'
      if (!anonymiseUsers) return userId
      return anonymiseUserName(userId)
    },
    [anonymiseUsers]
  )

  const sampleSubtitle =
    timeRangeLabel != null
      ? `${jobsSampled ?? 0} jobs in period`
      : jobsSampled != null
        ? `Last ${jobsSampled.toLocaleString()} completed jobs`
        : ''

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-toolbar page-toolbar">
          <h1 className="page-title dashboard-title">
            <BarChart3 size={24} />
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
              onClick={() => loadStats(true)}
              disabled={loading}
              title="Refresh stats"
            >
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <Link to={ROUTES.jobStatsTimeView} className="dashboard-timeview-btn">
              Time View
            </Link>
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
          <div className="dashboard-top">
            {/* Left: Users — click to filter workflows */}
            <aside className="dashboard-sidebar">
            <div className="dashboard-sidebar-header">
              <Users size={18} />
              <span>Who&apos;s using</span>
              {isAdmin && (
                <button
                  type="button"
                  className="dashboard-anonymise-btn"
                  onClick={() => {
                  const next = !anonymiseUsers
                  setAnonymiseUsers(next)
                  updatePreferences({ anonymiseUsers: next }).catch(() => setAnonymiseUsers(!next))
                }}
                  title={anonymiseUsers ? 'Show real user names' : 'Anonymise user names'}
                  aria-pressed={anonymiseUsers}
                >
                  <UserX size={14} />
                  {anonymiseUsers ? 'Show names' : 'Anonymise'}
                </button>
              )}
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
                  Viewing: <strong>{getDisplayName(selectedUser)}</strong>
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
                        title={anonymiseUsers ? 'See workflows used by this user' : `See workflows used by ${item.user}`}
                      >
                        <span className="dashboard-user-name" title={!anonymiseUsers ? item.user : undefined}>
                          {getDisplayName(item.user)}{index === 0 ? ' 🏆' : ''}
                        </span>
                        <span className="dashboard-user-count">{item.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

            {/* Right: Workflows — same size as Who's using */}
            <section className="dashboard-workflows">
            <div className="dashboard-workflows-header">
              <h2 className="dashboard-workflows-title">
                {selectedUser ? (
                  <>Workflows used by <strong>{getDisplayName(selectedUser)}</strong></>
                ) : (
                  'Most used workflows'
                )}
              </h2>
              <div className="dashboard-workflows-search-wrap">
                <Search size={14} className="dashboard-workflows-search-icon" aria-hidden />
                <input
                  type="search"
                  className="dashboard-workflows-search"
                  placeholder="Search workflows…"
                  value={workflowSearch}
                  onChange={(e) => setWorkflowSearch(e.target.value)}
                  aria-label="Search workflows"
                />
              </div>
            </div>
            <div className="dashboard-workflows-inner">
            {loading ? (
              <div className="dashboard-workflows-loading" aria-busy="true">
                <span className="dashboard-workflows-loading-spinner" />
                <span>
                  {selectedUser ? `Loading workflows for ${getDisplayName(selectedUser)}…` : 'Loading workflows…'}
                </span>
              </div>
            ) : workflowUsage.length === 0 ? (
              <p className="dashboard-empty">
                {selectedUser ? `No workflows in range for ${getDisplayName(selectedUser)}.` : 'No workflow data in the selected range.'}
              </p>
            ) : filteredWorkflowUsage.length === 0 ? (
              <p className="dashboard-empty">No matching workflows.</p>
            ) : (
              <div className="dashboard-workflow-list">
                {filteredWorkflowUsage.map((item, index) => {
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

            {/* Job details: when a user is selected, show expandable list (timestamp > workflow > server + more) */}
            {selectedUser && (
              <div className="dashboard-job-details-wrap">
                <button
                  type="button"
                  className="dashboard-servers-toggle"
                  onClick={() => {
                    const next = !userDetailsOpen
                    setUserDetailsOpen(next)
                    updatePreferences({ userDetailsOpen: next }).catch(() => setUserDetailsOpen(!next))
                  }}
                  aria-expanded={userDetailsOpen}
                >
                  {userDetailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <List size={16} />
                  <span>Job details</span>
                  <span className="dashboard-servers-badge">
                    {userJobsLoading ? '…' : userJobs.length}
                  </span>
                </button>
                {userDetailsOpen && (
                  <div className="dashboard-job-details-body">
                    {userJobsLoading ? (
                      <p className="dashboard-job-details-loading">Loading job list…</p>
                    ) : userJobs.length === 0 ? (
                      <p className="dashboard-sidebar-empty">No jobs in range for this user.</p>
                    ) : (
                      <div className="dashboard-job-details-table-wrap">
                        <table className="dashboard-job-details-table">
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>Workflow</th>
                              <th>Server</th>
                              <th>Job ID</th>
                              <th aria-hidden />
                            </tr>
                          </thead>
                          <tbody>
                            {userJobs.map((job) => {
                              const isExpanded = expandedJobId === job.id
                              const timeStr = formatJobTime(job.finishedOn ?? job.processedOn)
                              return (
                                <Fragment key={job.id}>
                                  <tr
                                    className={`dashboard-job-details-row ${isExpanded ? 'expanded' : ''}`}
                                  >
                                    <td className="dashboard-job-details-time" title={timeStr}>
                                      {timeStr}
                                    </td>
                                    <td className="dashboard-job-details-name" title={job.name}>
                                      {job.name || '—'}
                                    </td>
                                    <td className="dashboard-job-details-server" title={job.server}>
                                      {job.server || '—'}
                                    </td>
                                    <td className="dashboard-job-details-id">{job.id}</td>
                                    <td className="dashboard-job-details-more">
                                      <button
                                        type="button"
                                        className="dashboard-job-details-expand"
                                        onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                                        aria-expanded={isExpanded}
                                        title={isExpanded ? 'Collapse' : 'More details'}
                                      >
                                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                      </button>
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr className="dashboard-job-details-expanded-row">
                                      <td colSpan={5}>
                                        <dl className="dashboard-job-details-meta">
                                          <dt>Created (queued)</dt>
                                          <dd>{formatJobTime(job.timestamp)}</dd>
                                          <dt>Started</dt>
                                          <dd>{formatJobTime(job.processedOn)}</dd>
                                          <dt>Finished</dt>
                                          <dd>{formatJobTime(job.finishedOn)}</dd>
                                          <dt>Duration</dt>
                                          <dd>{formatDuration(job.processedOn, job.finishedOn)}</dd>
                                          <dt>Job ID</dt>
                                          <dd className="dashboard-job-details-id-full">{job.id}</dd>
                                        </dl>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
          </section>
          </div>

          {/* Servers: separate panel below Who's using and Most used workflows — always visible */}
          {serverUsage.length > 0 && (
            <section className="dashboard-servers-panel">
              <h2 className="dashboard-servers-panel-title">
                <Server size={18} />
                Servers
              </h2>
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
            </section>
          )}
        </div>
      )}
    </div>
  )
}
