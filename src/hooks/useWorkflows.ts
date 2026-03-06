import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { Workflow } from '@/types'
import { listWorkflows } from '@/services/api/workflows'

export const WORKFLOWS_QUERY_KEY = ['workflows'] as const

export interface UseWorkflowsResult {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  loadWorkflows: () => Promise<void>
}

export function useWorkflows(): UseWorkflowsResult {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: WORKFLOWS_QUERY_KEY,
    queryFn: listWorkflows,
  })

  const loadWorkflows = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: WORKFLOWS_QUERY_KEY })
  }, [queryClient])

  const error =
    query.error instanceof Error
      ? query.error.message
      : query.error
        ? String(query.error)
        : null

  return {
    workflows: query.data ?? [],
    loading: query.isLoading,
    error,
    loadWorkflows,
  }
}
