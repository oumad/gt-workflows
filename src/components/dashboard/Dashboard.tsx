import React from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, RefreshCw, AlertCircle } from 'lucide-react'
import { ROUTES } from '@/app/routes'
import { JOBS_LIMIT_OPTIONS, TIME_RANGES } from '@/features/dashboard'
import { useDashboard } from './useDashboard'
import { DashboardUserPanel } from './DashboardUserPanel'
import { DashboardWorkflowPanel } from './DashboardWorkflowPanel'
import { DashboardServersPanel } from './DashboardServersPanel'
import './Dashboard.css'

export function Dashboard(): React.ReactElement {
  const d = useDashboard()

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-toolbar page-toolbar">
          <h1 className="page-title dashboard-title">
            <BarChart3 size={24} /> Job stats
          </h1>
          <div className="dashboard-controls">
            <div className="dashboard-range-mode">
              <label className="dashboard-radio">
                <input type="radio" name="rangeMode" checked={d.rangeMode === 'jobs'} onChange={() => d.setRangeMode('jobs')} disabled={d.loading} />
                <span>By job count</span>
              </label>
              <label className="dashboard-radio">
                <input type="radio" name="rangeMode" checked={d.rangeMode === 'time'} onChange={() => d.setRangeMode('time')} disabled={d.loading} />
                <span>By time</span>
              </label>
            </div>
            {d.rangeMode === 'jobs' && (
              <label className="dashboard-limit-label">
                Last
                <select className="dashboard-limit-select" value={d.jobsLimit} onChange={(e) => d.setJobsLimit(Number(e.target.value))} disabled={d.loading}>
                  {JOBS_LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
                </select>
                jobs
              </label>
            )}
            {d.rangeMode === 'time' && (
              <select className="dashboard-limit-select" value={d.timeRangeId} onChange={(e) => d.setTimeRangeId(e.target.value as typeof d.timeRangeId)} disabled={d.loading}>
                {TIME_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            )}
            <button type="button" className="btn btn-toolbar" onClick={() => d.loadStats(true)} disabled={d.loading} title="Refresh stats">
              <RefreshCw size={18} className={d.loading ? 'spin' : ''} /> Refresh
            </button>
            <Link to={ROUTES.jobStatsTimeView} className="btn btn-toolbar">Time View</Link>
          </div>
        </div>
        {d.configured && d.queueCounts && (
          <div className="queue-strip">
            <span className="queue-strip-label">Queue</span>
            <span className="queue-strip-item"><em>Waiting</em> {d.queueCounts.waiting}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Active</em> {d.queueCounts.active}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Completed</em> {d.queueCounts.completed}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Failed</em> {d.queueCounts.failed}</span>
            <span className="queue-strip-sep">·</span>
            <span className="queue-strip-item"><em>Delayed</em> {d.queueCounts.delayed}</span>
            {d.sampleSubtitle && (
              <><span className="queue-strip-sep">·</span><span className="queue-strip-meta">{d.sampleSubtitle}</span></>
            )}
          </div>
        )}
        {d.loading && d.progress && (
          <div className="dashboard-progress">
            {d.rangeMode === 'time'
              ? `Scanning… ${d.progress.current.toLocaleString()} / ${d.progress.total.toLocaleString()} jobs`
              : `Loading… ${d.progress.current.toLocaleString()} / ${d.progress.total.toLocaleString()} jobs`}
          </div>
        )}
      </header>

      {d.loading && !d.queueCounts && !d.workflowUsage.length && !d.progress ? (
        <div className="dashboard-loading">Loading stats…</div>
      ) : d.error ? (
        <div className="dashboard-error"><AlertCircle size={20} />{d.error}</div>
      ) : d.configured === false ? (
        <div className="dashboard-not-configured">
          <p>Queue stats are not configured.</p>
          <p className="dashboard-hint">
            Set <code>REDIS_URL</code> (and optionally <code>BULL_QUEUE_NAME</code>) in the server environment.
          </p>
        </div>
      ) : (
        <div className="dashboard-main">
          <div className="dashboard-top">
            <DashboardUserPanel
              isAdmin={d.isAdmin}
              anonymiseUsers={d.anonymiseUsers}
              selectedUser={d.selectedUser}
              userActivity={d.userActivity}
              getDisplayName={d.getDisplayName}
              onToggleAnonymise={d.toggleAnonymise}
              onClearUser={() => d.setSelectedUser(null)}
              onSelectUser={d.setSelectedUser}
            />
            <DashboardWorkflowPanel
              selectedUser={d.selectedUser}
              userDetailsOpen={d.userDetailsOpen}
              onToggleUserDetails={d.toggleUserDetails}
              workflowUsage={d.workflowUsage}
              filteredWorkflowUsage={d.filteredWorkflowUsage}
              workflowDisplayList={d.workflowDisplayList}
              workflowSearch={d.workflowSearch}
              onWorkflowSearchChange={d.setWorkflowSearch}
              workflowSortMode={d.workflowSortMode}
              onWorkflowSortModeChange={d.setWorkflowSortMode}
              maxWorkflow={d.maxWorkflow}
              maxWorkflowByUsers={d.maxWorkflowByUsers}
              loading={d.loading}
              userJobs={d.userJobs}
              userJobsLoading={d.userJobsLoading}
              expandedJobId={d.expandedJobId}
              onToggleJobExpand={d.setExpandedJobId}
              getDisplayName={d.getDisplayName}
            />
          </div>
          <DashboardServersPanel
            serverUsage={d.serverUsage}
            serverWorkflowsMap={d.serverWorkflowsMap}
            maxServer={d.maxServer}
            expandedServers={d.expandedServers}
            onToggleServer={d.toggleServerDetail}
          />
        </div>
      )}
    </div>
  )
}
