import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '@/features/auth'
import { useJobStats, JOBS_LIMIT_OPTIONS, TIME_RANGES, type TimeRangeId } from '@/features/dashboard'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import { anonymiseUserName } from '@/utils/anonymise'

export { JOBS_LIMIT_OPTIONS, TIME_RANGES }
export type { TimeRangeId }

export function useDashboard() {
  const { role, username } = useAuth()
  const isAdmin = role === 'admin'
  const [rangeMode, setRangeMode] = useState<'jobs' | 'time'>('jobs')
  const [jobsLimit, setJobsLimit] = useState<number>(2000)
  const [timeRangeId, setTimeRangeId] = useState<TimeRangeId>('7d')
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [userDetailsOpen, setUserDetailsOpen] = useState(false)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [anonymiseUsers, setAnonymiseUsers] = useState(role === 'guest')
  const [workflowSearch, setWorkflowSearch] = useState('')
  const [workflowSortMode, setWorkflowSortMode] = useState<'usage' | 'users'>('usage')
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())

  const toggleServerDetail = useCallback((server: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev)
      if (next.has(server)) next.delete(server)
      else next.add(server)
      return next
    })
  }, [])

  const {
    queueCounts, workflowUsage, serverUsage, serverWorkflows, userActivity,
    jobsSampled, timeRangeLabel, configured, loading, error, progress,
    userJobs, userJobsLoading, loadStats,
  } = useJobStats({ rangeMode, jobsLimit, timeRangeId, selectedUser })

  const loadStatsRef = useRef(loadStats)
  loadStatsRef.current = loadStats

  useEffect(() => { setExpandedJobId(null) }, [selectedUser])

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        setAnonymiseUsers(role === 'guest' ? (prefs.anonymiseUsers !== false) : prefs.anonymiseUsers)
        setUserDetailsOpen(prefs.userDetailsOpen)
      })
      .catch(() => {})
    loadStatsRef.current()
  }, [username, role])

  const filteredWorkflowUsage = useMemo(() => {
    const q = workflowSearch.trim().toLowerCase()
    if (!q) return workflowUsage
    return workflowUsage.filter((item) => item.name.toLowerCase().includes(q))
  }, [workflowUsage, workflowSearch])

  const workflowDisplayList = useMemo(() => {
    if (workflowSortMode === 'usage') return filteredWorkflowUsage
    return [...filteredWorkflowUsage].sort((a, b) => (b.users?.length ?? 0) - (a.users?.length ?? 0))
  }, [filteredWorkflowUsage, workflowSortMode])

  const maxWorkflow = workflowDisplayList.length ? Math.max(...workflowDisplayList.map((u) => u.count)) : 1
  const maxWorkflowByUsers = Math.max(1, ...workflowDisplayList.map((u) => u.users?.length ?? 0))
  const maxServer = serverUsage.length ? Math.max(...serverUsage.map((u) => u.count)) : 1

  const serverWorkflowsMap = useMemo(() => {
    const map = new Map<string, { name: string; count: number }[]>()
    for (const entry of serverWorkflows) map.set(entry.server, entry.workflows)
    return map
  }, [serverWorkflows])

  const getDisplayName = useCallback((userId: string | null): string => {
    if (!userId) return 'All'
    if (!anonymiseUsers) return userId
    return anonymiseUserName(userId)
  }, [anonymiseUsers])

  const sampleSubtitle = timeRangeLabel != null
    ? `${jobsSampled ?? 0} jobs in period`
    : jobsSampled != null
      ? `Last ${jobsSampled.toLocaleString()} completed jobs`
      : ''

  const toggleAnonymise = useCallback(() => {
    const next = !anonymiseUsers
    setAnonymiseUsers(next)
    updatePreferences({ anonymiseUsers: next }).catch(() => setAnonymiseUsers(!next))
  }, [anonymiseUsers])

  const toggleUserDetails = useCallback(() => {
    const next = !userDetailsOpen
    setUserDetailsOpen(next)
    updatePreferences({ userDetailsOpen: next }).catch(() => setUserDetailsOpen(!next))
  }, [userDetailsOpen])

  return {
    isAdmin, rangeMode, setRangeMode, jobsLimit, setJobsLimit, timeRangeId, setTimeRangeId,
    selectedUser, setSelectedUser, userDetailsOpen, toggleUserDetails,
    expandedJobId, setExpandedJobId, anonymiseUsers, toggleAnonymise,
    workflowSearch, setWorkflowSearch, workflowSortMode, setWorkflowSortMode,
    expandedServers, toggleServerDetail,
    queueCounts, workflowUsage, serverUsage, userActivity, jobsSampled,
    timeRangeLabel, configured, loading, error, progress, userJobs, userJobsLoading, loadStats,
    filteredWorkflowUsage, workflowDisplayList, maxWorkflow, maxWorkflowByUsers, maxServer,
    serverWorkflowsMap, getDisplayName, sampleSubtitle,
  }
}
