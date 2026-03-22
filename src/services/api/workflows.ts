import type { Workflow, WorkflowParams, WorkflowJson, HistoryEntry } from '@/types'
import { WorkflowListResponseSchema } from '@/lib/schemas'
import { fetchWithAuth, extractApiError } from '@/utils/auth'

/** Fetch the workflow list. Pass page/limit for pagination; omit (or limit=0) for all workflows. */
export async function listWorkflows(page = 1, limit = 0): Promise<Workflow[]> {
  try {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const response = await fetchWithAuth(`/api/workflows/list?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      if (response.status === 503) return []
      throw new Error(`Failed to fetch workflows: ${response.status} ${response.statusText}`)
    }
    const raw: unknown = await response.json()
    const parsed = WorkflowListResponseSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('Workflow list response validation failed:', parsed.error.issues)
      return []
    }
    return parsed.data.workflows as Workflow[]
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') return []
      if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) return []
    }
    return []
  }
}

export async function getWorkflowParams(workflowName: string): Promise<WorkflowParams> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/params`)
  if (!response.ok) throw new Error('Failed to fetch workflow params')
  return response.json()
}

export async function getWorkflowJson(workflowName: string): Promise<WorkflowJson> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/workflow`)
  if (!response.ok) throw new Error('Failed to fetch workflow JSON')
  return (await response.json()) as WorkflowJson
}

export async function saveWorkflowParams(workflowName: string, params: WorkflowParams): Promise<void> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/params`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params, null, 2),
  })
  if (!response.ok) throw new Error('Failed to save workflow params')
}

export async function createWorkflow(workflowName: string, params: WorkflowParams): Promise<void> {
  const response = await fetchWithAuth('/api/workflows/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: workflowName, params }),
  })
  if (!response.ok) throw new Error('Failed to create workflow')
}

export async function deleteWorkflow(workflowName: string): Promise<void> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Failed to delete workflow')
}

export async function duplicateWorkflow(workflowName: string, newName: string): Promise<void> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName }),
  })
  if (!response.ok) {
    throw new Error(await extractApiError(response, 'Failed to duplicate workflow'))
  }
}

export async function uploadFile(
  workflowName: string,
  file: File
): Promise<{ filename: string; path: string; relativePath: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) throw new Error('Failed to upload file')
  return response.json()
}

export async function deleteWorkflowFile(workflowName: string, filename: string): Promise<void> {
  const response = await fetchWithAuth(
    `/api/workflows/${encodeURIComponent(workflowName)}/file/${encodeURIComponent(filename)}`,
    { method: 'DELETE' }
  )
  if (!response.ok) throw new Error('Failed to delete file')
}

export async function downloadAllWorkflows(): Promise<void> {
  const response = await fetchWithAuth('/api/workflows/download-all')
  if (!response.ok) {
    let errorMessage = `Failed to download workflows (${response.status} ${response.statusText})`
    try {
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        const errorData = (await response.json()) as { error?: string }
        errorMessage = errorData.error ?? errorMessage
      }
    } catch {
      errorMessage = response.statusText || errorMessage
    }
    throw new Error(errorMessage)
  }
  const blob = await response.blob()
  if (blob.size === 0) throw new Error('Downloaded file is empty')
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'all-workflows.zip'
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export async function downloadWorkflow(workflowName: string): Promise<void> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/download`)
  if (!response.ok) {
    let errorMessage = `Failed to download workflow (${response.status} ${response.statusText})`
    try {
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        const errorData = (await response.json()) as { error?: string }
        errorMessage = errorData.error ?? errorMessage
      } else {
        const errorText = await response.text()
        if (errorText) errorMessage = errorText
      }
    } catch {
      errorMessage = response.statusText || errorMessage
    }
    throw new Error(errorMessage)
  }
  const contentType = response.headers.get('content-type')
  if (
    contentType &&
    !contentType.includes('application/zip') &&
    !contentType.includes('application/octet-stream')
  ) {
    try {
      const errorData = (await response.json()) as { error?: string }
      throw new Error(errorData.error ?? 'Invalid response format')
    } catch {
      throw new Error('Server returned invalid response format')
    }
  }
  const blob = await response.blob()
  if (blob.size === 0) throw new Error('Downloaded file is empty')
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${workflowName}.zip`
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

// --- History API ---

export async function getWorkflowHistory(workflowName: string): Promise<HistoryEntry[]> {
  const response = await fetchWithAuth(`/api/workflows/${encodeURIComponent(workflowName)}/history`)
  if (!response.ok) throw new Error('Failed to fetch workflow history')
  const data = (await response.json()) as { entries: HistoryEntry[] }
  return data.entries
}

export async function getHistoryEntryDetail(workflowName: string, timestamp: string): Promise<HistoryEntry> {
  const response = await fetchWithAuth(
    `/api/workflows/${encodeURIComponent(workflowName)}/history/${encodeURIComponent(timestamp)}`
  )
  if (!response.ok) throw new Error('Failed to fetch history entry')
  return response.json()
}

export async function getHistoryFileContent(workflowName: string, timestamp: string, filename: string): Promise<string> {
  const response = await fetchWithAuth(
    `/api/workflows/${encodeURIComponent(workflowName)}/history/${encodeURIComponent(timestamp)}/file/${encodeURIComponent(filename)}`
  )
  if (!response.ok) throw new Error('Failed to fetch history file')
  return response.text()
}

export async function restoreFromHistory(
  workflowName: string,
  timestamp: string
): Promise<{ restoredFiles: string[]; backupTimestamp: string | null }> {
  const response = await fetchWithAuth(
    `/api/workflows/${encodeURIComponent(workflowName)}/history/${encodeURIComponent(timestamp)}/restore`,
    { method: 'POST' }
  )
  if (!response.ok) throw new Error('Failed to restore from history')
  return response.json()
}

export async function deleteHistoryEntry(workflowName: string, timestamp: string): Promise<void> {
  const response = await fetchWithAuth(
    `/api/workflows/${encodeURIComponent(workflowName)}/history/${encodeURIComponent(timestamp)}`,
    { method: 'DELETE' }
  )
  if (!response.ok) throw new Error('Failed to delete history entry')
}

export async function clearWorkflowHistory(workflowName: string): Promise<void> {
  const response = await fetchWithAuth(
    `/api/workflows/${encodeURIComponent(workflowName)}/history`,
    { method: 'DELETE' }
  )
  if (!response.ok) throw new Error('Failed to clear workflow history')
}
