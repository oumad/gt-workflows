import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Package, CheckCircle, XCircle, HelpCircle, RefreshCw, ChevronDown, ChevronUp, Loader, Server, Minus, Blocks, HardDrive, Image as ImageIcon } from 'lucide-react'
import type { WorkflowJson } from '@/types'
import { extractWorkflowDependencies } from '@/utils/workflowDependencies'
import type { WorkflowDependencies } from '@/utils/workflowDependencies'
import { auditWorkflowDependencies } from '@/services/api/servers'
import type { DependencyAuditResult } from '@/services/api/servers'
import './DependencyAuditModal.css'

export interface DependencyAuditCache {
  results: DependencyAuditResult[]
  timestamp: string
  error: string | null
}

interface DependencyAuditModalProps {
  workflowJson: WorkflowJson
  serverUrls: string[]
  cached: DependencyAuditCache | null
  onCacheUpdate: (cache: DependencyAuditCache) => void
  onClose: () => void
}

type Tab = 'nodes' | 'models' | 'inputs'

// 'pending' = extracted but not yet checked, null = checked but couldn't determine
type ItemStatus = boolean | null | 'pending'

function StatusIcon({ available }: { available: ItemStatus }) {
  if (available === 'pending') return <Minus size={14} />
  if (available === true) return <CheckCircle size={14} />
  if (available === false) return <XCircle size={14} />
  return <HelpCircle size={14} />
}

function statusClass(available: ItemStatus) {
  if (available === 'pending') return 'pending'
  if (available === true) return 'available'
  if (available === false) return 'missing'
  return 'unknown'
}

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return iso
  }
}

interface DisplayItem {
  name: string
  available: ItemStatus
}

interface DisplayResult {
  serverUrl: string
  nodes: DisplayItem[]
  models: Record<string, DisplayItem[]>
  files: DisplayItem[]
  nodeError?: string
}

function buildPendingResult(serverUrl: string, deps: WorkflowDependencies): DisplayResult {
  return {
    serverUrl,
    nodes: deps.classTypes.map(name => ({ name, available: 'pending' as const })),
    models: {},
    files: deps.fileInputs.map(f => ({ name: f.value, available: 'pending' as const })),
  }
}

function mergeResultAtReveal(
  real: DependencyAuditResult,
  revealCount: number,
): DisplayResult {
  const nodes: DisplayItem[] = []
  let idx = 0
  for (const n of real.nodes) {
    nodes.push({ name: n.name, available: idx < revealCount ? n.available : 'pending' })
    idx++
  }
  const models: Record<string, DisplayItem[]> = {}
  for (const [cat, items] of Object.entries(real.models)) {
    models[cat] = items.map(m => {
      const item: DisplayItem = { name: m.name, available: idx < revealCount ? m.available : 'pending' }
      idx++
      return item
    })
  }
  const files: DisplayItem[] = (real.files || []).map(f => {
    const item: DisplayItem = { name: f.name, available: idx < revealCount ? f.available : 'pending' }
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

function countTotalItems(result: DependencyAuditResult): number {
  let count = result.nodes.length + (result.files?.length || 0)
  for (const items of Object.values(result.models)) count += items.length
  return count
}

interface TabCounts {
  available: number
  missing: number
  unknown: number
  total: number
}

function countItems(items: Array<{ available: boolean | null }>): TabCounts {
  const c: TabCounts = { available: 0, missing: 0, unknown: 0, total: items.length }
  for (const i of items) {
    if (i.available === true) c.available++
    else if (i.available === false) c.missing++
    else c.unknown++
  }
  return c
}

const REVEAL_INTERVAL_MS = 25

export default function DependencyAuditModal({ workflowJson, serverUrls, cached, onCacheUpdate, onClose }: DependencyAuditModalProps) {
  const [realResults, setRealResults] = useState<DependencyAuditResult[]>(cached?.results ?? [])
  const [displayResults, setDisplayResults] = useState<DisplayResult[]>([])
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'querying' | 'revealing' | 'done'>('idle')
  const [error, setError] = useState<string | null>(cached?.error ?? null)
  const [lastAuditTime, setLastAuditTime] = useState<string | null>(cached?.timestamp ?? null)
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(new Set())
  const [revealProgress, setRevealProgress] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('nodes')
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef(false)

  // Per-tab counts from real results
  const tabCounts = useMemo(() => {
    const nodes: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
    const models: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
    const inputs: TabCounts = { available: 0, missing: 0, unknown: 0, total: 0 }
    for (const r of realResults) {
      const nc = countItems(r.nodes)
      nodes.available += nc.available; nodes.missing += nc.missing; nodes.unknown += nc.unknown; nodes.total += nc.total
      for (const items of Object.values(r.models)) {
        const mc = countItems(items)
        models.available += mc.available; models.missing += mc.missing; models.unknown += mc.unknown; models.total += mc.total
      }
      if (r.files) {
        const fc = countItems(r.files)
        inputs.available += fc.available; inputs.missing += fc.missing; inputs.unknown += fc.unknown; inputs.total += fc.total
      }
    }
    return { nodes, models, inputs }
  }, [realResults])

  useEffect(() => {
    if (cached?.results?.length) {
      setDisplayResults(cached.results.map(r => mergeResultAtReveal(r, Infinity)))
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

  const revealResult = useCallback((
    serverIndex: number,
    real: DependencyAuditResult,
    allDisplay: DisplayResult[],
  ): Promise<void> => {
    return new Promise(resolve => {
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
  }, [cleanup])

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

      if (deps.classTypes.length === 0 && deps.modelInputs.length === 0 && deps.fileInputs.length === 0) {
        const now = new Date().toISOString()
        setError('No dependencies found in workflow JSON.')
        setPhase('done')
        setLastAuditTime(now)
        onCacheUpdate({ results: [], timestamp: now, error: 'No dependencies found in workflow JSON.' })
        setLoading(false)
        return
      }

      const pendingDisplay = serverUrls.map(url => buildPendingResult(url, deps))
      setDisplayResults(pendingDisplay)
      setPhase('querying')
      const parts = [`${deps.classTypes.length} nodes`, `${deps.modelInputs.length} models`]
      if (deps.fileInputs.length > 0) parts.push(`${deps.fileInputs.length} inputs`)
      setRevealProgress(`Found ${parts.join(', ')}`)

      const allRealResults: DependencyAuditResult[] = []
      let currentDisplay = [...pendingDisplay]

      for (let i = 0; i < serverUrls.length; i++) {
        if (abortRef.current) break
        if (i > 0) await new Promise(r => setTimeout(r, 200))

        if (serverUrls.length > 1) {
          setRevealProgress(`Querying server ${i + 1} of ${serverUrls.length}...`)
        } else {
          setRevealProgress('Querying server...')
        }

        let result: DependencyAuditResult
        try {
          result = await auditWorkflowDependencies(serverUrls[i], deps.classTypes, deps.modelInputs, deps.fileInputs)
        } catch (err) {
          // Synthesize unknown entries for all categories so tabs show "unknown" instead of empty
          const fallbackModels: Record<string, { name: string; available: null }[]> = {}
          for (const m of deps.modelInputs) {
            const cat = m.field
            if (!fallbackModels[cat]) fallbackModels[cat] = []
            if (!fallbackModels[cat].some(e => e.name === m.value)) {
              fallbackModels[cat].push({ name: m.value, available: null })
            }
          }
          result = {
            serverUrl: serverUrls[i],
            timestamp: new Date().toISOString(),
            nodes: deps.classTypes.map(name => ({ name, available: null })),
            models: fallbackModels,
            files: deps.fileInputs.map(f => ({ name: f.value, available: null })),
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
    if (!cached) { runAudit() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { abortRef.current = true }
  }, [])

  const toggleServer = (url: string) => {
    setCollapsedServers(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const sortMissingFirst = <T extends { available: ItemStatus }>(items: T[]) =>
    [...items].sort((a, b) => {
      if (a.available === false && b.available !== false) return -1
      if (a.available !== false && b.available === false) return 1
      return 0
    })

  const showSummary = phase === 'done' && realResults.length > 0

  function TabBadge({ counts, soft }: { counts: TabCounts, soft?: boolean }) {
    if (counts.total === 0) return null
    if (counts.missing > 0) return <span className={`dep-audit-tab-badge ${soft ? 'warn' : 'missing'}`}>{counts.missing}</span>
    if (counts.unknown > 0) return <span className="dep-audit-tab-badge unknown">{counts.unknown}</span>
    return <span className="dep-audit-tab-badge available">{counts.available}</span>
  }

  return (
    <div className="dep-audit-modal-overlay" onClick={onClose}>
      <div className="dep-audit-modal" onClick={e => e.stopPropagation()}>
        <div className="dep-audit-modal-header">
          <div className="dep-audit-modal-title">
            <Package size={20} />
            <h2>Dependency Audit</h2>
          </div>
          <div className="dep-audit-modal-actions">
            <button
              className="dep-audit-refresh-btn"
              onClick={runAudit}
              disabled={loading}
              title="Re-audit"
            >
              <RefreshCw size={14} className={loading ? 'spinner' : ''} />
              <span>Re-audit</span>
            </button>
            <button className="dep-audit-modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="dep-audit-tabs">
          <button
            className={`dep-audit-tab ${activeTab === 'nodes' ? 'active' : ''}`}
            onClick={() => setActiveTab('nodes')}
          >
            <Blocks size={15} />
            <span>Custom Nodes</span>
            {showSummary && <TabBadge counts={tabCounts.nodes} />}
          </button>
          <button
            className={`dep-audit-tab ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >
            <HardDrive size={15} />
            <span>Models</span>
            {showSummary && <TabBadge counts={tabCounts.models} />}
          </button>
          {(tabCounts.inputs.total > 0 || displayResults.some(r => r.files.length > 0)) && (
            <button
              className={`dep-audit-tab ${activeTab === 'inputs' ? 'active' : ''}`}
              onClick={() => setActiveTab('inputs')}
            >
              <ImageIcon size={15} />
              <span>Inputs</span>
              {showSummary && <TabBadge counts={tabCounts.inputs} soft />}
            </button>
          )}
        </div>

        <div className="dep-audit-modal-content">
          {error && (
            <div className="dep-audit-error">{error}</div>
          )}

          {loading && revealProgress && (
            <div className="dep-audit-progress">
              <Loader size={14} className="spinner" />
              <span>{revealProgress}</span>
            </div>
          )}

          {showSummary && lastAuditTime && (
            <div className="dep-audit-timestamp">
              Last audited: {formatTimestamp(lastAuditTime)}
            </div>
          )}

          {/* Tab: Custom Nodes */}
          {activeTab === 'nodes' && (
            <>
              {showSummary && (
                <div className="dep-audit-summary">
                  {tabCounts.nodes.available > 0 && (
                    <div className="dep-audit-summary-item available">
                      <CheckCircle size={16} />
                      <span>{tabCounts.nodes.available} Available</span>
                    </div>
                  )}
                  {tabCounts.nodes.missing > 0 && (
                    <div className="dep-audit-summary-item missing">
                      <XCircle size={16} />
                      <span>{tabCounts.nodes.missing} Missing</span>
                    </div>
                  )}
                  {tabCounts.nodes.unknown > 0 && (
                    <div className="dep-audit-summary-item unknown">
                      <HelpCircle size={16} />
                      <span>{tabCounts.nodes.unknown} Unknown</span>
                    </div>
                  )}
                </div>
              )}

              {displayResults.map(result => {
                const multiServer = displayResults.length > 1
                const collapsed = collapsedServers.has(result.serverUrl + ':nodes')

                return (
                  <div key={result.serverUrl} className="dep-audit-server">
                    {multiServer && (
                      <div
                        className="dep-audit-server-header"
                        onClick={() => toggleServer(result.serverUrl + ':nodes')}
                      >
                        <Server size={14} />
                        <span className="dep-audit-server-url">{result.serverUrl}</span>
                        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                      </div>
                    )}

                    {!collapsed && (
                      <>
                        {result.nodeError && (
                          <div className="dep-audit-error">{result.nodeError}</div>
                        )}

                        {result.nodes.length > 0 && (
                          <div className="dep-audit-list">
                            {(phase === 'done' ? sortMissingFirst(result.nodes) : result.nodes).map(node => (
                              <div key={node.name} className={`dep-audit-item ${statusClass(node.available)}`}>
                                <span className="dep-audit-item-icon">
                                  <StatusIcon available={node.available} />
                                </span>
                                <span className="dep-audit-item-name">{node.name}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {result.nodes.length === 0 && !loading && (
                          <div className="dep-audit-empty">No custom node types found in workflow.</div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Tab: Models */}
          {activeTab === 'models' && (
            <>
              {showSummary && (
                <div className="dep-audit-summary">
                  {tabCounts.models.available > 0 && (
                    <div className="dep-audit-summary-item available">
                      <CheckCircle size={16} />
                      <span>{tabCounts.models.available} Available</span>
                    </div>
                  )}
                  {tabCounts.models.missing > 0 && (
                    <div className="dep-audit-summary-item missing">
                      <XCircle size={16} />
                      <span>{tabCounts.models.missing} Missing</span>
                    </div>
                  )}
                  {tabCounts.models.unknown > 0 && (
                    <div className="dep-audit-summary-item unknown">
                      <HelpCircle size={16} />
                      <span>{tabCounts.models.unknown} Unknown</span>
                    </div>
                  )}
                </div>
              )}

              {displayResults.map(result => {
                const multiServer = displayResults.length > 1
                const collapsed = collapsedServers.has(result.serverUrl + ':models')
                const modelCategories = Object.entries(result.models).filter(([, items]) => items.length > 0)

                return (
                  <div key={result.serverUrl} className="dep-audit-server">
                    {multiServer && (
                      <div
                        className="dep-audit-server-header"
                        onClick={() => toggleServer(result.serverUrl + ':models')}
                      >
                        <Server size={14} />
                        <span className="dep-audit-server-url">{result.serverUrl}</span>
                        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                      </div>
                    )}

                    {!collapsed && (
                      <>
                        {modelCategories.map(([category, items]) => (
                          <div key={category} className="dep-audit-category">
                            <div className="dep-audit-category-header">
                              {category} ({items.length})
                            </div>
                            <div className="dep-audit-list">
                              {(phase === 'done' ? sortMissingFirst(items) : items).map(model => (
                                <div key={model.name} className={`dep-audit-item ${statusClass(model.available)}`}>
                                  <span className="dep-audit-item-icon">
                                    <StatusIcon available={model.available} />
                                  </span>
                                  <span className="dep-audit-item-name">{model.name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}

                        {modelCategories.length === 0 && !loading && (
                          <div className="dep-audit-empty">No model references found in workflow.</div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Tab: Inputs */}
          {activeTab === 'inputs' && (
            <>
              {showSummary && (
                <div className="dep-audit-summary">
                  {tabCounts.inputs.available > 0 && (
                    <div className="dep-audit-summary-item available">
                      <CheckCircle size={16} />
                      <span>{tabCounts.inputs.available} Found</span>
                    </div>
                  )}
                  {tabCounts.inputs.missing > 0 && (
                    <div className="dep-audit-summary-item warn">
                      <HelpCircle size={16} />
                      <span>{tabCounts.inputs.missing} Not found</span>
                    </div>
                  )}
                </div>
              )}

              <div className="dep-audit-input-hint">
                Input files referenced in the workflow. These may be placeholders replaced at runtime.
              </div>

              {displayResults.map(result => {
                const multiServer = displayResults.length > 1
                const collapsed = collapsedServers.has(result.serverUrl + ':inputs')

                return (
                  <div key={result.serverUrl} className="dep-audit-server">
                    {multiServer && (
                      <div
                        className="dep-audit-server-header"
                        onClick={() => toggleServer(result.serverUrl + ':inputs')}
                      >
                        <Server size={14} />
                        <span className="dep-audit-server-url">{result.serverUrl}</span>
                        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                      </div>
                    )}

                    {!collapsed && (
                      <>
                        {result.files.length > 0 ? (
                          <div className="dep-audit-list">
                            {(phase === 'done' ? sortMissingFirst(result.files) : result.files).map(file => (
                              <div key={file.name} className={`dep-audit-item ${file.available === false ? 'warn' : statusClass(file.available)}`}>
                                <span className="dep-audit-item-icon">
                                  {file.available === false
                                    ? <HelpCircle size={14} />
                                    : <StatusIcon available={file.available} />
                                  }
                                </span>
                                <span className="dep-audit-item-name">{file.name}</span>
                              </div>
                            ))}
                          </div>
                        ) : !loading && (
                          <div className="dep-audit-empty">No input file references found in workflow.</div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
