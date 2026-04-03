/**
 * Returns "hostname:port" omitting default ports (80 for http, 443 for https).
 * Shared canonical implementation — replaces all local shortUrl/shortServer/shortLabel variants.
 */
export function shortServerUrl(url: string): string {
  try {
    const u = new URL(url)
    const isDefaultPort =
      (u.protocol === 'http:' && (u.port === '80' || u.port === '')) ||
      (u.protocol === 'https:' && (u.port === '443' || u.port === ''))
    return isDefaultPort ? u.hostname : `${u.hostname}:${u.port}`
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

/**
 * Returns the alias for a server URL if one exists, otherwise returns shortServerUrl(url).
 */
export function displayServerName(url: string, aliases?: Record<string, string>): string {
  const alias = aliases?.[url]?.trim()
  return alias || shortServerUrl(url)
}
