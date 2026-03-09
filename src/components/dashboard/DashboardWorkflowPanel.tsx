import { Fragment } from 'react'
import { Search, ChevronDown, ChevronRight, List } from 'lucide-react'
import { formatDateShortTimeMedium } from '@/utils/dateFormat'
import type { ActivityJob } from '@/services/api/stats'

function formatJobTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return formatDateShortTimeMedium(ms)
}

function formatDuration(processedOn: number | undefined, finishedOn: number | undefined): string {
  if (processedOn == null || finishedOn == null || !Number.isFinite(processedOn) || !Number.isFinite(finishedOn)) return '—'
  const sec = Math.round((finishedOn - processedOn) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const s = sec % 60
  if (min < 60) return `${min}m ${s}s`
  const h = Math.floor(min / 60)
  return `${h}h ${min % 60}m ${s}s`
}

interface WorkflowUsageItem {
  name: string
  count: number
  users?: string[]
}

interface DashboardWorkflowPanelProps {
  selectedUser: string | null
  userDetailsOpen: boolean
  onToggleUserDetails: () => void
  workflowUsage: WorkflowUsageItem[]
  filteredWorkflowUsage: WorkflowUsageItem[]
  workflowDisplayList: WorkflowUsageItem[]
  workflowSearch: string
  onWorkflowSearchChange: (v: string) => void
  workflowSortMode: 'usage' | 'users'
  onWorkflowSortModeChange: (mode: 'usage' | 'users') => void
  maxWorkflow: number
  maxWorkflowByUsers: number
  loading: boolean
  userJobs: ActivityJob[]
  userJobsLoading: boolean
  expandedJobId: string | null
  onToggleJobExpand: (id: string | null) => void
  getDisplayName: (userId: string | null) => string
}

export function DashboardWorkflowPanel({
  selectedUser, userDetailsOpen, onToggleUserDetails,
  workflowUsage, filteredWorkflowUsage, workflowDisplayList,
  workflowSearch, onWorkflowSearchChange,
  workflowSortMode, onWorkflowSortModeChange,
  maxWorkflow, maxWorkflowByUsers,
  loading, userJobs, userJobsLoading,
  expandedJobId, onToggleJobExpand, getDisplayName,
}: DashboardWorkflowPanelProps) {
  const byUsers = workflowSortMode === 'users'

  return (
    <section className="dashboard-workflows">
      <div className="dashboard-workflows-header">
        <div className="dashboard-workflows-header-left">
          <h2 className="dashboard-workflows-title">
            {selectedUser ? (
              <>Workflows used by <strong>{getDisplayName(selectedUser)}</strong></>
            ) : (
              'Most used workflows'
            )}
          </h2>
          {!selectedUser && (
            <div className="dashboard-wf-sort-toggle">
              <button
                type="button"
                className={`dashboard-wf-sort-btn${workflowSortMode === 'usage' ? ' active' : ''}`}
                onClick={() => onWorkflowSortModeChange('usage')}
                title="Sort by total job runs"
              >
                By usage
              </button>
              <button
                type="button"
                className={`dashboard-wf-sort-btn${workflowSortMode === 'users' ? ' active' : ''}`}
                onClick={() => onWorkflowSortModeChange('users')}
                title="Sort by unique users"
              >
                By users
              </button>
            </div>
          )}
        </div>
        <div className="dashboard-workflows-search-wrap">
          <Search size={14} className="dashboard-workflows-search-icon" aria-hidden />
          <input
            type="search"
            className="dashboard-workflows-search"
            placeholder="Search workflows…"
            value={workflowSearch}
            onChange={(e) => onWorkflowSearchChange(e.target.value)}
            aria-label="Search workflows"
          />
        </div>
      </div>

      <div className="dashboard-workflows-inner">
        {loading ? (
          <div className="dashboard-workflows-loading" aria-busy="true">
            <span className="dashboard-workflows-loading-spinner" />
            <span>{selectedUser ? `Loading workflows for ${getDisplayName(selectedUser)}…` : 'Loading workflows…'}</span>
          </div>
        ) : workflowUsage.length === 0 ? (
          <p className="dashboard-empty">
            {selectedUser ? `No workflows in range for ${getDisplayName(selectedUser)}.` : 'No workflow data in the selected range.'}
          </p>
        ) : filteredWorkflowUsage.length === 0 ? (
          <p className="dashboard-empty">No matching workflows.</p>
        ) : (
          <div className="dashboard-workflow-list">
            {workflowDisplayList.map((item, index) => {
              const userCount = item.users?.length ?? 0
              const barPct = byUsers
                ? (userCount / maxWorkflowByUsers) * 100
                : (item.count / maxWorkflow) * 100
              return (
                <div key={item.name} className={`dashboard-workflow-row${byUsers ? ' dashboard-workflow-row--users' : ''}`}>
                  <span className="dashboard-workflow-name" title={item.name}>
                    {item.name}{index === 0 ? ' 🏆' : ''}
                  </span>
                  {byUsers ? (
                    <span className="dashboard-workflow-users" title="Total runs">
                      {item.count} run{item.count !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    userCount > 0 && (
                      <span className="dashboard-workflow-users" title="Users who used this workflow">
                        {userCount} user{userCount !== 1 ? 's' : ''}
                      </span>
                    )
                  )}
                  <div className="dashboard-workflow-bar-wrap">
                    <div className={`dashboard-workflow-bar${byUsers ? ' dashboard-workflow-bar--users' : ''}`} style={{ width: `${barPct}%` }} />
                  </div>
                  {byUsers ? (
                    <span className="dashboard-workflow-count dashboard-workflow-count--users">{userCount}</span>
                  ) : (
                    <span className="dashboard-workflow-count">{item.count}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {selectedUser && (
          <div className="dashboard-job-details-wrap">
            <button
              type="button"
              className="dashboard-servers-toggle"
              onClick={onToggleUserDetails}
              aria-expanded={userDetailsOpen}
            >
              {userDetailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <List size={16} />
              <span>Job details</span>
              <span className="dashboard-servers-badge">{userJobsLoading ? '…' : userJobs.length}</span>
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
                          <th>Time</th><th>Workflow</th><th>Server</th><th>Job ID</th><th aria-hidden />
                        </tr>
                      </thead>
                      <tbody>
                        {userJobs.map((job) => {
                          const isExpanded = expandedJobId === job.id
                          const timeStr = formatJobTime(job.finishedOn ?? job.processedOn)
                          return (
                            <Fragment key={job.id}>
                              <tr className={`dashboard-job-details-row ${isExpanded ? 'expanded' : ''}`}>
                                <td className="dashboard-job-details-time" title={timeStr}>{timeStr}</td>
                                <td className="dashboard-job-details-name" title={job.name}>{job.name || '—'}</td>
                                <td className="dashboard-job-details-server" title={job.server}>{job.server || '—'}</td>
                                <td className="dashboard-job-details-id">{job.id}</td>
                                <td className="dashboard-job-details-more">
                                  <button
                                    type="button"
                                    className="dashboard-job-details-expand"
                                    onClick={() => onToggleJobExpand(isExpanded ? null : job.id)}
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
                                      <dt>Created (queued)</dt><dd>{formatJobTime(job.timestamp)}</dd>
                                      <dt>Started</dt><dd>{formatJobTime(job.processedOn)}</dd>
                                      <dt>Finished</dt><dd>{formatJobTime(job.finishedOn)}</dd>
                                      <dt>Duration</dt><dd>{formatDuration(job.processedOn, job.finishedOn)}</dd>
                                      <dt>Job ID</dt><dd className="dashboard-job-details-id-full">{job.id}</dd>
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
  )
}
