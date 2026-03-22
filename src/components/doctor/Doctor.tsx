import React, { useState } from 'react'
import { Stethoscope, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, Search, Hash, Percent, Timer, TimerOff } from 'lucide-react'
import { useDoctor, DOCTOR_PERIODS, FAILED_JOBS_PAGE_SIZE } from './useDoctor'
import FailedJobModal from './FailedJobModal'
import type { DoctorRankItem, FailedJobSummary, DoctorPeriod, WeeklyHistoryItem } from '@/services/api/stats'
import './Doctor.css'
import './FailedJobModal.css'

function WeeklyTrendCard({ history }: { history: WeeklyHistoryItem[] }): React.ReactElement {
  const [weekIdx, setWeekIdx] = useState(0)
  const [showPct, setShowPct] = useState(false)
  const current = history[weekIdx]
  const previous = weekIdx < history.length - 1 ? history[weekIdx + 1] : null
  const hasPrev = weekIdx < history.length - 1
  const hasNext = weekIdx > 0

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

  const failRate = current && current.total > 0
    ? ((current.count / current.total) * 100)
    : 0

  return (
    <div className="doctor-card doctor-card--trend">
      <div className="doctor-card-header-row">
        <span className="doctor-card-header">Weekly Failures</span>
        <button
          type="button"
          className={`doctor-trend-mode-btn${showPct ? ' doctor-trend-mode-btn--active' : ''}`}
          onClick={() => setShowPct((v) => !v)}
          title={showPct ? 'Show count' : 'Show failure rate'}
        >
          {showPct ? <Hash size={13} /> : <Percent size={13} />}
        </button>
      </div>
      <div className="doctor-trend-nav">
        <button
          type="button"
          className="doctor-trend-nav-btn"
          disabled={!hasPrev}
          onClick={() => setWeekIdx((i) => i + 1)}
          title="Older week"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="doctor-trend-center">
          <div className="doctor-trend-value">
            {showPct
              ? (current ? `${failRate % 1 === 0 ? failRate.toFixed(0) : failRate.toFixed(1)}%` : '—')
              : (current ? current.count.toLocaleString() : '—')
            }
            {current && previous && (
              <TrendIcon size={16} className={`doctor-trend-indicator ${trendClass}`} />
            )}
          </div>
          <div className="doctor-trend-label">{current?.label ?? '—'}</div>
          {current && (
            <div className="doctor-trend-compare">
              {showPct
                ? `${current.count.toLocaleString()} failed / ${current.total.toLocaleString()} total`
                : previous ? `vs. ${previous.label}: ${previous.count.toLocaleString()}` : ''
              }
            </div>
          )}
        </div>
        <button
          type="button"
          className="doctor-trend-nav-btn"
          disabled={!hasNext}
          onClick={() => setWeekIdx((i) => i - 1)}
          title="More recent week"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

function RankingCard({ title, items, emptyLabel }: { title: string; items: DoctorRankItem[]; emptyLabel: string }): React.ReactElement {
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

function formatShortTs(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function Doctor(): React.ReactElement {
  const d = useDoctor()
  const [selectedJob, setSelectedJob] = useState<FailedJobSummary | null>(null)

  const totalPages = Math.max(1, Math.ceil(d.failedJobsTotal / FAILED_JOBS_PAGE_SIZE))

  return (
    <div className="doctor-page">
      <header className="doctor-header">
        <div className="doctor-header-title">
          <h1 className="page-title">
            <Stethoscope size={24} /> Doctor
          </h1>
          <p className="doctor-description">
            Diagnostics and health checks for the GT Workflows environment.
          </p>
        </div>
        <div className="doctor-controls">
          <select
            className="doctor-period-select"
            value={d.period}
            onChange={(e) => d.setPeriod(e.target.value as DoctorPeriod)}
            disabled={d.loading}
          >
            {DOCTOR_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button type="button" className="btn btn-toolbar" onClick={d.refresh} disabled={d.loading} title="Refresh diagnostics">
            <RefreshCw size={18} className={d.loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            className={`btn btn-toolbar ${d.autoInterval ? 'btn-toolbar--active' : ''}`}
            onClick={d.cycleAutoInterval}
            title={d.autoInterval ? `Auto-refresh every ${d.autoInterval < 60 ? `${d.autoInterval}s` : `${d.autoInterval / 60}m`} — click to cycle` : 'Enable auto-refresh (30s / 1m / 5m)'}
          >
            {d.autoInterval ? <Timer size={18} /> : <TimerOff size={18} />}
            {d.autoInterval
              ? d.autoInterval < 60 ? `Auto ${d.autoInterval}s` : `Auto ${d.autoInterval / 60}m`
              : 'Auto'}
          </button>
        </div>
      </header>

      {d.loading && d.configured === null ? (
        <div className="doctor-loading">Loading diagnostics…</div>
      ) : d.error ? (
        <div className="doctor-error"><AlertCircle size={20} />{d.error}</div>
      ) : d.configured === false ? (
        <div className="doctor-not-configured">
          <p>Queue is not configured.</p>
          <p className="doctor-hint">
            Set <code>REDIS_URL</code> in the server environment to enable diagnostics.
          </p>
        </div>
      ) : (
        <>
          <div className="doctor-top-row">
            <div className="doctor-summary-cards">
              <div className="doctor-card">
                <div className="doctor-card-header">Total Failed Jobs</div>
                <div className="doctor-card-value">{d.totalFailed.toLocaleString()}</div>
                <div className="doctor-card-footer">All time</div>
              </div>
              <WeeklyTrendCard history={d.weeklyHistory} />
            </div>
            <RankingCard title="Most Common Errors" items={d.topErrors} emptyLabel="No errors in this period" />
          </div>

          <div className="doctor-rankings">
            <RankingCard title="Most Failed Workflows" items={d.topWorkflows} emptyLabel="No failed workflows in this period" />
            <RankingCard title="Most Failed Servers" items={d.topServers} emptyLabel="No server failures in this period" />
            <RankingCard title="Most Failing Users" items={d.topUsers} emptyLabel="No user failures in this period" />
          </div>

          <div className="doctor-failed-panel">
            <div className="doctor-failed-panel-header">
              <div className="doctor-failed-panel-left">
                <h2 className="doctor-failed-panel-title">Failed Jobs</h2>
                <span className="doctor-failed-panel-count">{d.failedJobsTotal.toLocaleString()} total</span>
              </div>
              <div className="doctor-failed-search">
                <Search size={14} className="doctor-failed-search-icon" />
                <input
                  type="text"
                  className="doctor-failed-search-input"
                  placeholder="Search by ID, workflow, server, user or error…"
                  value={d.failedJobsSearch}
                  onChange={(e) => d.setFailedJobsSearch(e.target.value)}
                />
              </div>
            </div>

            {d.failedJobsLoading && d.failedJobs.length === 0 ? (
              <div className="doctor-loading">Loading failed jobs…</div>
            ) : d.failedJobs.length === 0 ? (
              <div className="doctor-failed-empty">No failed jobs in the queue.</div>
            ) : (
              <>
                <div className="doctor-failed-table-wrap">
                  <table className="doctor-failed-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Workflow</th>
                        <th>Server</th>
                        <th>User</th>
                        <th>Failed at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.failedJobs.map((job) => (
                        <tr key={job.id} className="doctor-failed-row" onClick={() => setSelectedJob(job)}>
                          <td className="doctor-failed-cell-id">{job.id}</td>
                          <td title={job.name}>{job.name || '—'}</td>
                          <td title={job.server}>{job.server}</td>
                          <td>{job.user}</td>
                          <td className="doctor-failed-cell-ts">{formatShortTs(job.finishedOn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="doctor-pagination">
                  <button
                    type="button"
                    className="btn btn-toolbar btn-sm"
                    disabled={d.failedJobsPage <= 1 || d.failedJobsLoading}
                    onClick={() => d.setFailedJobsPage(d.failedJobsPage - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="doctor-pagination-label">
                    Page {d.failedJobsPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-toolbar btn-sm"
                    disabled={d.failedJobsPage >= totalPages || d.failedJobsLoading}
                    onClick={() => d.setFailedJobsPage(d.failedJobsPage + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {selectedJob && (
        <FailedJobModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  )
}
