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

/** Worst-case status across multiple servers: missing > unknown > available. */
function worstStatus(statuses: Array<boolean | null>): boolean | null {
  if (statuses.some((s) => s === false)) return false
  if (statuses.some((s) => s === null)) return null
  return true
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

function buildUniqueCountMap(results: DependencyAuditResult[], extract: (r: DependencyAuditResult) => Array<{ name: string; available: boolean | null }>): Map<string, (boolean | null)[]> {
  const map = new Map<string, (boolean | null)[]>()
  for (const r of results) {
    for (const item of extract(r)) {
      const existing = map.get(item.name)
      if (existing) existing.push(item.available)
      else map.set(item.name, [item.available])
    }
  }
  return map
}

function tabCountsFromUniqueMap(map: Map<string, (boolean | null)[]>): TabCounts {
  const c: TabCounts = { available: 0, missing: 0, unknown: 0, total: map.size }
  for (const statuses of map.values()) {
    const w = worstStatus(statuses)
    if (w === true) c.available++
    else if (w === false) c.missing++
    else c.unknown++
  }
  return c
}

export function aggregateTabCounts(
  results: DependencyAuditResult[]
): { nodes: TabCounts; models: TabCounts; inputs: TabCounts } {
  if (results.length === 0) {
    const zero: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
    return { nodes: zero, models: { ...zero }, inputs: { ...zero } }
  }

  const nodeMap = buildUniqueCountMap(results, (r) => r.nodes)
  const fileMap = buildUniqueCountMap(results, (r) => r.files ?? [])
  const modelMapFull = new Map<string, (boolean | null)[]>()
  for (const r of results) {
    for (const items of Object.values(r.models)) {
      for (const item of items) {
        const existing = modelMapFull.get(item.name)
        if (existing) existing.push(item.available)
        else modelMapFull.set(item.name, [item.available])
      }
    }
  }

  return {
    nodes: tabCountsFromUniqueMap(nodeMap),
    models: tabCountsFromUniqueMap(modelMapFull),
    inputs: tabCountsFromUniqueMap(fileMap),
  }
}
