import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { WorkflowJson } from '@/types'
import { extractWorkflowDependencies } from '@/utils/workflowDependencies'
import { auditWorkflowDependencies } from '@/services/api/servers'
import type { DependencyAuditResult } from '@/services/api/servers'
import type {
  DependencyAuditCache,
  DisplayResult,
  DependencyAuditTab,
  TabCounts,
  AuditPhase,
} from './types'
import {
  buildPendingResult,
  mergeResultAtReveal,
  countTotalItems,
  aggregateTabCounts,
  REVEAL_INTERVAL_MS,
} from './utils'

export type { AuditPhase }

export interface UseDependencyAuditParams {
  workflowJson: WorkflowJson
  serverUrls: string[]
  cached: DependencyAuditCache | null
  onCacheUpdate: (cache: DependencyAuditCache) => void
}

export interface UseDependencyAuditResult {
  displayResults: DisplayResult[]
  loading: boolean
  phase: AuditPhase
  error: string | null
  lastAuditTime: string | null
  collapsedServers: Set<string>
  revealProgress: string
  activeTab: DependencyAuditTab
  tabCounts: { nodes: TabCounts; models: TabCounts; inputs: TabCounts }
  showSummary: boolean
  runAudit: () => Promise<void>
  setActiveTab: (tab: DependencyAuditTab) => void
  toggleServer: (key: string) => void
}

export function useDependencyAudit({
  workflowJson,
  serverUrls,
  cached,
  onCacheUpdate,
}: UseDependencyAuditParams): UseDependencyAuditResult {
  const [realResults, setRealResults] = useState<DependencyAuditResult[]>(cached?.results ?? [])
  const [displayResults, setDisplayResults] = useState<DisplayResult[]>([])
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<AuditPhase>('idle')
  const [error, setError] = useState<string | null>(cached?.error ?? null)
  const [lastAuditTime, setLastAuditTime] = useState<string | null>(cached?.timestamp ?? null)
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(new Set())
  const [revealProgress, setRevealProgress] = useState<string>('')
  const [activeTab, setActiveTab] = useState<DependencyAuditTab>('nodes')
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef(false)

  const tabCounts = useMemo(
    () => aggregateTabCounts(realResults),
    [realResults]
  )

  useEffect(() => {
    if (cached?.results?.length) {
      setDisplayResults(cached.results.map((r) => mergeResultAtReveal(r, Infinity)))
      setPhase('done')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cleanup = useCallback(() => {
    if (revealTimerRef.current) {
      clearInterval(revealTimerRef.current)
      revealTimerRef.current = null
    }
  }, [])

  useEffect(() => cleanup, [cleanup])

  const revealResult = useCallback(
    (
      serverIndex: number,
      real: DependencyAuditResult,
      allDisplay: DisplayResult[]
    ): Promise<void> => {
      return new Promise((resolve) => {
        const total = countTotalItems(real)
        if (total === 0) {
          const updated = [...allDisplay]
          updated[serverIndex] = mergeResultAtReveal(real, Infinity)
          setDisplayResults(updated)
          resolve()
          return
        }
        let revealed = 0
        revealTimerRef.current = setInterval(() => {
          if (abortRef.current) {
            cleanup()
            resolve()
            return
          }
          revealed++
          const updated = [...allDisplay]
          updated[serverIndex] = mergeResultAtReveal(real, revealed)
          setDisplayResults(updated)
          setRevealProgress(`Checked ${revealed} / ${total}`)
          if (revealed >= total) {
            cleanup()
            resolve()
          }
        }, REVEAL_INTERVAL_MS)
      })
    },
    [cleanup]
  )

  const runAudit = useCallback(async () => {
    abortRef.current = false
    cleanup()
    setLoading(true)
    setError(null)
    setRealResults([])
    setDisplayResults([])
    setPhase('extracting')
    setRevealProgress('')

    try {
      const deps = extractWorkflowDependencies(workflowJson)

      if (
        deps.classTypes.length === 0 &&
        deps.modelInputs.length === 0 &&
        deps.fileInputs.length === 0
      ) {
        const now = new Date().toISOString()
        setError('No dependencies found in workflow JSON.')
        setPhase('done')
        setLastAuditTime(now)
        onCacheUpdate({
          results: [],
          timestamp: now,
          error: 'No dependencies found in workflow JSON.',
        })
        setLoading(false)
        return
      }

      const pendingDisplay = serverUrls.map((url) => buildPendingResult(url, deps))
      setDisplayResults(pendingDisplay)
      setPhase('querying')
      const parts = [`${deps.classTypes.length} nodes`, `${deps.modelInputs.length} models`]
      if (deps.fileInputs.length > 0) parts.push(`${deps.fileInputs.length} inputs`)
      setRevealProgress(`Found ${parts.join(', ')}`)

      const allRealResults: DependencyAuditResult[] = []
      let currentDisplay = [...pendingDisplay]

      for (let i = 0; i < serverUrls.length; i++) {
        if (abortRef.current) break
        if (i > 0) await new Promise((r) => setTimeout(r, 200))

        if (serverUrls.length > 1) {
          setRevealProgress(`Querying server ${i + 1} of ${serverUrls.length}...`)
        } else {
          setRevealProgress('Querying server...')
        }

        let result: DependencyAuditResult
        try {
          result = await auditWorkflowDependencies(
            serverUrls[i],
            deps.classTypes,
            deps.modelInputs,
            deps.fileInputs
          )
        } catch (err) {
          const fallbackModels: Record<string, { name: string; available: null }[]> = {}
          for (const m of deps.modelInputs) {
            const cat = m.field
            if (!fallbackModels[cat]) fallbackModels[cat] = []
            if (!fallbackModels[cat].some((e) => e.name === m.value)) {
              fallbackModels[cat].push({ name: m.value, available: null })
            }
          }
          result = {
            serverUrl: serverUrls[i],
            timestamp: new Date().toISOString(),
            nodes: deps.classTypes.map((name) => ({ name, available: null })),
            models: fallbackModels,
            files: deps.fileInputs.map((f) => ({ name: f.value, available: null })),
            nodeError: err instanceof Error ? err.message : 'Failed to connect',
          }
        }

        allRealResults.push(result)

        if (!abortRef.current) {
          setPhase('revealing')
          await revealResult(i, result, currentDisplay)
          currentDisplay = [...currentDisplay]
          currentDisplay[i] = mergeResultAtReveal(result, Infinity)
          setDisplayResults(currentDisplay)
        }
      }

      const now = new Date().toISOString()
      setRealResults(allRealResults)
      setLastAuditTime(now)
      setPhase('done')
      setRevealProgress('')
      onCacheUpdate({ results: allRealResults, timestamp: now, error: null })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error'
      const now = new Date().toISOString()
      setError(msg)
      setPhase('done')
      setLastAuditTime(now)
      onCacheUpdate({ results: [], timestamp: now, error: msg })
    } finally {
      setLoading(false)
    }
  }, [workflowJson, serverUrls, onCacheUpdate, cleanup, revealResult])

  useEffect(() => {
    if (!cached) runAudit()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      abortRef.current = true
    }
  }, [])

  const toggleServer = useCallback((key: string) => {
    setCollapsedServers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const showSummary = phase === 'done' && realResults.length > 0

  return {
    displayResults,
    loading,
    phase,
    error,
    lastAuditTime,
    collapsedServers,
    revealProgress,
    activeTab,
    tabCounts,
    showSummary,
    runAudit,
    setActiveTab,
    toggleServer,
  }
}
