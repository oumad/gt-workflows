import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth'
import { getPreferences, type AppPreferences } from '@/services/api/preferences'

export const PREFERENCES_QUERY_KEY = ['preferences'] as const

export interface UsePreferencesResult {
  preferences: AppPreferences | undefined
  loading: boolean
  invalidate: () => void
}

export function usePreferences(): UsePreferencesResult {
  const { authStatus } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: getPreferences,
    enabled: authStatus === 'ok',
    staleTime: 60_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY })

  return {
    preferences: query.data,
    loading: query.isLoading,
    invalidate,
  }
}
