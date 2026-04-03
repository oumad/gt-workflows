import { usePreferences } from './usePreferences'

/**
 * Returns the serverAliases map from user preferences.
 * Components can use this with displayServerName() to show aliases everywhere.
 */
export function useServerAliases(): Record<string, string> {
  const { preferences } = usePreferences()
  return preferences?.serverAliases ?? {}
}
