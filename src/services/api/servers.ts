import { fetchWithAuth } from '@/utils/auth'

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
