import type { DependencyAuditResult } from '@/services/api/servers'

export interface DependencyAuditCache {
  results: DependencyAuditResult[]
  timestamp: string
  error: string | null
}

export type DependencyAuditTab = 'nodes' | 'models' | 'inputs'

export type AuditPhase = 'idle' | 'extracting' | 'querying' | 'revealing' | 'done'

/** 'pending' = extracted but not yet checked, null = checked but couldn't determine */
export type ItemStatus = boolean | null | 'pending'

export interface DisplayItem {
  name: string
  available: ItemStatus
}

export interface DisplayResult {
  serverUrl: string
  nodes: DisplayItem[]
  models: Record<string, DisplayItem[]>
  files: DisplayItem[]
  nodeError?: string
}

export interface TabCounts {
  available: number
  missing: number
  unknown: number
  total: number
}
