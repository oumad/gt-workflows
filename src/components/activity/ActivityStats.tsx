import React, { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Search, Loader2, Timer, TimerOff, TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react'
import { useActivityStats, ACTIVITY_STATS_PERIODS, ACTIVITY_STATS_PAGE_SIZE, type DoctorRankItem, type ActivityStatsPeriod, type ActivityJob } from './useActivityStats'
import type { CompletedJobSummary } from '@/services/api/stats'

// ── Shared sub-components ────────────────────────────────────────────────────

function RankingCard({ title, items, emptyLabel }: { title: string; items: DoctorRankItem[]; emptyLabel: string }) {
  const max = items.length ? items[0].count : 1
  return (
    <div className="doctor-card doctor-card--ranking">
      <div className="doctor-card-header">{title}</div>
      {items.length === 0 ? (
        <div className="doctor-rank-empty">{emptyLabel}</div>
      ) : (
        <ul className="doctor-rank-list">
          {items.slice(0, 10).map((item) => (
            <li key={item.name} className="doctor-rank-row">
              <span className="doctor-rank-name" title={item.name}>{item.name}</span>
              <span className="doctor-rank-count">{item.count.toLocaleString()}</span>
              <div className="doctor-rank-bar-track">
                <div className="doctor-rank-bar" style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WeeklyCard({ history }: { history: { label: string; count: number }[] }) {
  const [weekIdx, setWeekIdx] = useState(0)
  const current = history[weekIdx]
  const previous = weekIdx < history.length - 1 ? history[weekIdx + 1] : null

  let trendClass = 'doctor-trend-indicator--neutral'
  let TrendIcon = Minus
  if (current && previous && current.count !== previous.count) {
    if (current.count > previous.count) {
      trendClass = 'doctor-trend-indicator--up'
      TrendIcon = TrendingUp
    } else {
      trendClass = 'doctor-trend-indicator--down'
      TrendIcon = TrendingDown
    }
  }

  return (
    <div className="doctor-card doctor-card--trend">
      <div className="doctor-card-header">Weekly Jobs</div>
      <div className="doctor-trend-nav">
        <button
          type="button"
          className="doctor-trend-nav-btn"
          disabled={weekIdx >= history.length - 1}
          onClick={() => setWeekIdx((i) => i + 1)}
          title="Older week"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="doctor-trend-center">
          <div className="doctor-trend-value">
            {current ? current.count.toLocaleString() : '—'}
            {current && previous && (
              <TrendIcon size={16} className={`doctor-trend-indicator ${trendClass}`} />
            )}
          </div>
          <div className="doctor-trend-label">{current?.label ?? '—'}</div>
          {current && previous && (
            <div className="doctor-trend-compare">vs. {previous.label}: {previous.count.toLocaleString()}</div>
          )}
        </div>
        <button
          type="button"
          className="doctor-trend-nav-btn"
          disabled={weekIdx <= 0}
          onClick={() => setWeekIdx((i) => i - 1)}
          title="More recent week"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
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

function RunningJobsSection({
  activeJobs,
  waitingCount,
  loading,
}: {
  activeJobs: ActivityJob[]
  waitingCount: number
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const hasActive = activeJobs.length > 0

  // Tick every 5 s to update elapsed times locally without a server call
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(() => setTick((t) => t + 1), 5_000)
    return () => clearInterval(id)
  }, [hasActive])

  return (
    <div className="activity-stats-running">
      <div className="activity-stats-running-header" onClick={() => setExpanded(!expanded)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}>
        <div className="activity-stats-running-title">
          <Zap size={16} className={hasActive ? 'activity-stats-running-icon--active' : ''} />
          <span>Live Queue</span>
          {loading && <Loader2 size={14} className="spin" style={{ marginLeft: '0.4rem', opacity: 0.6 }} />}
        </div>
        <div className="activity-stats-running-badges">
          <span className={`activity-stats-badge activity-stats-badge--active${hasActive ? ' activity-stats-badge--lit' : ''}`}>
            {activeJobs.length} running
          </span>
          <span className={`activity-stats-badge activity-stats-badge--waiting${waitingCount > 0 ? ' activity-stats-badge--lit' : ''}`}>
            {waitingCount} waiting
          </span>
          <span className="activity-stats-running-toggle">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="activity-stats-running-body">
          {!hasActive ? (
            <p className="activity-stats-running-empty">No jobs currently running.</p>
          ) : (
            <table className="doctor-failed-table activity-stats-running-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Server</th>
                  <th>User</th>
                  <th>Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.map((job) => (
                  <tr key={job.id} className="activity-stats-job-row">
                    <td title={job.name}>{job.name || '—'}</td>
                    <td title={job.server}>{job.server}</td>
                    <td>{job.user}</td>
                    <td className="activity-stats-cell-duration">{formatElapsed(job.processedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatRelativeTime(ts: number | null): { text: string; title: string } {
  if (ts == null) return { text: '—', title: '' }
  const elapsed = Date.now() - ts
  const title = new Date(ts).toLocaleString()
  if (elapsed < 60_000) return { text: 'just now', title }
  if (elapsed < 3_600_000) return { text: `${Math.floor(elapsed / 60_000)}m ago`, title }
  if (elapsed < 86_400_000) return { text: `${Math.floor(elapsed / 3_600_000)}h ago`, title }
  const days = Math.floor(elapsed / 86_400_000)
  return { text: `${days}d ago`, title }
}

function formatRefreshedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Main component ────────────────────────────────────────────────────────────

export function ActivityStats() {
  const s = useActivityStats()

  // Tick every minute so relative "Finished at" times stay fresh
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const totalPages = Math.max(1, Math.ceil(s.jobsTotal / ACTIVITY_STATS_PAGE_SIZE))
  const pageStart = s.jobsTotal === 0 ? 0 : (s.jobsPage - 1) * ACTIVITY_STATS_PAGE_SIZE + 1
  const pageEnd = Math.min(s.jobsPage * ACTIVITY_STATS_PAGE_SIZE, s.jobsTotal)
  const isSearching = s.searchPending || s.jobsLoading

  return (
    <div className="activity-stats">
      {/* Sub-header with controls */}
      <div className="activity-stats-controls">
        <div className="activity-stats-controls-left">
          {s.lastRefreshed && (
            <span className="doctor-last-refreshed" title={`Last refreshed at ${formatRefreshedTime(s.lastRefreshed)}`}>
              {formatRefreshedTime(s.lastRefreshed)}
            </span>
          )}
          <select
            className="doctor-period-select"
            value={s.period}
            onChange={(e) => s.setPeriod(e.target.value as ActivityStatsPeriod)}
            disabled={s.loading}
          >
            {ACTIVITY_STATS_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="activity-stats-controls-right">
          <button type="button" className="btn btn-toolbar" onClick={s.refresh} disabled={s.loading} title="Refresh stats">
            <RefreshCw size={18} className={s.loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            className={`btn btn-toolbar${s.autoInterval ? ' btn-toolbar--active' : ''}`}
            onClick={s.cycleAutoInterval}
            title={s.autoInterval
              ? `Auto-refresh every ${s.autoInterval < 60 ? `${s.autoInterval}s` : `${s.autoInterval / 60}m`} — click to cycle`
              : 'Enable auto-refresh (5s / 30s / 1m / 5m)'}
          >
            {s.autoInterval ? <Timer size={18} /> : <TimerOff size={18} />}
            {s.autoInterval
              ? s.autoInterval < 60 ? `Auto ${s.autoInterval}s` : `Auto ${s.autoInterval / 60}m`
              : 'Auto'}
          </button>
        </div>
      </div>

      {/* Body */}
      {s.loading && s.configured === null ? (
        <div className="doctor-loading">Loading stats…</div>
      ) : s.error ? (
        <div className="doctor-error"><AlertCircle size={20} />{s.error}</div>
      ) : s.configured === false ? (
        <div className="doctor-not-configured">
          <p>Queue is not configured.</p>
          <p className="doctor-hint">Set <code>REDIS_URL</code> in the server environment to enable stats.</p>
        </div>
      ) : (
        <>
          <div className="doctor-top-row">
            <div className="doctor-summary-cards">
              <div className="doctor-card">
                <div className="doctor-card-header">Total Completed Jobs</div>
                <div className="doctor-card-value">{s.totalCompleted.toLocaleString()}</div>
                <div className="doctor-card-footer">All time</div>
              </div>
              <WeeklyCard history={s.weeklyHistory} />
            </div>
            <RankingCard title="Most Launched Workflows" items={s.topWorkflows} emptyLabel="No workflows in this period" />
          </div>

          <div className="doctor-rankings">
            <RankingCard title="Most Used Servers" items={s.topServers} emptyLabel="No server activity in this period" />
            <RankingCard title="Most Active Users" items={s.topUsers} emptyLabel="No user activity in this period" />
          </div>

          <RunningJobsSection activeJobs={s.activeJobs} waitingCount={s.waitingCount} loading={s.queueLoading} />

          {/* Recent completed jobs */}
          <div className="doctor-failed-panel">
            <div className="doctor-failed-panel-header">
              <div className="doctor-failed-panel-left">
                <h2 className="doctor-failed-panel-title">Recent Jobs</h2>
                {s.jobsTotal > 0 && (
                  <span className="doctor-failed-panel-count">{s.jobsTotal.toLocaleString()} total</span>
                )}
              </div>
              <div className="doctor-failed-search">
                {isSearching
                  ? <Loader2 size={14} className="doctor-failed-search-icon spin" />
                  : <Search size={14} className="doctor-failed-search-icon" />
                }
                <input
                  type="text"
                  className={`doctor-failed-search-input${isSearching ? ' doctor-failed-search-input--busy' : ''}`}
                  placeholder="Search by ID, workflow, server or user…"
                  value={s.jobsSearch}
                  onChange={(e) => s.setJobsSearch(e.target.value)}
                />
              </div>
            </div>

            {s.jobsLoading && s.jobs.length === 0 ? (
              <div className="doctor-loading">Loading jobs…</div>
            ) : s.jobs.length === 0 ? (
              <div className="doctor-failed-empty">
                {s.jobsSearch
                  ? `No results for "${s.jobsSearch}".`
                  : 'No completed jobs in the queue.'}
              </div>
            ) : (
              <>
                <div className="doctor-failed-table-wrap">
                  <table className="doctor-failed-table">
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>Server</th>
                        <th>User</th>
                        <th>Duration</th>
                        <th>Finished at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.jobs.map((job) => (
                        <tr key={job.id} className="activity-stats-job-row">
                          <td title={job.name}>{job.name || '—'}</td>
                          <td title={job.server}>{job.server}</td>
                          <td>{job.user}</td>
                          <td className="activity-stats-cell-duration">{formatDuration(job.duration)}</td>
                          <td className="doctor-failed-cell-ts" title={formatRelativeTime(job.finishedOn).title}>
                            {formatRelativeTime(job.finishedOn).text}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="doctor-pagination">
                  <button
                    type="button"
                    className="btn btn-toolbar btn-sm"
                    disabled={s.jobsPage <= 1 || s.jobsLoading}
                    onClick={() => s.setJobsPage(s.jobsPage - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="doctor-pagination-label">
                    {pageStart}–{pageEnd} of {s.jobsTotal.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="btn btn-toolbar btn-sm"
                    disabled={s.jobsPage >= totalPages || s.jobsLoading}
                    onClick={() => s.setJobsPage(s.jobsPage + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
