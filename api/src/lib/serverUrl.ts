// Canonical key for deduplicating / matching server URLs.
// Strips scheme (http/https), trailing slashes, and lowercases — so
//   http://x:8188     →  x:8188
//   https://x:8188/   →  x:8188
//   x:8188            →  x:8188
// all collide. Used both at write-time (dedup in POST / scrape) and at
// read-time (mapping BullMQ job URLs back to server rows in sync).
export function serverMatchKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

/** Extract just the hostname from a server URL, ignoring port + path.
 *  Used by the RDP probe to derive the host to connect to — the RDP port
 *  (3389) is independent of whatever ComfyUI port the server's URL carries.
 *  Returns null when the URL doesn't parse to anything useful. */
export function hostnameOf(rawUrl: string): string | null {
  if (!rawUrl) return null
  try {
    const trimmed = rawUrl.trim()
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
    return u.hostname || null
  } catch {
    return null
  }
}
