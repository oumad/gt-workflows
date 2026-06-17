import { useState, useCallback } from 'react'

/** Persist the active tab in the `?tab=` URL param so navigating away and
 *  back restores the same tab. Uses replaceState (not pushState) so tab
 *  switches don't create browser history entries. An unknown `?tab=` value (a
 *  stale bookmark, a renamed tab) is clamped to `defaultTab` so the page never
 *  lands on a blank body — the validation lives here so every adopter gets it. */
export function useTabWithUrl(
  defaultTab: string,
  validTabs: readonly string[],
): [string, (t: string) => void] {
  const [tab, setTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab')
      return t && validTabs.includes(t) ? t : defaultTab
    } catch {
      return defaultTab
    }
  })

  // Stable identity (like a useState setter) so adopters can safely list it in
  // effect dependency arrays without triggering re-runs.
  const setTabWithUrl = useCallback((t: string) => {
    setTab(t)
    const sp = new URLSearchParams(window.location.search)
    sp.set('tab', t)
    window.history.replaceState(null, '', `${window.location.pathname}?${sp}`)
  }, [])

  return [tab, setTabWithUrl]
}
