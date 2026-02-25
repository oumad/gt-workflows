import { useState, useEffect, useRef, useCallback } from 'react'
import type { Workflow } from '@/types'
import { listWorkflows } from '@/services/api/workflows'

export interface UseWorkflowsResult {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  loadWorkflows: () => Promise<void>
}

export function useWorkflows(): UseWorkflowsResult {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  const loadWorkflows = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return
    try {
      loadingRef.current = true
      setLoading(true)
      setError(null)
      const data = await listWorkflows()
      setWorkflows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    loadWorkflows()
  }, [loadWorkflows])

  return { workflows, loading, error, loadWorkflows }
}
