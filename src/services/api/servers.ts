import { fetchWithAuth } from '@/utils/auth'
import type { ModelInput } from '@/utils/workflowDependencies'

export interface ServerLogsResponse {
  content: string
  contentType: 'text/plain' | 'text/html'
}

export async function fetchServerLogs(serverUrl: string): Promise<ServerLogsResponse> {
  const url = `/api/servers/logs?url=${encodeURIComponent(serverUrl)}`
  const response = await fetchWithAuth(url)
  if (!response.ok) {
    const err = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }
    throw new Error(err.error ?? `Failed to load logs (${response.status})`)
  }
  return response.json()
}

export interface DependencyAuditItem {
  name: string
  available: boolean | null
}

export interface DependencyAuditResult {
  serverUrl: string
  timestamp: string
  nodes: DependencyAuditItem[]
  models: Record<string, DependencyAuditItem[]>
  files: DependencyAuditItem[]
  nodeError?: string
}

export async function auditWorkflowDependencies(
  serverUrl: string,
  classTypes: string[],
  modelInputs: ModelInput[],
  fileInputs: ModelInput[],
): Promise<DependencyAuditResult> {
  const response = await fetchWithAuth('/api/servers/dependency-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl, classTypes, modelInputs, fileInputs }),
  })
  if (!response.ok) {
    const err = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }
    throw new Error(err.error ?? `Audit failed (${response.status})`)
  }
  return response.json()
}
