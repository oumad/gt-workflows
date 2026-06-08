/**
 * Shared helpers used by both the services (services-on-hosts) and servers
 * (physical hosts) pages. Anything specific to one view stays in that
 * directory's own `serverHelpers.ts`, which re-exports this module.
 *
 * Created as part of the F10 dedup pass — see the audit report.
 */
import type { Server as ServerType, ServerKind, Page } from '../../types'

export type ServerPatch = Partial<{
  name: string
  url: string
  tags: string[]
  color: string | null
  description: string | null
  type: ServerKind
  isMaintenance: boolean
  isMonitored: boolean
  maxConcurrent: number | null
}>

export type NavigateFn = (p: Page, path?: string) => void

export type ComfyStats = {
  system?: { os?: string; python_version?: string }
  devices?: { name: string; type: string; vram_total: number; vram_free: number }[]
}

export type GpuInfo = {
  id?: number
  name?: string
  usage?: number // percent 0-100
  memory_used?: number // MB
  memory_total?: number // MB
  temperature?: number // celsius
  power?: number // watts
}

export type ServerInsight = {
  serverId: string
  serverName: string
  totalJobs: number
  avgSec: number
  failPct: number
  successPct: number
}

/* ─── Constants ─────────────────────────────── */
export const COLOR_OPTIONS: string[] = [
  'var(--ink)',
  'var(--info)',
  'var(--good)',
  'var(--warn)',
  'var(--accent)',
  'var(--pop-pink)',
  'var(--pop-purple)',
  'var(--pop-cyan)',
]
// Same accent hues used by the jobs live feed so a workflow server and its jobs
// share a color identity (WF = purple, LoRA = accent/orange).
export const TYPE_ACCENT: Record<ServerKind, string> = {
  workflow: 'var(--pop-purple)',
  lora: 'var(--accent)',
}
export const typeAccent = (s: ServerType) => TYPE_ACCENT[s.type] ?? 'var(--ink-3)'
export const typeTint = (s: ServerType) => `color-mix(in oklab, ${typeAccent(s)} 5%, transparent)`
export const serverColor = (s: ServerType) => s.color ?? typeAccent(s)

/* ─── Helpers ───────────────────────────────── */
export function serverStatus(
  s: ServerType,
): 'ok' | 'warn' | 'down' | 'busy' | 'maintenance' {
  if (s.isMaintenance) return 'maintenance'
  if (!s.health || s.health.status === 'offline' || s.health.status === 'unknown') return 'down'
  if ((s.activeJobs ?? 0) + (s.waitingJobs ?? 0) > 0) return 'busy'
  if (s.health.latencyMs && s.health.latencyMs > 200) return 'warn'
  return 'ok'
}

export const STATUS_TONE: Record<string, string> = {
  ok: 'good',
  warn: 'warn',
  down: 'bad',
  busy: 'info',
  maintenance: 'warn',
}
export const STATUS_LABEL: Record<string, string> = {
  ok: 'Online',
  warn: 'Warning',
  down: 'Down',
  busy: 'Busy',
  maintenance: 'Maint.',
}

// Duration + relative-time formatting now live in the shared lib/format
// module; re-exported here so existing `serverHelpers` imports keep working.
export { fmtDuration, fmtRelativeTime } from '../../lib/format'

/** Download an array of parsed log lines as a TSV file. Used by the inline
 *  Logs tab and the popup modal. */
export function exportLogs(
  lines: { t: string | null; level: string | null; msg: string }[],
  serverName: string,
): void {
  const text = lines.map((l) => [l.t ?? '', l.level ?? '', l.msg].join('\t')).join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${serverName}-logs.txt`
  a.click()
  URL.revokeObjectURL(url)
}

export function fmtBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024
  return `${gb.toFixed(1)} GB`
}

export function fmtMB(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`
}

// Parses whatever shape ComfyUI returns into a flat list of lines. Recent versions
// expose /internal/logs (returns { entries: [{ t, m }] }); older ones don't, and we
// fall back to /history on the backend.
export const COMFY_LOG_LIMIT = 100

export function flattenComfyLogs(payload: {
  source: 'logs' | 'history'
  data: unknown
  limit?: number
}): { t: string | null; level: string | null; msg: string }[] {
  const out: { t: string | null; level: string | null; msg: string }[] = []
  const limit = payload.limit ?? COMFY_LOG_LIMIT

  function parseEntry(e: unknown): { t: string | null; level: string | null; msg: string } | null {
    let rawT: unknown
    let rawM: string | undefined
    if (Array.isArray(e)) {
      // Some ComfyUI versions emit [timestamp, message] arrays
      rawT = e[0]
      rawM = e[1] != null ? String(e[1]) : undefined
    } else if (e && typeof e === 'object') {
      const obj = e as Record<string, unknown>
      rawT = obj['t'] ?? obj['timestamp'] ?? obj['time']
      rawM = String(obj['m'] ?? obj['message'] ?? obj['text'] ?? obj['msg'] ?? '')
    }
    const msg = (rawM ?? '').trim()
    if (!msg) return null
    const m = msg.match(/^\[?(INFO|WARN|WARNING|ERROR|DEBUG)\]?:?\s*(.*)$/i)
    // ComfyUI timestamps are float seconds; JS Date expects milliseconds
    const tNum = typeof rawT === 'number' ? rawT : typeof rawT === 'string' ? parseFloat(rawT) : NaN
    const tMs = !isNaN(tNum) ? (tNum < 1e10 ? tNum * 1000 : tNum) : NaN
    return {
      t: !isNaN(tMs)
        ? new Date(tMs).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : null,
      level: m ? m[1].toUpperCase().replace('WARNING', 'WARN') : null,
      msg: m ? m[2] : msg,
    }
  }

  if (payload.source === 'logs') {
    const data = payload.data as { entries?: unknown; logs?: unknown; lines?: unknown }
    const entries = Array.isArray(data.entries) ? data.entries : []
    for (const e of entries) {
      const parsed = parseEntry(e)
      if (parsed) out.push(parsed)
    }
    // Fall back to other known shapes when entries are absent or all empty
    if (out.length === 0) {
      if (typeof payload.data === 'string') {
        // ComfyUI /internal/logs returns a plain string: "YYYY-MM-DDTHH:MM:SS.ffffff - message\n..."
        const parts = payload.data.split(/(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+ - )/)
        for (const part of parts.slice(-limit)) {
          const m = part.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+) - ([\s\S]*)/)
          if (!m) continue
          const msg = m[2].trim()
          if (!msg) continue
          const lm = msg.match(/^\[?(INFO|WARN|WARNING|ERROR|DEBUG)\]?:?\s*(.*)$/i)
          out.push({
            t: new Date(m[1]).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            level: lm ? lm[1].toUpperCase().replace('WARNING', 'WARN') : null,
            msg: lm ? lm[2] : msg,
          })
        }
      } else {
        const rawLines: unknown[] = Array.isArray(data.logs)
          ? data.logs
          : Array.isArray(data.lines)
            ? data.lines
            : Array.isArray(payload.data)
              ? (payload.data as unknown[])
              : []
        for (const raw of rawLines.slice(-limit)) {
          const parsed = parseEntry(raw)
          if (parsed) {
            out.push(parsed)
            continue
          }
          const msg = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw)
          if (msg) out.push({ t: null, level: null, msg })
        }
      }
    }
  } else {
    // /history shape: { "<prompt_id>": { prompt: [...], status: { ... }, ... }, ... }
    const data = payload.data as Record<
      string,
      {
        status?: {
          status_str?: string
          completed?: boolean
          messages?: [string, Record<string, unknown>][]
        }
      }
    >
    for (const [pid, h] of Object.entries(data ?? {})) {
      const last = Array.isArray(h?.status?.messages) ? h.status.messages.slice(-3) : []
      if (last.length === 0) {
        out.push({
          t: null,
          level: h?.status?.completed ? 'INFO' : 'WARN',
          msg: `prompt ${pid.slice(0, 8)} — ${h?.status?.status_str ?? 'unknown'}`,
        })
      } else {
        for (const [kind, payload] of last) {
          out.push({
            t: null,
            level: kind === 'execution_error' ? 'ERROR' : 'INFO',
            msg: `${pid.slice(0, 8)} · ${kind}${payload ? ` ${JSON.stringify(payload).slice(0, 120)}` : ''}`,
          })
        }
      }
    }
  }
  return out.slice(-limit)
}

/* ─── Host-only URL validation ───────────────────────────────
 * Lives here so both directories agree on the format if either ever needs it.
 * Currently only the physical-servers page (`servers/`) uses it. Services
 * (a service is "host:port") use a different validator inline. */
export function validateHostOnlyUrl(
  input: string,
): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, message: 'URL is required.' }
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
  } catch {
    return { ok: false, message: 'Invalid hostname or IP.' }
  }
  if (u.port) {
    return {
      ok: false,
      message:
        'Server URL must not include a port. Ports belong to services running on this server.',
    }
  }
  if (u.pathname && u.pathname !== '/') {
    return { ok: false, message: 'Server URL must not include a path.' }
  }
  if (u.search || u.hash) {
    return { ok: false, message: 'Server URL must not include a query string or fragment.' }
  }
  return { ok: true, url: `${u.protocol}//${u.hostname}` }
}

/** Normalize a user-typed host string to canonical `<scheme>://<host>` form,
 *  or return `null` if it doesn't validate. Handy for input onBlur cleanup. */
export function normalizeHostOnlyUrl(input: string): string | null {
  const v = validateHostOnlyUrl(input)
  return v.ok ? v.url : null
}
