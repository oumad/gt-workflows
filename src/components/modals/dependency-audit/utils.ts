import type { WorkflowDependencies } from '@/utils/workflowDependencies'
import type { DependencyAuditResult } from '@/services/api/servers'
import type { DisplayItem, DisplayResult, TabCounts, ItemStatus } from './types'

export const REVEAL_INTERVAL_MS = 25

export function buildPendingResult(
  serverUrl: string,
  deps: WorkflowDependencies
): DisplayResult {
  return {
    serverUrl,
    nodes: deps.classTypes.map((name) => ({ name, available: 'pending' as const })),
    models: {},
    files: deps.fileInputs.map((f) => ({ name: f.value, available: 'pending' as const })),
  }
}

export function mergeResultAtReveal(
  real: DependencyAuditResult,
  revealCount: number
): DisplayResult {
  const nodes: DisplayItem[] = []
  let idx = 0
  for (const n of real.nodes) {
    nodes.push({ name: n.name, available: idx < revealCount ? n.available : 'pending' })
    idx++
  }
  const models: Record<string, DisplayItem[]> = {}
  for (const [cat, items] of Object.entries(real.models)) {
    models[cat] = items.map((m) => {
      const item: DisplayItem = {
        name: m.name,
        available: idx < revealCount ? m.available : 'pending',
      }
      idx++
      return item
    })
  }
  const files: DisplayItem[] = (real.files || []).map((f) => {
    const item: DisplayItem = {
      name: f.name,
      available: idx < revealCount ? f.available : 'pending',
    }
    idx++
    return item
  })
  return {
    serverUrl: real.serverUrl,
    nodes,
    models,
    files,
    nodeError: real.nodeError,
  }
}

export function countTotalItems(result: DependencyAuditResult): number {
  let count = result.nodes.length + (result.files?.length || 0)
  for (const items of Object.values(result.models)) count += items.length
  return count
}

export function countItems(items: Array<{ available: boolean | null }>): TabCounts {
  const c: TabCounts = { available: 0, missing: 0, unknown: 0, total: items.length }
  for (const i of items) {
    if (i.available === true) c.available++
    else if (i.available === false) c.missing++
    else c.unknown++
  }
  return c
}

export function statusClass(available: ItemStatus): string {
  if (available === 'pending') return 'pending'
  if (available === true) return 'available'
  if (available === false) return 'missing'
  return 'unknown'
}

export function sortMissingFirst<T extends { available: ItemStatus }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    if (a.available === false && b.available !== false) return -1
    if (a.available !== false && b.available === false) return 1
    return 0
  })
}

function addCounts(acc: TabCounts, c: TabCounts): void {
  acc.available += c.available
  acc.missing += c.missing
  acc.unknown += c.unknown
  acc.total += c.total
}

export function aggregateTabCounts(
  results: DependencyAuditResult[]
): { nodes: TabCounts; models: TabCounts; inputs: TabCounts } {
  const nodes: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
  const models: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
  const inputs: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
  for (const r of results) {
    addCounts(nodes, countItems(r.nodes))
    for (const items of Object.values(r.models)) {
      addCounts(models, countItems(items))
    }
    if (r.files) addCounts(inputs, countItems(r.files))
  }
  return { nodes, models, inputs }
}
