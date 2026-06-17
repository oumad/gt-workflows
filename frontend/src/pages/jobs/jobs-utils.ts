import type { WfJob, LoraJob, UnifiedJob, UnifiedLiveJob, Tone, Row } from './jobs-types'

/* ─── Helpers ───────────────────────────────────────────────────── */
export function extractHost(url: string) {
  if (!url) return null
  try {
    return new URL(url.startsWith('http') ? url : `http://${url}`).host
  } catch {
    return url || null
  }
}
// Defensive against undefined: upstream adapters can be missing the field
// (e.g. an API response from an older deploy than the type expects).
export function statusLabel(s: string | null | undefined) {
  if (!s) return 'Unknown'
  const MAP: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Aborted',
    active: 'Running',
    running: 'Running',
    waiting: 'Waiting',
    pending: 'Waiting',
  }
  return MAP[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}
export function statusTone(s: string | null | undefined): Tone {
  if (s === 'completed') return 'good'
  if (s === 'failed' || s === 'error') return 'bad'
  if (s === 'active' || s === 'running') return 'info'
  return 'muted'
}
export function fmtSec(s: number | null | undefined) {
  if (s == null || s < 0) return '—'
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}
export function fmtTime(ts: string | null) {
  if (!ts) return '—'
  // For today, just the time ("11:07am"). For yesterday, "Yesterday 11:07am".
  // For older dates include the date so a row from 160 days ago can't masquerade
  // as a recent event by virtue of sharing a clock time.
  const d = new Date(ts)
  const now = new Date()
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const t = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '')
  if (d.toDateString() === now.toDateString()) return t
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${t}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}`
}
export function fmtCompleted(d: Date | null) {
  if (!d) return '—'
  const now = new Date(),
    yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const t = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '')
  if (d.toDateString() === now.toDateString()) return `Today ${t}`
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${t}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${t}`
}
export function avg(arr: number[]) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
}
function safeTotalSec(cre: Date, fin: Date | null): number | null {
  if (!fin) return null
  const s = Math.floor((fin.getTime() - cre.getTime()) / 1000)
  return s >= 0 ? s : null
}

/* ─── Time helpers ──────────────────────────────────────────────── */
// Floor-divide (ms diff) to whole seconds. `clamp` clips negatives to 0.
function diffSec(laterMs: number, earlierMs: number, clamp = false): number {
  const s = Math.floor((laterMs - earlierMs) / 1000)
  return clamp && s < 0 ? 0 : s
}

// WF wait time: prefer queue ms fields, else gap to start, else gap to now if still pre-run.
function wfWaitSec(
  waitMs: number | null,
  comfyQueueMs: number | null | undefined,
  staMs: number | null,
  creMs: number,
  status: string,
  now: number,
): number | null {
  if (waitMs != null) return Math.floor((waitMs + (comfyQueueMs ?? 0)) / 1000)
  if (staMs != null) return diffSec(staMs, creMs, true)
  if (status === 'waiting' || status === 'delayed' || status === 'active')
    return diffSec(now, creMs, true)
  return null
}

// LoRA-style wait: gap createdAt → startedAt, else still-waiting fallback to now.
function loraWaitSec(staMs: number | null, creMs: number, now: number): number {
  return staMs != null ? diffSec(staMs, creMs, true) : diffSec(now, creMs)
}

// Live wait: freeze at execution start when active, else accumulate to now.
// Uses truthy check on startMs to mirror the original `&& startMs` semantics.
function liveWaitSec(active: boolean, startMs: number | null, creMs: number, now: number): number {
  return active && startMs ? diffSec(startMs, creMs, true) : diffSec(now, creMs)
}

// Whole seconds from a millisecond duration; null passes through. Used for the
// per-row processing duration (duration_ms → durationSec).
function msToSec(ms: number | null): number | null {
  return ms != null ? Math.floor(ms / 1000) : null
}

// Elapsed for running jobs: now − start, or null when start is missing.
function runningElapsed(staMs: number | null, now: number): number | null {
  return staMs != null ? diffSec(now, staMs) : null
}

/* ─── Row converters ────────────────────────────────────────────── */
export function wfToRow(j: WfJob, now: number): Row {
  const st = j.status,
    fin = j.finishedAt ? new Date(j.finishedAt) : null
  const cre = new Date(j.createdAt)
  const sta = j.processedAt ? new Date(j.processedAt) : null
  const staMs = sta ? sta.getTime() : null
  const server = j.serverUrl ? extractHost(j.serverUrl) : null

  return {
    kind: 'wf',
    key: `wf:${j.id}`,
    id: j.id.slice(0, 10),
    rawId: j.id,
    name: j.workflowName && j.workflowName !== 'Unknown' ? j.workflowName : '(unnamed)',
    arch: null,
    who: j.data?.userName ?? '—',
    server,
    status: st,
    statusLabel: statusLabel(st),
    statusTone: statusTone(st),
    elapsedSec: st === 'active' ? runningElapsed(staMs, now) : null,
    timeoutSec: 600,
    waitingSec: st === 'waiting' || st === 'delayed' ? diffSec(now, cre.getTime()) : null,
    startedLabel: j.processedAt ? fmtTime(j.processedAt) : null,
    totalSec: safeTotalSec(cre, fin),
    durationSec: msToSec(j.durationMs),
    waitTimeSec: wfWaitSec(j.waitMs, j.comfyQueueMs, staMs, cre.getTime(), st, now),
    completedAt: fin,
    createdAt: j.createdAt,
    processedAt: j.processedAt,
    execAt: j.comfyStartedAt,
    finishedAt: j.finishedAt,
    failedReason: j.failedReason,
    raw: j,
    phase: null,
    clientId: j.clientId,
    serverId: j.serverId,
  }
}

export function loraToRow(j: LoraJob, now: number): Row {
  const st = j.status,
    fin = j.finishedAt ? new Date(j.finishedAt) : null
  const cre = new Date(j.createdAt),
    sta = j.startedAt ? new Date(j.startedAt) : null
  const staMs = sta ? sta.getTime() : null
  const server = j.serverUrl ? extractHost(j.serverUrl) : null
  return {
    kind: 'lora',
    key: `lora:${j.id}`,
    id: j.id.slice(0, 10),
    rawId: j.id,
    name: j.outputName,
    arch: j.baseModel ?? null,
    who: j.client?.name ?? j.client?.email ?? '—',
    server,
    status: st,
    statusLabel: statusLabel(st),
    statusTone: statusTone(st),
    elapsedSec: st === 'running' ? runningElapsed(staMs, now) : null,
    timeoutSec: 7200,
    waitingSec: st === 'pending' ? diffSec(now, cre.getTime()) : null,
    startedLabel: j.startedAt ? fmtTime(j.startedAt) : null,
    totalSec: safeTotalSec(cre, fin),
    durationSec: msToSec(j.durationMs),
    waitTimeSec: loraWaitSec(staMs, cre.getTime(), now),
    completedAt: fin,
    createdAt: j.createdAt,
    processedAt: j.startedAt,
    execAt: null,
    finishedAt: j.finishedAt,
    failedReason: j.failedReason,
    raw: j,
    phase: null,
    clientId: j.client?.id ?? null,
    serverId: j.serverId,
  }
}

/** Unified row converter — used for /api/jobs (list) responses. Replaces
 *  the WF/LoRA split that the old typed converters handled. */
export function unifiedToRow(j: UnifiedJob, now: number): Row {
  const isWf = j.type === 'wf'
  const st = j.status
  const fin = j.finishedAt ? new Date(j.finishedAt) : null
  const cre = new Date(j.createdAt)
  const sta = j.startedAt ? new Date(j.startedAt) : null
  const staMs = sta ? sta.getTime() : null
  const creMs = cre.getTime()
  const server = j.serverUrl ? extractHost(j.serverUrl) : null

  const waitTimeSec = isWf
    ? wfWaitSec(j.waitMs, j.comfyQueueMs, staMs, creMs, st, now)
    : loraWaitSec(staMs, creMs, now)

  // The detail modal (and the History focus-by-cell click) still wants the
  // original split shape so it can read fields like clientId / processId /
  // workflowId directly. Project the unified row into the matching half.
  const rawAsWf: WfJob = {
    id: j.id,
    workflowId: j.workflowId,
    workflowName: j.name,
    serverId: j.serverId,
    serverUrl: j.serverUrl,
    clientId: j.clientId,
    status: j.status,
    durationMs: j.durationMs,
    failedReason: j.failedReason,
    createdAt: j.createdAt,
    processedAt: j.startedAt,
    finishedAt: j.finishedAt,
    comfyStartedAt: j.comfyStartedAt,
    waitMs: j.waitMs,
    comfyQueueMs: j.comfyQueueMs,
    comfyRunMs: j.comfyRunMs,
    data: j.userName ? { userName: j.userName } : null,
  }
  const rawAsLora: LoraJob = {
    id: j.id,
    processId: j.id,
    outputName: j.name ?? '',
    baseModel: j.arch,
    serverId: j.serverId,
    serverUrl: j.serverUrl,
    status: j.status,
    failedReason: j.failedReason,
    durationMs: j.durationMs,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    client: j.clientId ? { id: j.clientId, name: j.userName, email: null } : null,
  }

  const running = isWf ? st === 'active' : st === 'running'
  return {
    kind: isWf ? 'wf' : 'lora',
    key: `${j.type}:${j.id}`,
    id: j.id.slice(0, 10),
    rawId: j.id,
    name: j.name && j.name !== 'Unknown' ? j.name : '(unnamed)',
    arch: j.arch,
    who: j.userName ?? '—',
    server,
    status: st,
    statusLabel: statusLabel(st),
    statusTone: statusTone(st),
    elapsedSec: running ? runningElapsed(staMs, now) : null,
    timeoutSec: isWf ? 600 : 7200,
    waitingSec:
      st === 'waiting' || st === 'pending' || st === 'delayed' ? diffSec(now, creMs) : null,
    startedLabel: j.startedAt ? fmtTime(j.startedAt) : null,
    totalSec: safeTotalSec(cre, fin),
    durationSec: msToSec(j.durationMs),
    waitTimeSec,
    completedAt: fin,
    createdAt: j.createdAt,
    processedAt: j.startedAt,
    execAt: j.comfyStartedAt,
    finishedAt: j.finishedAt,
    failedReason: j.failedReason,
    raw: isWf ? rawAsWf : rawAsLora,
    phase: null,
    clientId: j.clientId,
    serverId: j.serverId,
  }
}

/** Live row converter — used for /api/jobs/live responses. Both WF and LoRA
 *  share the UnifiedLiveJob shape (epoch ms timestamps), differing only in
 *  whether comfyStartedAt is populated and whether arch is set. */
export function liveToRow(j: UnifiedLiveJob, status: 'active' | 'waiting', now: number): Row {
  const isWf = j.type === 'wf'
  const isActive = status === 'active'
  const server = j.serverUrl ? extractHost(j.serverUrl) : null
  const phase: Row['phase'] =
    isWf && isActive ? (j.comfyStartedAt ? 'generating' : 'comfyui-wait') : null

  // Freeze wait time at the moment execution started; otherwise accumulate.
  const waitStartMs = isWf ? j.comfyStartedAt : j.processedOn
  const waitTimeSec = liveWaitSec(isActive, waitStartMs, j.createdAt, now)

  return {
    kind: isWf ? 'wf' : 'lora',
    key: `${j.type}:${j.id}`,
    id: j.id.slice(0, 10),
    rawId: j.id,
    name: j.name || '(unnamed)',
    arch: j.arch,
    who: j.userName || '—',
    server,
    status: isWf ? (isActive ? 'active' : 'waiting') : isActive ? 'running' : 'pending',
    statusLabel: isActive ? 'Running' : 'Waiting',
    statusTone: isActive ? 'info' : 'muted',
    elapsedSec: isActive && j.processedOn ? diffSec(now, j.processedOn) : null,
    timeoutSec: isWf ? 600 : 7200,
    waitingSec: !isActive ? waitTimeSec : null,
    startedLabel: j.processedOn ? fmtTime(new Date(j.processedOn).toISOString()) : null,
    totalSec: null,
    durationSec: null,
    waitTimeSec,
    completedAt: null,
    createdAt: new Date(j.createdAt).toISOString(),
    processedAt: j.processedOn ? new Date(j.processedOn).toISOString() : null,
    execAt: isWf && j.comfyStartedAt ? new Date(j.comfyStartedAt).toISOString() : null,
    finishedAt: null,
    failedReason: null,
    raw: j as unknown as WfJob | LoraJob,
    phase,
    // Resolved server-side in buildLivePayload() from serverUrl + the job's
    // user external id — lets the live-row menu deep-link to user/server pages.
    clientId: j.clientId,
    serverId: j.serverId,
  }
}
