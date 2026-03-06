import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { WorkflowJson } from '@/types'
import { testWorkflow, cancelTestWorkflow } from '@/services/api/servers'
import type { TestWorkflowEvent } from '@/services/api/servers'

export type Phase = 'idle' | 'connecting' | 'submitting' | 'queued' | 'executing' | 'completed' | 'error' | 'cancelled'

export type NodeStatus = 'pending' | 'cached' | 'executing' | 'done' | 'error'

export interface NodeState {
  id: string
  classType: string
  status: NodeStatus
  progress: { value: number; max: number } | null
  executionOrder: number
}

export interface ErrorInfo {
  message: string
  node_id?: string
  node_type?: string
  traceback?: string | null
  details?: unknown
}

export interface TestWorkflowState {
  phase: Phase
  nodes: Map<string, NodeState>
  executionOrder: string[]
  errorInfo: ErrorInfo | null
  selectedServer: string
  retryAttempt: number | null
  retryTotal: number
}

export interface TestWorkflowActions {
  startTest: () => void
  cancelTest: () => void
  setSelectedServer: (url: string) => void
}

export function useTestWorkflow(
  workflowJson: WorkflowJson | null,
  serverUrls: string[],
) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [nodes, setNodes] = useState<Map<string, NodeState>>(new Map())
  const [executionOrder, setExecutionOrder] = useState<string[]>([])
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null)
  const [selectedServer, setSelectedServer] = useState(serverUrls[0] || '')
  const [retryAttempt, setRetryAttempt] = useState<number | null>(null)
  const [retryTotal, setRetryTotal] = useState(3)
  const abortRef = useRef<AbortController | null>(null)
  const orderCounterRef = useRef(0)

  // Sync selectedServer when serverUrls becomes available or changes
  useEffect(() => {
    if (serverUrls.length > 0 && (!selectedServer || !serverUrls.includes(selectedServer))) {
      setSelectedServer(serverUrls[0])
    }
  }, [serverUrls]) // eslint-disable-line react-hooks/exhaustive-deps

  const workflowNodes = useMemo(() => {
    const result = new Map<string, { classType: string }>()
    if (workflowJson && typeof workflowJson === 'object') {
      for (const [id, node] of Object.entries(workflowJson)) {
        if (node && typeof node === 'object' && 'class_type' in node) {
          result.set(id, { classType: (node as { class_type: string }).class_type })
        }
      }
    }
    return result
  }, [workflowJson])

  const initializeNodes = useCallback(() => {
    const nodeMap = new Map<string, NodeState>()
    for (const [id, info] of workflowNodes) {
      nodeMap.set(id, {
        id,
        classType: info.classType,
        status: 'pending',
        progress: null,
        executionOrder: -1,
      })
    }
    setNodes(nodeMap)
    setExecutionOrder([])
    orderCounterRef.current = 0
  }, [workflowNodes])

  const handleEvent = useCallback((event: TestWorkflowEvent) => {
    const { type, data } = event

    switch (type) {
      case 'status':
        if (typeof data.retrying === 'number') {
          setRetryAttempt(data.retrying)
          if (typeof data.total === 'number') setRetryTotal(data.total)
        }
        break
      case 'connected':
        setRetryAttempt(null)
        setPhase('submitting')
        break
      case 'queued':
        setPhase('queued')
        break
      case 'executing': {
        const nodeId = data.node as string
        setPhase('executing')
        setNodes(prev => {
          const next = new Map(prev)
          const existing = next.get(nodeId)
          if (existing) {
            const order = existing.executionOrder >= 0 ? existing.executionOrder : orderCounterRef.current++
            next.set(nodeId, { ...existing, status: 'executing', progress: null, executionOrder: order })
          } else {
            next.set(nodeId, {
              id: nodeId,
              classType: 'Unknown',
              status: 'executing',
              progress: null,
              executionOrder: orderCounterRef.current++,
            })
          }
          setExecutionOrder(prev => prev.includes(nodeId) ? prev : [...prev, nodeId])
          return next
        })
        break
      }
      case 'progress':
        setNodes(prev => {
          const next = new Map(prev)
          const nodeId = data.node as string
          const existing = next.get(nodeId)
          if (existing) {
            next.set(nodeId, {
              ...existing,
              progress: { value: data.value as number, max: data.max as number },
            })
          }
          return next
        })
        break
      case 'cached': {
        const cachedNodes = data.nodes as string[]
        setNodes(prev => {
          const next = new Map(prev)
          for (const nodeId of cachedNodes) {
            const existing = next.get(nodeId)
            if (existing) {
              const order = existing.executionOrder >= 0 ? existing.executionOrder : orderCounterRef.current++
              next.set(nodeId, { ...existing, status: 'cached', executionOrder: order })
            }
            setExecutionOrder(prev => prev.includes(nodeId) ? prev : [...prev, nodeId])
          }
          return next
        })
        break
      }
      case 'node_done': {
        const nodeId = data.node as string
        setNodes(prev => {
          const next = new Map(prev)
          const existing = next.get(nodeId)
          if (existing) {
            next.set(nodeId, { ...existing, status: 'done', progress: null })
          }
          return next
        })
        break
      }
      case 'completed':
        setNodes(prev => {
          const next = new Map(prev)
          for (const [id, node] of next) {
            if (node.status === 'executing') {
              next.set(id, { ...node, status: 'done', progress: null })
            }
          }
          return next
        })
        setPhase('completed')
        break
      case 'error': {
        const errMsg = data.message as string
        setErrorInfo({
          message: errMsg,
          node_id: data.node_id as string | undefined,
          node_type: data.node_type as string | undefined,
          traceback: (data.traceback as string | null) ?? null,
          details: data.details ?? data.node_errors ?? null,
        })
        if (data.node_id) {
          setNodes(prev => {
            const next = new Map(prev)
            const nodeId = data.node_id as string
            const existing = next.get(nodeId)
            if (existing) {
              next.set(nodeId, { ...existing, status: 'error', progress: null })
            }
            return next
          })
        }
        setPhase('error')
        break
      }
      default:
        break
    }
  }, [workflowNodes])

  const startTest = useCallback(async () => {
    if (!workflowJson) return
    abortRef.current?.abort()
    setPhase('connecting')
    setErrorInfo(null)
    setRetryAttempt(null)
    initializeNodes()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await testWorkflow(selectedServer, workflowJson, handleEvent, controller.signal)
      setPhase(prev => (prev === 'executing' || prev === 'queued') ? 'completed' : prev)
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase('cancelled')
      } else {
        setErrorInfo({ message: err instanceof Error ? err.message : 'Connection failed' })
        setPhase('error')
      }
    }
  }, [selectedServer, workflowJson, handleEvent, initializeNodes])

  const cancelTest = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    try {
      await cancelTestWorkflow(selectedServer)
    } catch { /* best-effort */ }
    setPhase('cancelled')
  }, [selectedServer])

  const isRunning = phase === 'connecting' || phase === 'submitting' || phase === 'queued' || phase === 'executing'

  const state: TestWorkflowState = { phase, nodes, executionOrder, errorInfo, selectedServer, retryAttempt, retryTotal }
  const actions: TestWorkflowActions = { startTest, cancelTest, setSelectedServer }

  return { state, actions, isRunning, workflowNodeCount: workflowNodes.size }
}
