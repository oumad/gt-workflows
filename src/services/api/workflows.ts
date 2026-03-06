import type { Workflow, WorkflowParams, WorkflowJson } from '@/types'
import { WorkflowListResponseSchema } from '@/lib/schemas'
import { fetchWithAuth } from '@/utils/auth'

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
    const errorData = (await response.json().catch(() => ({ error: 'Failed to duplicate workflow' }))) as { error?: string }
    throw new Error(errorData.error ?? 'Failed to duplicate workflow')
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
