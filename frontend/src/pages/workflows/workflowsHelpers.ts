import type React from 'react'
import type { Workflow, Server } from '../../types'

/* ─── Types ─────────────────────────────────────────────────── */
export type CatInfo = { id: string; name: string; color: string; items: Workflow[] }
export type DragState = { catId: string; idx: number } | null

/* ─── Utilities ─────────────────────────────────────────────── */
export function hashHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export function thumbStyle(seed: number, _color: string, imgKey: string): React.CSSProperties {
  const hue = hashHue(imgKey || String(seed))
  const c1 = `oklch(72% 0.16 ${hue})`
  const c2 = `oklch(58% 0.18 ${(hue + 40) % 360})`
  return {
    background: `radial-gradient(circle at 30% 30%, ${c1} 0%, transparent 60%),
      radial-gradient(circle at 75% 70%, ${c2} 0%, transparent 65%),
      linear-gradient(135deg, ${c1}, ${c2})`,
  }
}

export function cardTint(imgKey: string): React.CSSProperties {
  const hue = hashHue(imgKey)
  return { background: `linear-gradient(180deg, oklch(96% 0.04 ${hue}) 0%, var(--surface) 60%)` }
}

export function workflowStats(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  const r = (n: number) => {
    h = (h * 1103515245 + 12345) | 0
    return Math.abs(h % n)
  }
  const runs = 60 + r(940)
  const success = 78 + r(21)
  const avgSec = 6 + r(594)
  const p95Sec = Math.round(avgSec * (1.6 + r(120) / 100))
  const maxSec = Math.round(p95Sec * (1.3 + r(140) / 100))
  return { runs, success, avgSec, p95Sec, maxSec }
}

export const MOCK_SERVERS = [
  'node-01',
  'node-02',
  'node-03',
  'node-04',
  'node-05',
  'node-06',
  'node-07',
  'node-08',
  'node-09',
  'node-10',
  'node-12',
]

export function workflowServerMatrix(name: string, serverIds: string[]) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  const r = () => {
    h = (h * 1103515245 + 12345) | 0
    return Math.abs(h % 1000) / 1000
  }
  const declared = serverIds.filter((s) => /^node-/.test(s))
  const candidates = declared.length ? declared : MOCK_SERVERS
  const k = 2 + Math.floor(r() * 3)
  const picks: string[] = []
  const pool = candidates.slice()
  for (let i = 0; i < Math.min(k, pool.length); i++) {
    const idx = Math.floor(r() * pool.length)
    picks.push(pool.splice(idx, 1)[0])
  }
  const weights = picks.map((_, i) => (i === 0 ? 40 + r() * 40 : 5 + r() * 35))
  const sum = weights.reduce((a, b) => a + b, 0)
  return picks.map((s, i) => ({ server: s, pct: weights[i] / sum }))
}

// Duration formatting now lives in the shared lib/format module; `fmtDur` is
// kept as an alias of the canonical `fmtDuration` so existing imports work.
export { fmtDuration as fmtDur } from '../../lib/format'

export const CAT_COLORS: Record<string, string> = {
  image: 'var(--pop-purple)',
  training: 'var(--pop-pink)',
  data: 'var(--info)',
  audio: 'var(--pop-cyan)',
  ops: 'var(--good)',
  video: 'var(--pop-yellow)',
}
export const catColor = (cat: string) => CAT_COLORS[cat.toLowerCase()] ?? 'var(--ink-3)'

export const UNCATEGORIZED = 'uncategorized'
export const workflowCategory = (w: Workflow) => w.category?.trim().toLowerCase() || UNCATEGORIZED
export const categoryName = (id: string) =>
  id === UNCATEGORIZED ? 'Uncategorized' : id.charAt(0).toUpperCase() + id.slice(1)
export const compareCategories = (a: string, b: string) => {
  if (a === UNCATEGORIZED && b !== UNCATEGORIZED) return 1
  if (b === UNCATEGORIZED && a !== UNCATEGORIZED) return -1
  return a.localeCompare(b)
}

/* ─── Server URLs ───────────────────────────────────────────── */

/** Normalize a server URL for comparison — lowercased, trailing slash stripped. */
export const normServerUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '')

/** Friendly label for a workflow's server URL, formatted as
 *  `<server_name>:<port>` where:
 *
 *    server_name  = the registered host (port-less Server record) whose URL
 *                   shares the same hostname; falls back to the URL's raw
 *                   hostname when no host is registered.
 *    port         = the URL's port; omitted entirely when the URL has none.
 *
 *  e.g. given a host record `{ name: 'worker-03', url: 'http://worker-03' }`
 *  and a workflow URL `http://worker-03:8188`, this returns `worker-03:8188`.
 *  The workflow's params.json is left untouched — only the displayed form
 *  goes through this helper. */
export function serverLabel(url: string, servers: Server[]): string {
  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`)
  } catch {
    return url
  }
  const host = parsed.hostname
  const port = parsed.port
  // Find a registered *host* record on this hostname (port-less URL).
  for (const s of servers) {
    let su: URL
    try {
      su = new URL(/^https?:\/\//i.test(s.url) ? s.url : `http://${s.url}`)
    } catch {
      continue
    }
    if (su.hostname === host && !su.port) {
      return port ? `${s.name}:${port}` : s.name
    }
  }
  return port ? `${host}:${port}` : host
}
