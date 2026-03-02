import type { Workflow } from '@/types'
import { fetchWithAuth } from '@/utils/auth'

export type LastRunStatus = 'ok' | 'nok'

export interface WorkflowDetailUIState {
  showWorkflowJson?: boolean
  showParamsJson?: boolean
  /** ISO timestamp of last test workflow run */
  lastTestRun?: string
  /** Status of last test run: ok = completed, nok = error */
  lastTestRunStatus?: LastRunStatus
  /** ISO timestamp of last dependency audit run */
  lastAuditRun?: string
  /** Status of last audit run: ok = no error, nok = error */
  lastAuditRunStatus?: LastRunStatus
}

export interface AppPreferences {
  anonymiseUsers: boolean
  serversOpen: boolean
  userDetailsOpen: boolean
  monitoredServers: string[]
  expandedCategories: string[]
  /** Per-workflow UI state for /workflows/workflow/:name (e.g. JSON panels open/closed) */
  workflowDetailUI: Record<string, WorkflowDetailUIState>
  /** Cached list of workflows with names and all params (synced when workflow list is loaded) */
  workflowsInfo: Workflow[]
  /** Optional display names for monitored servers (URL -> name) */
  serverAliases: Record<string, string>
}

/** @deprecated Use AppPreferences */
export type DashboardPreferences = Pick<AppPreferences, 'anonymiseUsers' | 'serversOpen' | 'userDetailsOpen'>

const DEFAULT_PREFERENCES: AppPreferences = {
  anonymiseUsers: false,
  serversOpen: false,
  userDetailsOpen: false,
  monitoredServers: [],
  expandedCategories: [],
  workflowDetailUI: {},
  workflowsInfo: [],
  serverAliases: {},
}

export async function getPreferences(): Promise<AppPreferences> {
  try {
    const res = await fetchWithAuth('/api/preferences')
    if (!res.ok) return { ...DEFAULT_PREFERENCES }
    const data = await res.json()
    const workflowDetailUI =
      data.workflowDetailUI && typeof data.workflowDetailUI === 'object' && !Array.isArray(data.workflowDetailUI)
        ? data.workflowDetailUI
        : {}
    const workflowsInfo = Array.isArray(data.workflowsInfo)
      ? (data.workflowsInfo as Workflow[])
      : []
    const serverAliases =
      data.serverAliases && typeof data.serverAliases === 'object' && !Array.isArray(data.serverAliases)
        ? data.serverAliases
        : {}
    return {
      anonymiseUsers: Boolean(data.anonymiseUsers),
      serversOpen: Boolean(data.serversOpen),
      userDetailsOpen: Boolean(data.userDetailsOpen),
      monitoredServers: Array.isArray(data.monitoredServers) ? data.monitoredServers : [],
      expandedCategories: Array.isArray(data.expandedCategories) ? data.expandedCategories : [],
      workflowDetailUI,
      workflowsInfo,
      serverAliases,
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export async function updatePreferences(prefs: Partial<AppPreferences>): Promise<AppPreferences> {
  const res = await fetchWithAuth('/api/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? 'Failed to save preferences')
  }
  const data = await res.json()
  const workflowDetailUI =
    data.workflowDetailUI && typeof data.workflowDetailUI === 'object' && !Array.isArray(data.workflowDetailUI)
      ? data.workflowDetailUI
      : {}
  const workflowsInfo = Array.isArray(data.workflowsInfo) ? (data.workflowsInfo as Workflow[]) : []
  const serverAliases =
    data.serverAliases && typeof data.serverAliases === 'object' && !Array.isArray(data.serverAliases)
      ? data.serverAliases
      : {}
  return {
    anonymiseUsers: Boolean(data.anonymiseUsers),
    serversOpen: Boolean(data.serversOpen),
    userDetailsOpen: Boolean(data.userDetailsOpen),
    monitoredServers: Array.isArray(data.monitoredServers) ? data.monitoredServers : [],
    expandedCategories: Array.isArray(data.expandedCategories) ? data.expandedCategories : [],
    workflowDetailUI,
    workflowsInfo,
    serverAliases,
  }
}
