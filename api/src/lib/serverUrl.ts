import { promises as dns } from 'node:dns'

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
export function hostnameOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  try {
    const trimmed = rawUrl.trim()
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
    return u.hostname || null
  } catch {
    return null
  }
}

/** Extract the port from a server URL, or null when there isn't one. Used to
 *  tell a port-less HOST record (`http://worker`) from a ported SERVICE record
 *  (`http://worker:8188`) when rolling service job-counts up onto their host. */
export function portOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  try {
    const trimmed = rawUrl.trim()
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
    return u.port || null
  } catch {
    return null
  }
}

/** Resolve a short hostname to its FQDN via reverse DNS (lookup → PTR).
 *  Short hostnames (no dots) fail RDP security negotiation against domain hosts
 *  because the server's TLS certificate is issued to the FQDN. Returns the
 *  hostname unchanged when it already has dots, is an IP, or DNS fails. */
export async function resolveFqdn(host: string): Promise<string> {
  if (!host || host.includes('.')) return host
  try {
    const { address } = await dns.lookup(host)
    const [fqdn] = await dns.reverse(address)
    if (fqdn?.includes('.')) return fqdn
  } catch {
    /* DNS unavailable or no PTR — short name used as-is */
  }
  return host
}
