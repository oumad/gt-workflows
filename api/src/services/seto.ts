/**
 * Business logic for the Seto assistant — applies a rule set to a single
 * entity (job / service / server) and returns a list of human-readable
 * findings. Wraps the repository with a 5-minute cache for the
 * avg-duration aggregate (used by the per-job ETA finding).
 */
import { TtlCache } from '../lib/ttlCache.js'
import * as repo from '../repositories/seto.js'
import type { Cfg, Finding, JobLookup, CheckResponse, CheckKind } from '../models/seto.js'
import type { PatchConfigInput } from '../validators/seto.js'

const DEFAULTS: Cfg = {
  maxUserJobs: 3,
  maxServiceJobs: 3,
  maxServerJobs: 3,
  maxWaitTimeSec: 600,
  maxLinkedWf: 3,
  maxServerLatencyMs: 100,
  maxServerServices: 2,
}

const WF_TIMEOUT_SEC = 600 // matches frontend Row.timeoutSec for WF
const LORA_TIMEOUT_SEC = 7_200 // matches frontend Row.timeoutSec for LoRA

const avgDurCache = new TtlCache(5 * 60_000)
const AVG_DUR_KEY = 'avg-durations'

/* ─── Config ────────────────────────────────────────────────── */

export async function getConfig(): Promise<Cfg> {
  const row = await repo.findConfig()
  if (!row) return DEFAULTS
  return {
    maxUserJobs: row.maxUserJobs,
    maxServiceJobs: row.maxServiceJobs,
    maxServerJobs: row.maxServerJobs,
    maxWaitTimeSec: row.maxWaitTimeSec,
    maxLinkedWf: row.maxLinkedWf,
    maxServerLatencyMs: row.maxServerLatencyMs,
    maxServerServices: row.maxServerServices,
  }
}

export async function patchConfig(input: PatchConfigInput): Promise<Cfg> {
  await repo.upsertConfig({ ...DEFAULTS, ...input }, input)
  return getConfig()
}

/* ─── Helpers ───────────────────────────────────────────────── */

function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname
  } catch {
    return null
  }
}

function fmtDuration(sec: number | null): string {
  if (sec == null || sec < 0) return '—'
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${sec}s`
}

/** Map a raw failed_reason to a short category, mirroring (a subset of) the
 *  frontend's classifyError. Lets Seto prefix the failure body with [OOM] /
 *  [TIMEOUT] etc. instead of dumping the raw stack on the user. */
function classifyReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  const r = reason
  if (/cancel|aborted|SIGINT|SIGTERM/i.test(r)) return 'ABORTED'
  if (/out of memory|OOM|CUDA out|HIP out/i.test(r)) return 'OOM'
  if (/loss|NaN|diverged/i.test(r)) return 'LOSS_DIVERGED'
  if (/shape|dimension|tensor.*(size|mismatch)|reshape/i.test(r)) return 'TENSOR_SHAPE'
  if (/ENOSPC|disk full|no space left/i.test(r)) return 'DISK_FULL'
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(r)) return 'NETWORK'
  if (/timeout|timed out|ETIMEDOUT/i.test(r)) return 'TIMEOUT'
  if (/import.*error|ModuleNotFound|cannot find module/i.test(r)) return 'IMPORT_ERROR'
  if (/401|unauthorized/i.test(r)) return 'UNAUTHORIZED'
  if (/5\d{2}|server error|bad gateway|gateway timeout/i.test(r)) return 'UPSTREAM_5XX'
  return null
}

function isServiceDown(svc: { lastPingAt: Date | null; lastPingOk: boolean | null }): boolean {
  return !svc.lastPingAt || !svc.lastPingOk
}

/** Hostname of a server/service URL (scheme optional), or null if unparseable. */
function recordHostname(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname || null
  } catch {
    return null
  }
}

/** True when the URL carries a port → it's a service; port-less → a host. */
function recordHasPort(url: string): boolean {
  try {
    return !!new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).port
  } catch {
    return false
  }
}

async function lookupJob(id: string): Promise<JobLookup | null> {
  // Try WF first (numeric BullMQ ids); fall back to LoRA (uuid).
  const wf = await repo.findWfJob(id)
  if (wf) {
    return {
      kind: 'wf',
      id: wf.id,
      name: wf.workflowName,
      status: wf.status,
      clientId: wf.clientId,
      userName: (wf.data as { userName?: string } | null)?.userName ?? null,
      serverId: wf.serverId,
      serverUrl: wf.serverUrl,
      createdAt: wf.createdAt,
      startedAt: wf.processedAt,
      finishedAt: wf.finishedAt,
      durationMs: wf.durationMs,
      waitMs: wf.waitMs,
      failedReason: wf.failedReason,
    }
  }
  // LoRA ids are uuids — guard the lookup so malformed ids don't error.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const lora = await repo.findLoraJob(id)
  if (lora) {
    const waitMs = lora.startedAt
      ? Math.max(0, lora.startedAt.getTime() - lora.createdAt.getTime())
      : null
    return {
      kind: 'lora',
      id: lora.id,
      name: lora.outputName,
      status: lora.status,
      clientId: lora.clientId,
      userName: null,
      serverId: lora.serverId,
      serverUrl: lora.serverUrl,
      createdAt: lora.createdAt,
      startedAt: lora.startedAt,
      finishedAt: lora.finishedAt,
      durationMs: lora.durationMs,
      waitMs,
      failedReason: lora.failedReason,
    }
  }
  return null
}

const unknownJobFinding = (entity: string): Finding[] => [
  {
    code: 'unknown',
    severity: 'info',
    title: `${entity} not found`,
    body: `I could not locate this ${entity.toLowerCase()} — it may have been pruned from the database.`,
  },
]

const getAvgDurations = () => avgDurCache.memo(AVG_DUR_KEY, () => repo.avgDurationsLast90d())

/* ─── Live job rule evaluator ───────────────────────────────── */

async function checkLiveJob(jobId: string, cfg: Cfg): Promise<Finding[]> {
  const job = await lookupJob(jobId)
  if (!job) return unknownJobFinding('Job')

  const findings: Finding[] = []
  const now = Date.now()
  const hostname = hostnameOf(job.serverUrl)
  const counts = await repo.liveCounts(job.clientId, job.serverId, hostname)
  const isRunning = job.kind === 'wf' ? job.status === 'active' : job.status === 'running'
  const isWaiting = job.kind === 'wf' ? job.status === 'waiting' : job.status === 'pending'

  // ── State + "why is it stuck" ──
  // For a waiting job, the most useful diagnostic is the service health, so
  // check it FIRST — the user opens Seto expecting an answer to "why isn't
  // this running yet?" and we should put it at the top of the list.
  if (isWaiting && job.serverId) {
    const svc = await repo.findServer(job.serverId)
    if (svc?.isMaintenance) {
      findings.push({
        code: 'jo_blocked_maint',
        severity: 'bad',
        title: 'Service is in maintenance',
        body: 'The service this job is assigned to is offline for maintenance. The job will not start until an admin brings it back.',
      })
    } else if (svc && isServiceDown(svc)) {
      findings.push({
        code: 'jo_blocked_down',
        severity: 'bad',
        title: 'Service is unreachable',
        body: 'The service this job is assigned to has failed recent health probes. The job will not start until it recovers.',
      })
    }
  }

  // Baseline state line — always emit one, so the user gets a snapshot even
  // when nothing is wrong. Without this the modal renders the green
  // "Everything is fine" card and tells the user nothing useful.
  if (isWaiting) {
    const waitSec = Math.floor((now - job.createdAt.getTime()) / 1000)
    findings.push({
      code: 'jo_state',
      severity: 'info',
      title: `Queued for ${fmtDuration(waitSec)}`,
      body:
        counts.serviceJobs > 1
          ? `${counts.serviceJobs - 1} other job${counts.serviceJobs - 1 === 1 ? ' is' : 's are'} active or waiting on the same service.`
          : 'Waiting for the service to pick this job up.',
    })
  } else if (isRunning && job.startedAt) {
    const elapsedSec = Math.floor((now - job.startedAt.getTime()) / 1000)
    findings.push({
      code: 'jo_state',
      severity: 'info',
      title: `Running for ${fmtDuration(elapsedSec)}`,
      body: `Picked up by ${hostname ?? 'the service'} ${fmtDuration(elapsedSec)} ago.`,
    })
  } else if (job.status === 'completed') {
    findings.push({
      code: 'jo_state',
      severity: 'info',
      title: 'Already completed',
      body: 'This job has finished — open the history view for the full breakdown.',
    })
  } else if (job.status === 'failed') {
    findings.push({
      code: 'jo_state',
      severity: 'info',
      title: 'Already failed',
      body: 'This job has failed — open the history view for the failure reason.',
    })
  }

  // ── Saturation thresholds (only meaningful while in flight) ──
  if (isWaiting || isRunning) {
    if (counts.userJobs >= cfg.maxUserJobs) {
      findings.push({
        code: 'us_many_jobs',
        severity: 'warn',
        title: `User has ${counts.userJobs} jobs in flight`,
        body: `${job.userName ?? 'This user'} currently has ${counts.userJobs} job${counts.userJobs === 1 ? '' : 's'} running or waiting (threshold: ${cfg.maxUserJobs}). Their throughput may be limited by the queue.`,
      })
    }
    if (counts.serviceJobs >= cfg.maxServiceJobs) {
      findings.push({
        code: 'si_many_jobs',
        severity: 'warn',
        title: `Service has ${counts.serviceJobs} jobs in flight`,
        body: `The ${job.kind === 'lora' ? 'LoRA' : 'workflow'} service this job is on has ${counts.serviceJobs} job${counts.serviceJobs === 1 ? '' : 's'} active or waiting (threshold: ${cfg.maxServiceJobs}). It might be saturated.`,
      })
    }
    if (counts.serverJobs >= cfg.maxServerJobs) {
      findings.push({
        code: 'sv_many_jobs',
        severity: 'warn',
        title: `Server has ${counts.serverJobs} jobs in flight`,
        body: `The physical server (${hostname ?? 'unknown host'}) is running or queueing ${counts.serverJobs} job${counts.serverJobs === 1 ? '' : 's'} across its services (threshold: ${cfg.maxServerJobs}). It might be saturated.`,
      })
    }
  }

  // ── Per-job timing while running ──
  if (isRunning && job.startedAt) {
    const elapsedSec = Math.floor((now - job.startedAt.getTime()) / 1000)
    const timeoutSec = job.kind === 'wf' ? WF_TIMEOUT_SEC : LORA_TIMEOUT_SEC

    if (elapsedSec > timeoutSec) {
      findings.push({
        code: 'jo_timeout',
        severity: 'bad',
        title: 'Job past its timeout',
        body: `This job has been running for ${fmtDuration(elapsedSec)} — past the ${fmtDuration(timeoutSec)} ${job.kind === 'lora' ? 'training' : 'workflow'} timeout. It is likely to be terminated.`,
      })
    }

    if (job.kind === 'wf' && job.name) {
      const avgDurations = await getAvgDurations()
      const eta = avgDurations.get(job.name) ?? null
      if (eta != null) {
        if (elapsedSec > eta) {
          findings.push({
            code: 'jo_eta',
            severity: 'warn',
            title: 'Job is taking longer than usual',
            body: `Past runs of "${job.name}" average ${fmtDuration(eta)}. This one is already at ${fmtDuration(elapsedSec)} and still going.`,
          })
        } else {
          // Progress info — gives the user an ETA even when nothing is wrong.
          findings.push({
            code: 'jo_eta_progress',
            severity: 'info',
            title: `~${fmtDuration(Math.max(1, eta - elapsedSec))} remaining`,
            body: `Past runs of "${job.name}" average ${fmtDuration(eta)}. This one is at ${fmtDuration(elapsedSec)} so far.`,
          })
        }
      }
    }
  }

  // ── Wait time (applies to running jobs that waited a while too) ──
  if (isWaiting || isRunning) {
    const waitSec =
      job.waitMs != null
        ? Math.floor(job.waitMs / 1000)
        : job.startedAt
          ? Math.floor((job.startedAt.getTime() - job.createdAt.getTime()) / 1000)
          : Math.floor((now - job.createdAt.getTime()) / 1000)
    if (waitSec > cfg.maxWaitTimeSec) {
      findings.push({
        code: 'jo_slow',
        severity: 'warn',
        title: 'Long queue wait',
        body: `This job waited ${fmtDuration(waitSec)} before being picked up (threshold: ${fmtDuration(cfg.maxWaitTimeSec)}).`,
      })
    }
  }

  return findings
}

/* ─── History job evaluator ─────────────────────────────────── */

async function checkHistoryJob(jobId: string, cfg: Cfg): Promise<Finding[]> {
  const job = await lookupJob(jobId)
  if (!job) return unknownJobFinding('Job')

  const findings: Finding[] = []
  const totalSec = job.durationMs != null ? Math.floor(job.durationMs / 1000) : null
  const waitSec = job.waitMs != null ? Math.floor(job.waitMs / 1000) : null
  const timeoutSec = job.kind === 'wf' ? WF_TIMEOUT_SEC : LORA_TIMEOUT_SEC

  // Quick classification of the failure reason mirrors classifyError on the
  // frontend — we just need to flag the ABORTED bucket for a softer message.
  const reason = job.failedReason ?? ''
  const aborted = /cancel|aborted|SIGINT|SIGTERM/i.test(reason)

  if (job.status === 'completed') {
    findings.push({
      code: 'jo_done_ok',
      severity: 'info',
      title: 'Job completed successfully',
      body:
        totalSec != null
          ? `Finished in ${fmtDuration(totalSec)}${waitSec != null ? ` (waited ${fmtDuration(waitSec)} first)` : ''}.`
          : 'Finished without errors.',
    })
    if (totalSec != null && totalSec > timeoutSec) {
      findings.push({
        code: 'jo_timeout',
        severity: 'warn',
        title: 'Duration exceeded the soft timeout',
        body: `Ran for ${fmtDuration(totalSec)}, past the ${fmtDuration(timeoutSec)} ${job.kind === 'lora' ? 'training' : 'workflow'} timeout. It still completed, but ate cluster capacity for longer than expected.`,
      })
    }
    if (waitSec != null && waitSec > cfg.maxWaitTimeSec) {
      findings.push({
        code: 'jo_slow',
        severity: 'warn',
        title: 'Long queue wait before this job started',
        body: `Sat in the queue for ${fmtDuration(waitSec)} before picking up (threshold: ${fmtDuration(cfg.maxWaitTimeSec)}).`,
      })
    }
    if (job.kind === 'wf' && job.name && totalSec != null) {
      const avgDurations = await getAvgDurations()
      const eta = avgDurations.get(job.name)
      if (eta != null && totalSec > eta) {
        findings.push({
          code: 'jo_eta',
          severity: 'info',
          title: 'Slower than the recent average',
          body: `Past runs of "${job.name}" average ${fmtDuration(eta)}. This one took ${fmtDuration(totalSec)}.`,
        })
      }
    }
    return findings
  }

  if (job.status === 'failed') {
    if (aborted) {
      findings.push({
        code: 'jo_aborted',
        severity: 'info',
        title: 'Job was aborted',
        body: `Cancelled by the user or the service. Wait: ${fmtDuration(waitSec)}. Ran for: ${fmtDuration(totalSec)}. Users often stop a job when the wait + run gets too long; that may be the case here.`,
      })
    } else {
      const code = classifyReason(reason)
      const trimmed = reason.slice(0, 240) + (reason.length > 240 ? '…' : '')
      findings.push({
        code: 'jo_failed',
        severity: 'bad',
        title: code ? `Job failed · ${code}` : 'Job failed',
        body: reason ? `Reason: ${trimmed}` : 'No failure reason was recorded.',
      })
      if (totalSec != null) {
        findings.push({
          code: 'jo_failed_time',
          severity: 'info',
          title: 'Timing context',
          body: `Waited ${fmtDuration(waitSec)} before starting, then ran for ${fmtDuration(totalSec)} before failing.`,
        })
      }
    }
    return findings
  }

  findings.push({
    code: 'jo_unfinished',
    severity: 'info',
    title: `Job is currently ${job.status}`,
    body: 'This view only covers finished jobs — try "Ask Seto" again once it lands in history.',
  })
  return findings
}

/* ─── Crowding helpers ──────────────────────────────────────────
   Compare current in-flight jobs against a service / server's soft cap
   (maxConcurrent). Surfaced as a finding so users running into queueing
   tail latency understand why — and operators see where to scale.

   Thresholds (independent from the existing maxServiceJobs/maxServerJobs
   limits, which are config-driven UX caps): when active load is at or
   above 90% of capacity it's a hard warning ("crowded"); 70-89% is a
   softer info note ("busy"). Below 70% is not noisy enough to mention.
*/
const CROWDED_RATIO = 0.9
const BUSY_RATIO = 0.7

function crowdingFinding(opts: {
  scope: 'service' | 'host'
  active: number
  cap: number | null
  label: string
}): Finding | null {
  const { scope, active, cap, label } = opts
  if (cap == null || cap <= 0) return null
  const ratio = active / cap
  if (ratio < BUSY_RATIO) return null
  const pct = Math.round(ratio * 100)
  const severity: Finding['severity'] = ratio >= CROWDED_RATIO ? 'warn' : 'info'
  const verb = ratio >= CROWDED_RATIO ? 'is crowded' : 'is busy'
  return {
    code: scope === 'service' ? 'si_crowded' : 'sv_crowded',
    severity,
    title: `${label} ${verb} (${active}/${cap} = ${pct}%)`,
    body:
      ratio >= CROWDED_RATIO
        ? `Active jobs are at or above the configured soft cap of ${cap}. Expect tail-latency on new jobs until in-flight ones drain. If this is persistent, lift maxConcurrent on the Servers page or scale the host.`
        : `Active jobs are ${pct}% of the soft cap of ${cap}. Plenty of headroom for now, but watch it climb.`,
  }
}

/* ─── Service evaluator ─────────────────────────────────────── */

async function checkService(serverId: string, cfg: Cfg): Promise<Finding[]> {
  const svc = await repo.findServer(serverId)
  if (!svc) {
    return [
      {
        code: 'unknown',
        severity: 'info',
        title: 'Service not found',
        body: 'I could not locate this service in the database.',
      },
    ]
  }

  const findings: Finding[] = []

  // Maintenance / down go first — a service that is intentionally offline
  // doesn't need to hear about its workflow count.
  if (svc.isMaintenance) {
    findings.push({
      code: 'si_maint',
      severity: 'info',
      title: 'Service is in maintenance',
      body: 'An admin put this service into maintenance mode. Ask them when it will be back online.',
    })
    return findings
  }
  const down = !svc.lastPingAt || !svc.lastPingOk
  if (down) {
    findings.push({
      code: 'si_down',
      severity: 'bad',
      title: 'Service unavailable',
      body: svc.lastPingAt
        ? 'The latest reachability probe failed to reach this service (ComfyUI / AI-Toolkit).'
        : 'No successful probe has landed yet — the service may be brand new or completely offline.',
    })
  }

  // Host ping context — a service runs on a host. Surfacing the host's ping lets
  // the user tell "the service process crashed" (host pings, service down) from
  // "the whole box is down" (host not pinging). Only shown when there's
  // something to report: the service is down, or the host itself isn't pinging.
  const svcHostname = recordHostname(svc.url)
  if (svcHostname) {
    const allServers = await repo.findAllServers()
    const host = allServers.find(
      (s) => s.id !== svc.id && !recordHasPort(s.url) && recordHostname(s.url) === svcHostname,
    )
    if (host) {
      const hostDown = !host.lastPingAt || !host.lastPingOk
      if (hostDown || down) {
        findings.push({
          code: hostDown ? 'si_host_down' : 'si_host_up',
          severity: hostDown ? 'bad' : 'info',
          title: hostDown
            ? `Host ${host.name} is not responding to ping`
            : `Host ${host.name} responds to ping`,
          body: hostDown
            ? 'The underlying host is failing its ICMP ping — this looks like a box or network problem, not just the service. Check the machine itself.'
            : 'The host is pingable, so the box is up. If the service is unreachable, the service process (ComfyUI / AI-Toolkit) is what is down — not the host.',
        })
      }
    }
  }

  // Linked workflows — workflow services only. The workflows table doesn't
  // store the comfyui_config.serverUrl mapping in a queryable form (it lives
  // in each workflow's params.json on disk), so we use a proxy that's good
  // enough for advice: distinct workflow_names that have actually run on
  // this service in the last 90 days.
  if (svc.type === 'workflow') {
    const linked = await repo.linkedWorkflowsCount(svc.id)
    if (linked > cfg.maxLinkedWf) {
      findings.push({
        code: 'si_many_wf',
        severity: 'warn',
        title: `${linked} workflows running on this service`,
        body: `Threshold is ${cfg.maxLinkedWf}. Concentrating workflows on a single service makes it a queue bottleneck — consider spreading them across more services.`,
      })
    }
  }

  // ── Current load + recent reliability (state info, always emit) ──
  // Run the two queries in parallel — they're independent.
  const [load, recent] = await Promise.all([
    repo.liveCounts(null, svc.id, null),
    repo.recentStats({ serverId: svc.id }, 24),
  ])

  findings.push({
    code: 'si_load',
    severity: 'info',
    title:
      load.serviceJobs > 0
        ? `${load.serviceJobs} job${load.serviceJobs === 1 ? '' : 's'} in flight right now`
        : 'No jobs in flight right now',
    body:
      load.serviceJobs > 0
        ? 'Active and waiting jobs on this service.'
        : 'No jobs are currently active or queued on this service.',
  })

  // Crowding — only meaningful when the service has a maxConcurrent set.
  const crowd = crowdingFinding({
    scope: 'service',
    active: load.serviceJobs,
    cap: svc.maxConcurrent ?? null,
    label: 'Service',
  })
  if (crowd) findings.push(crowd)

  if (recent.total > 0) {
    const failPct = Math.round((recent.failed / recent.total) * 100)
    const severity: Finding['severity'] = failPct >= 50 ? 'bad' : failPct >= 20 ? 'warn' : 'info'
    findings.push({
      code: 'si_recent',
      severity,
      title: `Last 24h: ${recent.total} run${recent.total === 1 ? '' : 's'} · ${failPct}% failed`,
      body:
        recent.avgDurationMs != null
          ? `${recent.completed} completed, ${recent.failed} failed. Average duration: ${fmtDuration(Math.floor(recent.avgDurationMs / 1000))}.`
          : `${recent.completed} completed, ${recent.failed} failed.`,
    })
  }

  return findings
}

/* ─── Server evaluator ──────────────────────────────────────── */

async function checkServer(serverId: string, cfg: Cfg): Promise<Finding[]> {
  const svr = await repo.findServer(serverId)
  if (!svr) {
    return [
      {
        code: 'unknown',
        severity: 'info',
        title: 'Server not found',
        body: 'I could not locate this server in the database.',
      },
    ]
  }

  const findings: Finding[] = []

  if (svr.isMaintenance) {
    findings.push({
      code: 'sv_maint',
      severity: 'info',
      title: 'Server is in maintenance',
      body: 'An admin put this server into maintenance mode. Ask them when it will be back online.',
    })
  }

  if (svr.lastPingMs != null && svr.lastPingMs > cfg.maxServerLatencyMs) {
    findings.push({
      code: 'sv_slow_net',
      severity: 'warn',
      title: `Latency is ${svr.lastPingMs} ms`,
      body: `That's above the ${cfg.maxServerLatencyMs} ms threshold. The network path to this server might be congested.`,
    })
  }

  // Services on the same hostname (port-bearing records sharing the host).
  const all = await repo.findAllServers()
  const hostname = hostnameOf(svr.url)
  let sameHostCount = 0
  if (hostname) {
    const sameHost = all.filter((s) => {
      if (s.id === svr.id) return false
      const h = hostnameOf(s.url)
      if (h !== hostname) return false
      // Only count "service" records (ones with a port).
      try {
        return !!new URL(/^https?:\/\//i.test(s.url) ? s.url : `http://${s.url}`).port
      } catch {
        return false
      }
    })
    sameHostCount = sameHost.length
    if (sameHost.length > cfg.maxServerServices) {
      findings.push({
        code: 'sv_many_services',
        severity: 'warn',
        title: `${sameHost.length} services on this server`,
        body: `Threshold is ${cfg.maxServerServices}. Running this many services on one host can lead to GPU / VRAM contention.`,
      })
    }
  }

  // ── Aggregate load + recent reliability across the host (state info) ──
  if (hostname) {
    const [load, recent] = await Promise.all([
      repo.liveCounts(null, null, hostname),
      repo.recentStats({ hostname }, 24),
    ])

    findings.push({
      code: 'sv_load',
      severity: 'info',
      title:
        load.serverJobs > 0
          ? `${load.serverJobs} job${load.serverJobs === 1 ? '' : 's'} in flight on this host`
          : 'No jobs in flight on this host',
      body:
        sameHostCount > 0
          ? `Across ${sameHostCount + 1} service${sameHostCount + 1 === 1 ? '' : 's'} sharing this hostname.`
          : 'Just this server is bound to the host.',
    })

    // Host-level crowding: sum maxConcurrent across the host's services so
    // "this host" gets a single ratio against its total capacity. A server
    // record with a port shares the host with its sibling services, so we
    // aggregate caps from all of them (including svr itself).
    const sameHostServers = all.filter((s) => hostnameOf(s.url) === hostname)
    const hostCap = sameHostServers.map((s) => s.maxConcurrent ?? 0).reduce((a, b) => a + b, 0)
    const crowd = crowdingFinding({
      scope: 'host',
      active: load.serverJobs,
      cap: hostCap > 0 ? hostCap : null,
      label: 'Host',
    })
    if (crowd) findings.push(crowd)

    if (recent.total > 0) {
      const failPct = Math.round((recent.failed / recent.total) * 100)
      const severity: Finding['severity'] = failPct >= 50 ? 'bad' : failPct >= 20 ? 'warn' : 'info'
      findings.push({
        code: 'sv_recent',
        severity,
        title: `Last 24h: ${recent.total} run${recent.total === 1 ? '' : 's'} · ${failPct}% failed`,
        body:
          recent.avgDurationMs != null
            ? `${recent.completed} completed, ${recent.failed} failed across services on this host. Average duration: ${fmtDuration(Math.floor(recent.avgDurationMs / 1000))}.`
            : `${recent.completed} completed, ${recent.failed} failed across services on this host.`,
      })
    }
  }

  return findings
}

/* ─── Error-code evaluator ──────────────────────────────────────
   `kind: 'error'` takes the classified error code (e.g. "OOM", "ECONNREFUSED")
   in `id` and reports recent activity for that code plus a short generic
   mitigation note. Opens from the Doctor → Errors tab row dot menu.

   The generic advice lives in a small static map below — same shape as the
   frontend's ERROR_CODE_LABEL, mirrored so Seto can give actionable next
   steps even when there's no recent occurrence to chew on. */

const ERROR_ADVICE: Record<string, { label: string; advice: string }> = {
  OOM: {
    label: 'GPU out of memory',
    advice:
      'The GPU ran out of VRAM. Try lowering batch size, image resolution, or step count. If multiple workflows share the GPU, run them sequentially or move heavy ones to a beefier server.',
  },
  OOM_HOST: {
    label: 'Host out of memory',
    advice:
      'The container or host process exhausted RAM. Look at running processes on the server (Doctor → Server detail), restart leaky services, or move the workload to a host with more memory.',
  },
  LOSS_NAN: {
    label: 'Training loss diverged',
    advice:
      "Training collapsed — most often a learning rate too high or a bad batch. Lower lr (try /10), check the dataset for outliers, and confirm the checkpoint isn't corrupt.",
  },
  DATA_BAD: {
    label: 'Corrupt input data',
    advice:
      "A checksum / hash check failed on inputs. Re-download or re-extract the dataset and rerun. If the source is a remote URL, verify the upstream wasn't mid-rotation when fetched.",
  },
  CKPT_IO: {
    label: 'Checkpoint I/O error',
    advice:
      "Read or write of a checkpoint failed — disk full, permissions, or a flaky network share. Check the server's disk usage and the path the workflow writes to.",
  },
  SHAPE: {
    label: 'Tensor shape mismatch',
    advice:
      "A node produced a tensor the next node didn't expect. Audit the workflow (Workflows → Audit) against the active ComfyUI server's /object_info to confirm node versions match.",
  },
  EADDRINUSE: {
    label: 'Port already in use',
    advice:
      "Another process is on the same port — usually a previous job that didn't shut down cleanly. Use Doctor → RDP In (admin) and `lsof -i :<port>` to find and kill the squatter.",
  },
  ECONNREFUSED: {
    label: 'Connection refused',
    advice:
      "The workflow couldn't reach the ComfyUI server. Check the Servers page — is the service offline or in maintenance? If it just came back, retry the job.",
  },
  ECONNRESET: {
    label: 'Connection reset',
    advice:
      "The connection dropped mid-job. Either the ComfyUI server crashed (check its logs / restart it) or there's a flaky network path. Look at server uptime and last-ping in the Servers list.",
  },
  ENETUNREACH: {
    label: 'Network unreachable',
    advice:
      "Routing or DNS issue — the runner couldn't see the server at all. Verify the server URL and the network between coffee-maker and the host.",
  },
  ETIMEDOUT: {
    label: 'Operation timed out',
    advice:
      'A network operation took longer than the timeout. Often a sign of a busy host or a slow dataset fetch. Check server load (Doctor → Server detail) and dataset source response times.',
  },
  ENOSPC: {
    label: 'No disk space',
    advice:
      'The server ran out of disk. Clear out old outputs / checkpoints / logs, then retry. Set up a recurring cleanup if this keeps happening.',
  },
  ABORTED: {
    label: 'Aborted by user',
    advice:
      "Someone (or a job-stop API call) cancelled this run. Not necessarily a problem — but if it's frequent, check whether automated retries are misfiring.",
  },
  UNKNOWN: {
    label: 'Unclassified failure',
    advice:
      "The error message doesn't match any known pattern. Open one of the recent samples below and look at the stacktrace — if it's a new failure mode worth tracking, add a classifier rule.",
  },
}

async function checkError(code: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const advice = ERROR_ADVICE[code]

  if (advice) {
    findings.push({
      code: 'err_info',
      severity: 'info',
      title: advice.label,
      body: advice.advice,
    })
  } else {
    findings.push({
      code: 'err_unknown',
      severity: 'info',
      title: `Error code: ${code}`,
      body: "No classifier entry for this code yet. Look at recent samples below to understand what's happening.",
    })
  }

  let stats
  try {
    stats = await repo.errorStats(code)
  } catch {
    return findings
  }

  // Severity for occurrence finding — more aggressive when 24h count is high.
  const occSeverity: Finding['severity'] =
    stats.total24h >= 10 ? 'bad' : stats.total24h >= 3 ? 'warn' : 'info'
  findings.push({
    code: 'err_occurrence',
    severity: occSeverity,
    title:
      stats.total24h > 0
        ? `${stats.total24h} occurrence${stats.total24h === 1 ? '' : 's'} in the last 24h`
        : stats.total7d > 0
          ? `${stats.total7d} occurrence${stats.total7d === 1 ? '' : 's'} in the last 7d`
          : 'No recent occurrences',
    body:
      stats.total90d > 0
        ? `24h: ${stats.total24h} · 7d: ${stats.total7d} · 90d: ${stats.total90d}.`
        : "This error code hasn't shown up in the last 90 days.",
  })

  if (stats.topWorkflows.length > 0) {
    findings.push({
      code: 'err_workflows',
      severity: 'info',
      title: `Top affected workflows (7d)`,
      body: stats.topWorkflows.map((w) => `• ${w.name} — ${w.count}`).join('\n'),
    })
  }

  if (stats.topServices.length > 0) {
    findings.push({
      code: 'err_services',
      severity: 'info',
      title: `Top affected services (7d)`,
      body: stats.topServices.map((s) => `• ${s.name} — ${s.count}`).join('\n'),
    })
  }

  if (stats.recentSamples.length > 0) {
    findings.push({
      code: 'err_samples',
      severity: 'info',
      title: 'Recent error messages',
      body: stats.recentSamples.map((s) => `• ${s}`).join('\n'),
    })
  }

  return findings
}

/* ─── Workflow evaluator ────────────────────────────────────────
   `kind: 'workflow'` takes the workflow slug in `id` and reports a quick
   health snapshot — recent runs, success rate, top error code, configured
   server availability. Used by the dot menu on workflow cards and from the
   workflow detail page. */
async function checkWorkflow(id: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const stats = await repo.workflowStats(id)
  if (!stats.workflow) {
    return [
      {
        code: 'unknown',
        severity: 'info',
        title: 'Workflow not found',
        body: `No workflow with id "${id}" in the database. The slug may have been renamed or the workflow deleted.`,
      },
    ]
  }
  const wf = stats.workflow

  // ── Run volume + success rate (24h + 7d) ──
  const { recent7d, recent24h } = stats
  const fail7dPct = recent7d.total > 0 ? Math.round((recent7d.failed / recent7d.total) * 100) : 0
  if (recent7d.total === 0) {
    findings.push({
      code: 'wf_quiet',
      severity: 'info',
      title: 'No runs in the last 7 days',
      body: "Workflow hasn't executed recently. Either traffic dropped, or the workflow is staged for later use.",
    })
  } else {
    const sev: Finding['severity'] = fail7dPct >= 50 ? 'bad' : fail7dPct >= 20 ? 'warn' : 'info'
    findings.push({
      code: 'wf_recent',
      severity: sev,
      title: `Last 7d: ${recent7d.total} run${recent7d.total === 1 ? '' : 's'} · ${fail7dPct}% failed`,
      body:
        recent7d.avgDurationMs != null
          ? `${recent7d.completed} completed, ${recent7d.failed} failed. Average duration (completed): ${fmtDuration(Math.floor(recent7d.avgDurationMs / 1000))}.`
          : `${recent7d.completed} completed, ${recent7d.failed} failed.`,
    })
    if (recent24h.total > 0) {
      const fail24hPct = Math.round((recent24h.failed / recent24h.total) * 100)
      findings.push({
        code: 'wf_recent_24h',
        severity: fail24hPct >= 50 ? 'bad' : fail24hPct >= 20 ? 'warn' : 'info',
        title: `Last 24h: ${recent24h.total} run${recent24h.total === 1 ? '' : 's'} · ${fail24hPct}% failed`,
        body: `${recent24h.failed} failure${recent24h.failed === 1 ? '' : 's'} in the last day — drill into the failures list if that's higher than usual.`,
      })
    }
  }

  // ── Top error code in 7d ──
  if (stats.topErrorCode && stats.topErrorCode.count > 0) {
    findings.push({
      code: 'wf_top_error',
      severity: 'warn',
      title: `Most common error: ${stats.topErrorCode.code} (×${stats.topErrorCode.count})`,
      body: `In the last 7 days, "${stats.topErrorCode.code}" was the dominant failure mode. Run validate_imagine / read_params via MCP, or open Doctor → Errors for context.`,
    })
  }

  // ── Configured servers / services health ──
  if (wf.serverIds.length === 0) {
    findings.push({
      code: 'wf_no_servers',
      severity: 'warn',
      title: 'No servers configured',
      body: 'This workflow has no servers assigned — runs will fall back to whatever the launcher picks. Set explicit servers via the workflow card or set_workflow_servers (MCP).',
    })
  } else {
    const allServers = await repo.findAllServers()
    const byId = new Map(allServers.map((s) => [s.id, s]))
    const missing: string[] = []
    const offline: string[] = []
    const maintenance: string[] = []
    for (const sid of wf.serverIds) {
      const s = byId.get(sid)
      if (!s) {
        missing.push(sid)
        continue
      }
      if (s.isMaintenance) maintenance.push(s.name)
      else if (!s.lastPingOk) {
        offline.push(s.name)
      }
    }
    if (missing.length > 0) {
      findings.push({
        code: 'wf_unknown_server',
        severity: 'warn',
        title: `${missing.length} configured server${missing.length === 1 ? '' : 's'} no longer exist`,
        body: `These ids aren't in the Servers table: ${missing.join(', ')}. They may have been deleted — update the workflow's servers list.`,
      })
    }
    if (offline.length > 0) {
      findings.push({
        code: 'wf_server_down',
        severity: 'bad',
        title: `${offline.length} configured server${offline.length === 1 ? '' : 's'} unreachable`,
        body: `Down right now: ${offline.join(', ')}. New runs will queue / fail until they recover.`,
      })
    }
    if (maintenance.length > 0) {
      findings.push({
        code: 'wf_server_maint',
        severity: 'warn',
        title: `${maintenance.length} configured server${maintenance.length === 1 ? '' : 's'} in maintenance`,
        body: `In maintenance: ${maintenance.join(', ')}. Coordinate with the admin who set them.`,
      })
    }
  }

  // ── Duration drift (7d vs 90d) ──
  if (recent7d.avgDurationMs != null && stats.avgDuration90dMs != null) {
    const drift = recent7d.avgDurationMs / stats.avgDuration90dMs
    if (drift >= 1.5) {
      findings.push({
        code: 'wf_slower',
        severity: 'warn',
        title: `Recent runs ${Math.round((drift - 1) * 100)}% slower than 90d avg`,
        body: `7d avg ${fmtDuration(Math.floor(recent7d.avgDurationMs / 1000))} vs 90d avg ${fmtDuration(Math.floor(stats.avgDuration90dMs / 1000))}. Something changed — heavier inputs, server contention, or a regression in node config.`,
      })
    }
  }

  return findings
}

/* ─── Dispatch ──────────────────────────────────────────────── */

/** Run the rule set for a given entity and return the wire response (greeting
 *  + findings). Catches per-check exceptions and turns them into a generic
 *  "Check failed" 500 the route surfaces. */
export async function runCheck(
  kind: CheckKind,
  id: string,
  username: string | undefined,
): Promise<CheckResponse> {
  const cfg = await getConfig()
  let findings: Finding[]
  switch (kind) {
    case 'live-job':
      findings = await checkLiveJob(id, cfg)
      break
    case 'history-job':
      findings = await checkHistoryJob(id, cfg)
      break
    case 'service':
      findings = await checkService(id, cfg)
      break
    case 'server':
      findings = await checkServer(id, cfg)
      break
    case 'error':
      findings = await checkError(id)
      break
    case 'workflow':
      findings = await checkWorkflow(id)
      break
  }
  const who = username ? username.charAt(0).toUpperCase() + username.slice(1) : 'there'
  return {
    greeting: `Hi ${who}! I'm Seto, the in-app doc. Let me take a look…`,
    findings,
  }
}
