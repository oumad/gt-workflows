/* Server ↔ service linkage helpers.
 *
 * Until the data model splits hosts and services into two tables, both live
 * in the unified `servers` table and are distinguished by URL shape:
 *   - A host has a port-less URL (e.g. `http://worker-03`).
 *   - A service has a port (e.g. `http://worker-03:8188`) and conceptually
 *     belongs to whichever host shares its hostname.
 *
 * These helpers do the hostname-based matching in the frontend so the two
 * UIs (Services + Servers) feel linked even before the schema catches up. */

import type { Server as ServerType } from '../types'

/** Extract the hostname portion of a server URL — e.g. "http://worker-03:8188"
 *  → "worker-03". Returns `null` for inputs that won't parse as a URL. */
export function hostnameOf(s: ServerType): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(s.url) ? s.url : `http://${s.url}`)
    return u.hostname
  } catch {
    return null
  }
}

/** Extract the port portion of a server URL, or `null` when there isn't one. */
export function portOf(s: ServerType): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(s.url) ? s.url : `http://${s.url}`)
    return u.port || null
  } catch {
    return null
  }
}

/** True when the record's URL has no port — i.e. it represents a host, not a
 *  service running on it. */
export function isHostRecord(s: ServerType): boolean {
  return portOf(s) == null
}

/** Find the host record (port-less URL) sharing this service's hostname. */
export function findHostFor(service: ServerType, all: ServerType[]): ServerType | null {
  const host = hostnameOf(service)
  if (!host) return null
  for (const s of all) {
    if (s.id === service.id) continue
    if (hostnameOf(s) === host && isHostRecord(s)) return s
  }
  return null
}

/** Find every service record (URL with port) that shares this host's hostname. */
export function findServicesFor(host: ServerType, all: ServerType[]): ServerType[] {
  const hostHost = hostnameOf(host)
  if (!hostHost) return []
  return all.filter((s) => s.id !== host.id && hostnameOf(s) === hostHost && !isHostRecord(s))
}

/** Inherit GPU information from a linked record (host ↔ service) when the
 *  record itself has no GPU populated yet. The GPU probe runs against the
 *  actual ComfyUI/LoRA port, so a freshly created host record may have a null
 *  `gpu` field even though a service on the same hostname has one. */
export function linkedGpu(s: ServerType, all: ServerType[]): string | null {
  if (s.gpu) return s.gpu
  const host = hostnameOf(s)
  if (!host) return null
  for (const other of all) {
    if (other.id === s.id) continue
    if (hostnameOf(other) === host && other.gpu) return other.gpu
  }
  return null
}
