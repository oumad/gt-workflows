import { fetchWithAuth } from '@/utils/auth'
import type { ModelInput } from '@/utils/workflowDependencies'
import type { WorkflowJson } from '@/types'

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

export interface TestWorkflowEvent {
  type: 'connected' | 'queued' | 'executing' | 'progress' | 'cached' | 'node_done' | 'completed' | 'error' | 'status'
  data: Record<string, unknown>
}

export async function testWorkflow(
  serverUrl: string,
  workflowJson: WorkflowJson,
  onEvent: (event: TestWorkflowEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithAuth('/api/servers/test-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl, workflowJson }),
    signal,
  })

  if (!response.ok) {
    const err = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string }
    throw new Error(err.error ?? `Test failed (${response.status})`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response stream')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Parse SSE events separated by double newline
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      if (!part.trim()) continue
      let eventType = 'message'
      let eventData = ''
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7)
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6)
        }
      }
      if (eventData) {
        try {
          onEvent({ type: eventType as TestWorkflowEvent['type'], data: JSON.parse(eventData) })
        } catch { /* skip malformed events */ }
      }
    }
  }
}

export async function cancelTestWorkflow(serverUrl: string): Promise<void> {
  await fetchWithAuth('/api/servers/test-workflow/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl }),
  })
}
