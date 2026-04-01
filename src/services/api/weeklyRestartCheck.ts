import { fetchWithAuth } from '@/utils/auth'

const BASE = '/api/weekly-restart-check'

export interface WeeklyRestartCheckConfig {
  enabled: boolean
  /** 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
  dayOfWeek: number
  hour: number
  minute: number
  delayMinutes: number
}

export async function getWeeklyRestartCheckConfig(): Promise<WeeklyRestartCheckConfig> {
  const res = await fetchWithAuth(BASE)
  if (!res.ok) throw new Error(`Failed to fetch weekly restart check config (HTTP ${res.status})`)
  return res.json()
}

export interface WeeklyRestartCheckTestResult {
  ok: boolean
  reason?: string
  healthy?: number
  unhealthy?: number
  servers?: { url: string; healthy: boolean; latencyMs: number | null; error: string | null }[]
}

export async function testWeeklyRestartCheck(): Promise<WeeklyRestartCheckTestResult> {
  const res = await fetchWithAuth(`${BASE}/test`, { method: 'POST' })
  if (!res.ok) throw new Error(`Test failed (HTTP ${res.status})`)
  return res.json()
}

export async function updateWeeklyRestartCheckConfig(
  patch: Partial<WeeklyRestartCheckConfig>
): Promise<WeeklyRestartCheckConfig> {
  const res = await fetchWithAuth(BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Failed to save weekly restart check config (HTTP ${res.status})`)
  return res.json()
}
