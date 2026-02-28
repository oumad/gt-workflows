/**
 * Utilities for handling ComfyUI serverUrl which can be either a string or string[].
 * The backend (gt-plugins workflow-studio) supports both formats.
 */

/**
 * Get the primary (first) server URL from a serverUrl value that may be a string or string[].
 */
export function getPrimaryServerUrl(serverUrl: string | string[] | undefined | null): string {
  if (!serverUrl) return ''
  if (Array.isArray(serverUrl)) return serverUrl[0] || ''
  return String(serverUrl)
}

/**
 * Get all server URLs as an array from a serverUrl value.
 */
export function getServerUrls(serverUrl: string | string[] | undefined | null): string[] {
  if (!serverUrl) return []
  if (Array.isArray(serverUrl)) return serverUrl.filter(Boolean)
  return [String(serverUrl)]
}

/**
 * Display label for a serverUrl (shows count if multiple).
 */
export function serverUrlDisplayLabel(serverUrl: string | string[] | undefined | null): string {
  if (!serverUrl) return ''
  if (Array.isArray(serverUrl)) {
    if (serverUrl.length === 0) return ''
    const primary = serverUrl[0]?.replace(/^https?:\/\//, '') || ''
    if (serverUrl.length === 1) return primary
    return `${primary} (+${serverUrl.length - 1})`
  }
  return String(serverUrl).replace(/^https?:\/\//, '')
}
