import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../lib/api'
import type { Workflow, Server } from '../types'

interface DataContextValue {
  workflows: Workflow[]
  servers: Server[]
  workflowsLoading: boolean
  serversLoading: boolean
  workflowsError: string | null
  serversError: string | null
  reloadWorkflows: () => Promise<void>
  reloadServers: (opts?: { silent?: boolean }) => Promise<void>
  runningJobs: number
  /** Flips true once the initial Redis→Postgres sync finishes. Pages can add
   *  it to a fetch effect's deps to refetch data that was empty on cold boot. */
  firstSyncDone: boolean
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [workflowsLoading, setWorkflowsLoading] = useState(true)
  const [serversLoading, setServersLoading] = useState(true)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [serversError, setServersError] = useState<string | null>(null)
  const [runningJobs, setRunningJobs] = useState(0)
  const [firstSyncDone, setFirstSyncDone] = useState(false)

  const wfFetched = useRef(false)
  const svFetched = useRef(false)

  const reloadWorkflows = useCallback(async () => {
    setWorkflowsLoading(true)
    setWorkflowsError(null)
    try {
      setWorkflows(await api.get<Workflow[]>('/api/workflows'))
    } catch (e) {
      setWorkflowsError(e instanceof Error ? e.message : 'Failed to load workflows')
    } finally {
      setWorkflowsLoading(false)
    }
  }, [])

  const reloadServers = useCallback(async (opts?: { silent?: boolean }) => {
    // Background polls pass { silent } so the cards don't flash a loading state
    // every tick — only the first load and explicit manual reloads show it.
    if (!opts?.silent) setServersLoading(true)
    setServersError(null)
    try {
      setServers(await api.get<Server[]>('/api/servers'))
    } catch (e) {
      setServersError(e instanceof Error ? e.message : 'Failed to load servers')
    } finally {
      if (!opts?.silent) setServersLoading(false)
    }
  }, [])

  const fetchRunningJobs = useCallback(async () => {
    try {
      // /api/jobs/stats returns an aggregate "running" total from the live Redis
      // queues (active WF + LoRA jobs) so the badge matches the Live feed.
      const stats = await api.get<{ running: number }>('/api/jobs/stats')
      setRunningJobs(stats.running ?? 0)
    } catch {}
  }, [])

  useEffect(() => {
    fetchRunningJobs()
    // Skip the poll while the tab is hidden; refresh immediately on return so
    // the badge isn't stale when the user comes back.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchRunningJobs()
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchRunningJobs()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchRunningJobs])

  useEffect(() => {
    if (!wfFetched.current) {
      wfFetched.current = true
      reloadWorkflows()
    }
  }, [reloadWorkflows])

  useEffect(() => {
    if (!svFetched.current) {
      svFetched.current = true
      reloadServers()
    }
    // Server health (online/offline + latency) is refreshed server-side every
    // sync tick. Poll so the Servers/Services pages, sidebar badges, and
    // dashboard reflect it without a manual refresh. Silent = no loading flash.
    // Gated on visibility — no point polling a backgrounded tab; refreshed on
    // return so the view isn't stale.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadServers({ silent: true })
    }, 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reloadServers({ silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reloadServers])

  // Watch the initial Redis->Postgres sync. On cold boot, jobs/analytics/etc.
  // are empty until it finishes; when it flips done we re-pull context-owned
  // data, and `firstSyncDone` lets individual pages refetch their own.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      try {
        const h = await api.get<{ sync?: { firstSyncDone?: boolean } }>('/api/health')
        if (!cancelled && h.sync?.firstSyncDone !== false) {
          setFirstSyncDone(true)
          void reloadWorkflows()
          void reloadServers({ silent: true })
          return // done — stop polling
        }
      } catch {
        /* transient — retry on next tick */
      }
      if (!cancelled) timer = window.setTimeout(poll, 5_000)
    }
    poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [reloadWorkflows, reloadServers])

  return (
    <DataContext.Provider
      value={{
        workflows,
        servers,
        workflowsLoading,
        serversLoading,
        workflowsError,
        serversError,
        reloadWorkflows,
        reloadServers,
        runningJobs,
        firstSyncDone,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside DataProvider')
  return ctx
}
