import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight, List } from 'lucide-react'
import { formatDateShortTimeMedium } from '@/utils/dateFormat'
import { listWorkflows } from '@/services/api/workflows'
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

const BAR_COLORS = [
  'linear-gradient(90deg, #7a4db0, #b88ae6)',
  'linear-gradient(90deg, #2563eb, #60a5fa)',
  'linear-gradient(90deg, #0891b2, #22d3ee)',
  'linear-gradient(90deg, #059669, #34d399)',
  'linear-gradient(90deg, #d97706, #fbbf24)',
  'linear-gradient(90deg, #dc2626, #f87171)',
  'linear-gradient(90deg, #7c3aed, #a78bfa)',
  'linear-gradient(90deg, #db2777, #f472b6)',
]

const BADGE_STYLES: Record<number, React.CSSProperties> = {
  1: { background: 'linear-gradient(135deg,#d4a335,#f5c842)', color: '#1a1200', boxShadow: '0 0 6px rgba(212,163,53,0.35)' },
  2: { background: 'linear-gradient(135deg,#8b9aab,#c0c8d2)', color: '#1a2332', boxShadow: '0 0 6px rgba(139,154,171,0.25)' },
  3: { background: 'linear-gradient(135deg,#b45309,#d97706)', color: '#1a1200', boxShadow: '0 0 6px rgba(180,83,9,0.25)' },
}

interface WorkflowUsageItem {
  name: string
  count: number
  users?: { user: string; count: number }[]
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
  onWorkflowUsersClick: (item: WorkflowUsageItem) => void
}

const SORT_BTN = 'px-[0.4rem] py-[0.1rem] text-sm font-medium bg-transparent border-none rounded-[3px] text-muted cursor-pointer transition-all duration-150 whitespace-nowrap normal-case tracking-normal hover:text-secondary'
const SORT_BTN_ACTIVE = 'bg-accent text-white shadow-[0_1px_3px_rgba(122,77,176,0.3)]'

export function DashboardWorkflowPanel({
  selectedUser, userDetailsOpen, onToggleUserDetails,
  workflowUsage, filteredWorkflowUsage, workflowDisplayList,
  workflowSearch, onWorkflowSearchChange,
  workflowSortMode, onWorkflowSortModeChange,
  maxWorkflow, maxWorkflowByUsers,
  loading, userJobs, userJobsLoading,
  expandedJobId, onToggleJobExpand, getDisplayName,
  onWorkflowUsersClick,
}: DashboardWorkflowPanelProps) {
  const byUsers = workflowSortMode === 'users'
  const navigate = useNavigate()

  const [workflowNames, setWorkflowNames] = useState<Set<string> | null>(null)
  const [wfError, setWfError] = useState<string | null>(null)

  useEffect(() => {
    listWorkflows(1, 0).then((wfs) => {
      setWorkflowNames(new Set(wfs.map((w) => w.name)))
    }).catch(() => { /* ignore */ })
  }, [])

  const handleWorkflowClick = useCallback((name: string) => {
    if (!name) return
    if (workflowNames && !workflowNames.has(name)) {
      setWfError(`Workflow "${name}" not found`)
      setTimeout(() => setWfError(null), 3000)
      return
    }
    navigate(`/workflows/workflow/${encodeURIComponent(name)}`)
  }, [navigate, workflowNames])

  const totalCount = useMemo(
    () => workflowDisplayList.reduce((sum, item) => sum + item.count, 0),
    [workflowDisplayList]
  )

  return (
    <div className="bg-primary border border-default rounded-[10px] px-[1.15rem] pt-4 pb-3 flex flex-col gap-[0.35rem] min-h-0 overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.06em] text-muted mb-[0.1rem]">
        <span>
          {selectedUser ? (
            <>Workflows by <strong className="text-accent-light normal-case tracking-normal">{getDisplayName(selectedUser)}</strong></>
          ) : (
            'Most used workflows'
          )}
        </span>
        {!selectedUser && (
          <div className="inline-flex bg-[rgba(15,20,25,0.5)] border border-default rounded-[5px] p-px gap-px">
            <button type="button" className={`${SORT_BTN}${workflowSortMode === 'usage' ? ` ${SORT_BTN_ACTIVE}` : ''}`} onClick={() => onWorkflowSortModeChange('usage')}>By usage</button>
            <button type="button" className={`${SORT_BTN}${workflowSortMode === 'users' ? ` ${SORT_BTN_ACTIVE}` : ''}`} onClick={() => onWorkflowSortModeChange('users')}>By users</button>
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <div className="relative">
            <Search size={12} className="absolute left-[0.4rem] top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              type="search"
              className="w-full pl-[1.4rem] pr-[0.4rem] py-[0.25rem] text-sm border border-default rounded-[5px] bg-[rgba(15,20,25,0.6)] text-primary placeholder:text-muted focus:outline-none focus:border-accent transition-[border-color] min-w-[110px]"
              placeholder="Search workflows…"
              value={workflowSearch}
              onChange={(e) => onWorkflowSearchChange(e.target.value)}
              aria-label="Search workflows"
            />
          </div>
        </div>
      </div>

      {/* Error toast */}
      {wfError && (
        <div className="px-[0.6rem] py-[0.3rem] text-sm text-semantic-error bg-semantic-error/[0.08] rounded mx-2">
          {wfError}
        </div>
      )}

      {/* Workflow list */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3 text-muted text-sm">
          <span className="w-[18px] h-[18px] border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />
          <span>{selectedUser ? `Loading workflows for ${getDisplayName(selectedUser)}…` : 'Loading…'}</span>
        </div>
      ) : workflowUsage.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          {selectedUser ? `No workflows for ${getDisplayName(selectedUser)}.` : 'No workflow data in the selected range.'}
        </div>
      ) : filteredWorkflowUsage.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">No matching workflows.</div>
      ) : (
        <ul className="activity-rank-list list-none m-0 pr-2 overflow-y-auto flex-1 min-h-0 flex flex-col gap-0">
          {workflowDisplayList.map((item, index) => {
            const userCount = item.users?.length ?? 0
            const barPct = byUsers
              ? (userCount / maxWorkflowByUsers) * 100
              : (item.count / maxWorkflow) * 100
            const pctOfTotal = totalCount > 0 ? ((item.count / totalCount) * 100).toFixed(1) : '0'
            const barColor = byUsers
              ? 'linear-gradient(90deg,#7c3aed,#a78bfa)'
              : BAR_COLORS[index % BAR_COLORS.length]
            return (
              <li key={item.name} className="grid grid-cols-[1fr_auto] gap-[0.4rem] pb-[0.2rem] text-sm">
                <button
                  type="button"
                  className="all-unset cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[0.2rem] text-primary transition-colors hover:text-[#b88ae6] hover:underline hover:decoration-[rgba(184,138,230,0.4)] underline-offset-2"
                  title={`Open ${item.name}`}
                  onClick={() => handleWorkflowClick(item.name)}
                >
                  {index < 3 && (
                    <span
                      className="inline-flex items-center justify-center w-[17px] h-[17px] rounded-full text-sm font-bold shrink-0 mr-[0.35rem] leading-none"
                      style={BADGE_STYLES[index + 1]}
                    >
                      {index + 1}
                    </span>
                  )}
                  {item.name}
                </button>
                <span className="font-medium tabular-nums text-right text-sm text-muted">
                  {byUsers ? (
                    userCount > 0 ? (
                      <button
                        type="button"
                        className="all-unset cursor-pointer text-muted hover:text-[#b88ae6] transition-colors"
                        onClick={() => onWorkflowUsersClick(item)}
                      >
                        {userCount} user{userCount !== 1 ? 's' : ''}
                      </button>
                    ) : <>{userCount} users</>
                  ) : (
                    <>
                      {userCount > 0 && (
                        <button
                          type="button"
                          className="all-unset cursor-pointer text-muted hover:text-[#b88ae6] transition-colors mr-[0.2rem]"
                          onClick={() => onWorkflowUsersClick(item)}
                        >
                          {userCount} user{userCount !== 1 ? 's' : ''} ·{' '}
                        </button>
                      )}
                      {item.count}
                      <span className="inline-block ml-[0.3rem] text-sm text-muted font-normal">{pctOfTotal}%</span>
                    </>
                  )}
                </span>
                <div className="col-span-full h-[5px] rounded-[3px] bg-[rgba(45,58,74,0.4)] overflow-hidden">
                  <div
                    className="h-full rounded-[3px] transition-[width] duration-300"
                    style={{ width: `${barPct}%`, background: barColor }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Job details (when user selected) */}
      {selectedUser && (
        <div className="border-t border-default mt-auto pt-2 shrink-0">
          <button
            type="button"
            className="inline-flex items-center gap-[0.35rem] px-[0.4rem] py-[0.3rem] bg-transparent border-none rounded-[5px] text-muted text-sm cursor-pointer transition-all duration-150 hover:bg-accent/[0.06] hover:text-secondary"
            onClick={onToggleUserDetails}
            aria-expanded={userDetailsOpen}
          >
            {userDetailsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <List size={14} />
            <span>Job details</span>
            <span className="text-sm bg-[rgba(45,58,74,0.6)] text-muted px-[0.35rem] py-[0.05rem] rounded-[3px]">
              {userJobsLoading ? '…' : userJobs.length}
            </span>
          </button>
          {userDetailsOpen && (
            <div className="mt-[0.35rem] overflow-y-auto max-h-[200px]">
              {userJobsLoading ? (
                <p className="flex-1 flex items-center justify-center text-muted text-sm">Loading job list…</p>
              ) : userJobs.length === 0 ? (
                <p className="flex-1 flex items-center justify-center text-muted text-sm">No jobs for this user.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        {['Time', 'Workflow', 'Server', 'Job ID', ''].map((h) => (
                          <th key={h} className="text-left px-[0.4rem] py-[0.3rem] text-sm font-semibold uppercase tracking-[0.04em] text-muted border-b border-default">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {userJobs.map((job) => {
                        const isExpanded = expandedJobId === job.id
                        const timeStr = formatJobTime(job.finishedOn ?? job.processedOn)
                        return (
                          <Fragment key={job.id}>
                            <tr className={`transition-colors hover:bg-accent/[0.04] ${isExpanded ? 'bg-accent/[0.06]' : ''}`}>
                              <td className="px-[0.4rem] py-[0.3rem] border-b border-default/50 text-muted whitespace-nowrap align-middle" title={timeStr}>{timeStr}</td>
                              <td className="px-[0.4rem] py-[0.3rem] border-b border-default/50 text-primary max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap align-middle" title={job.name}>{job.name || '—'}</td>
                              <td className="px-[0.4rem] py-[0.3rem] border-b border-default/50 text-primary max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap align-middle" title={job.server}>{job.server || '—'}</td>
                              <td className="px-[0.4rem] py-[0.3rem] border-b border-default/50 font-mono text-sm text-muted align-middle">{job.id}</td>
                              <td className="px-[0.1rem] py-[0.3rem] border-b border-default/50 w-6 align-middle">
                                <button
                                  type="button"
                                  className="inline-flex p-[0.15rem] bg-transparent border-none rounded-[3px] text-muted cursor-pointer transition-all duration-150 hover:bg-accent/10 hover:text-accent-light"
                                  onClick={() => onToggleJobExpand(isExpanded ? null : job.id)}
                                  aria-expanded={isExpanded}
                                  title={isExpanded ? 'Collapse' : 'More details'}
                                >
                                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={5} className="bg-[rgba(36,48,68,0.4)] px-[0.4rem] py-2 border-b border-default">
                                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[0.15rem] m-0 text-sm">
                                    <dt className="text-muted font-medium m-0">Created (queued)</dt><dd className="m-0 text-primary">{formatJobTime(job.timestamp)}</dd>
                                    <dt className="text-muted font-medium m-0">Started</dt><dd className="m-0 text-primary">{formatJobTime(job.processedOn)}</dd>
                                    <dt className="text-muted font-medium m-0">Finished</dt><dd className="m-0 text-primary">{formatJobTime(job.finishedOn)}</dd>
                                    <dt className="text-muted font-medium m-0">Duration</dt><dd className="m-0 text-primary">{formatDuration(job.processedOn, job.finishedOn)}</dd>
                                    <dt className="text-muted font-medium m-0">Job ID</dt><dd className="m-0 font-mono break-all text-primary">{job.id}</dd>
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
  )
}
