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
  reloadServers: () => Promise<void>
  runningJobs: number
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

  const reloadServers = useCallback(async () => {
    setServersLoading(true)
    setServersError(null)
    try {
      setServers(await api.get<Server[]>('/api/servers'))
    } catch (e) {
      setServersError(e instanceof Error ? e.message : 'Failed to load servers')
    } finally {
      setServersLoading(false)
    }
  }, [])

  const fetchRunningJobs = useCallback(async () => {
    try {
      // /api/jobs/stats returns an aggregate "running" total across both
      // workflow_jobs (active) and training_jobs (running).
      const stats = await api.get<{ running: number }>('/api/jobs/stats')
      setRunningJobs(stats.running ?? 0)
    } catch {}
  }, [])

  useEffect(() => {
    fetchRunningJobs()
    const id = setInterval(fetchRunningJobs, 30_000)
    return () => clearInterval(id)
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
  }, [reloadServers])

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
