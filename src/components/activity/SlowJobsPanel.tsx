/**
 * SlowJobsPanel — shows jobs that exceeded a configurable duration threshold.
 * Helps diagnose performance issues: long queues, OOM crashes, server errors.
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, ChevronDown, Loader2, Stethoscope } from 'lucide-react'
import { getSlowJobs } from '@/services/api/stats'
import type { SlowJob } from '@/services/api/stats'
import type { ActivityStatsPeriod } from './useActivityStats'
import UnifiedJobModal from '@/components/modals/UnifiedJobModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import { classifyFailure, formatDurationMs, durationColorClass } from '@/utils/failureClassifier'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'

// ── threshold presets ────────────────────────────────────────────────────────

const THRESHOLDS: { label: string; value: number }[] = [
  { label: '> 5 min', value: 300 },
  { label: '> 10 min', value: 600 },
  { label: '> 30 min', value: 1800 },
  { label: '> 1 hour', value: 3600 },
]

// ── helpers ──────────────────────────────────────────────────────────────────

function formatRelative(ts: number | null): { text: string; title: string } {
  if (ts == null) return { text: '—', title: '' }
  const elapsed = Date.now() - ts
  const title = new Date(ts).toLocaleString()
  if (elapsed < 60_000) return { text: 'just now', title }
  if (elapsed < 3_600_000) return { text: `${Math.floor(elapsed / 60_000)}m ago`, title }
  if (elapsed < 86_400_000) return { text: `${Math.floor(elapsed / 3_600_000)}h ago`, title }
  return { text: `${Math.floor(elapsed / 86_400_000)}d ago`, title }
}

// ── sub-components ───────────────────────────────────────────────────────────

function FailureBadge({ job }: { job: SlowJob }) {
  if (job.status !== 'failed') return null
  const cls = classifyFailure(job.failedReason, job.duration, job.timeoutMs)
  return (
    <span
      className={`inline-flex items-center gap-[3px] px-[6px] py-[2px] rounded border text-[11px] font-semibold ${cls.colorClass}`}
      title={job.failedReason ?? undefined}
    >
      <span>{cls.icon}</span>
      <span>{cls.label}</span>
    </span>
  )
}

function QueueWaitBadge({ ms }: { ms: number | null }) {
  if (ms == null || ms < 5_000) return null
  const color = ms > 300_000 ? 'text-red-400' : ms > 60_000 ? 'text-amber-400' : 'text-muted'
  return (
    <span className={`text-[11px] tabular-nums ${color}`} title="Time waiting in Bull queue before processing started">
      +{formatDurationMs(ms)} queue
    </span>
  )
}

// ── main component ───────────────────────────────────────────────────────────

interface Props {
  period: ActivityStatsPeriod
}

export default function SlowJobsPanel({ period }: Props) {
  const navigate = useNavigate()
  const aliases = useServerAliases()
  const [thresholdSec, setThresholdSec] = useState(600)
  const [jobs, setJobs] = useState<SlowJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)

  const [logsJobId, setLogsJobId] = useState<string | null>(null)
  const [logsJob, setLogsJob] = useState<SlowJob | null>(null)
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)

  const [thresholdOpen, setThresholdOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // close dropdown on outside click
  useEffect(() => {
    if (!thresholdOpen) return
    function onDown(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setThresholdOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [thresholdOpen])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const ctrl = new AbortController()
    getSlowJobs(thresholdSec, 200, period)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setConfigured(res.configured)
        setJobs(res.jobs)
        setError(res.error ?? null)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [thresholdSec, period])

  if (configured === false) return null

  const currentLabel = THRESHOLDS.find((t) => t.value === thresholdSec)?.label ?? `> ${thresholdSec}s`

  return (
    <div className="bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[0.6rem] border-b border-default text-sm font-semibold uppercase tracking-[0.06em] text-muted shrink-0">
        <Clock size={14} className="shrink-0" />
        <span className="flex-1">Slow Jobs</span>

        {/* Threshold selector */}
        <div ref={dropRef} className="relative">
          <button
            type="button"
            className="inline-flex items-center gap-1 px-[0.6rem] py-[0.25rem] text-[11px] font-semibold normal-case tracking-normal border border-default rounded-md bg-transparent text-muted hover:text-primary hover:border-[#4a5d73] transition-colors"
            onClick={() => setThresholdOpen((o) => !o)}
          >
            {currentLabel}
            <ChevronDown size={11} className={`transition-transform ${thresholdOpen ? 'rotate-180' : ''}`} />
          </button>
          {thresholdOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-secondary border border-default rounded-lg shadow-lg py-1 min-w-[120px]">
              {THRESHOLDS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`w-full text-left px-3 py-[0.3rem] text-sm transition-colors ${thresholdSec === t.value ? 'text-accent-light bg-accent/[0.08] font-semibold' : 'text-secondary hover:bg-tertiary'}`}
                  onClick={() => { setThresholdSec(t.value); setThresholdOpen(false) }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && <span className="w-3 h-3 border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />}
        {!loading && <span className="text-[10px] font-normal normal-case tracking-normal text-muted/60 tabular-nums">{jobs.length} jobs</span>}
      </div>

      {/* Body */}
      {loading && jobs.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-semantic-error">{error}</div>
      ) : jobs.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">
          No jobs exceeded {currentLabel.replace('> ', '')} in the last scan.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-default">
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">Workflow</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">Duration</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">Server</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">User</th>
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">Reason</th>
                <th className="px-4 py-[0.4rem] text-right text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">When</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const rel = formatRelative(job.finishedOn ?? job.processedOn)
                return (
                  <tr
                    key={job.id}
                    className="border-b border-default/40 last:border-b-0 hover:bg-tertiary/40 cursor-pointer transition-colors group"
                    onClick={() => { setLogsJob(job); setLogsJobId(job.id) }}
                    title={`Job ${job.id.slice(0, 8)}… — click to view logs`}
                  >
                    {/* Workflow */}
                    <td className="px-4 py-[0.55rem] max-w-[200px]">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-primary">{job.name || '—'}</div>
                      <div className="font-mono text-[10px] text-muted/60 mt-[1px]">{job.id.slice(0, 8)}…</div>
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-[0.55rem] tabular-nums whitespace-nowrap">
                      <div className={`font-semibold ${durationColorClass(job.duration)}`}>
                        {formatDurationMs(job.duration)}
                        {job.duration != null && job.duration >= 600_000 && (
                          <span className="ml-1 text-[10px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1 py-px align-middle">SLOW</span>
                        )}
                      </div>
                      <QueueWaitBadge ms={job.queueWait} />
                    </td>

                    {/* Server */}
                    <td className="px-4 py-[0.55rem] max-w-[180px]">
                      <button
                        type="button"
                        className="font-mono text-xs text-primary bg-transparent border-none p-0 cursor-pointer hover:text-accent-light transition-colors overflow-hidden text-ellipsis whitespace-nowrap block max-w-full text-left"
                        title={`View logs for ${job.server}`}
                        onClick={(e) => { e.stopPropagation(); setLogsServerUrl(job.server) }}
                      >
                        {displayServerName(job.server, aliases)}
                      </button>
                    </td>

                    {/* User */}
                    <td className="px-4 py-[0.55rem] text-sm text-muted whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                      <span className="inline-flex items-center gap-1">
                        <span>{job.user || '—'}</span>
                        {job.user && (
                          <button
                            type="button"
                            title="View in Doctor"
                            onClick={(e) => { e.stopPropagation(); navigate('/doctor', { state: { filterUser: job.user } }) }}
                            className="opacity-50 hover:opacity-100 transition-opacity px-1 py-px rounded text-xs text-muted hover:text-accent-light bg-transparent border-none cursor-pointer"
                          >
                            <Stethoscope size={10} />
                          </button>
                        )}
                      </span>
                    </td>

                    {/* Failure reason */}
                    <td className="px-4 py-[0.55rem]">
                      {job.status === 'failed' ? (
                        <FailureBadge job={job} />
                      ) : (
                        <span className="text-xs text-muted/60">completed</span>
                      )}
                    </td>

                    {/* When */}
                    <td className="px-4 py-[0.55rem] text-right text-xs text-muted whitespace-nowrap" title={rel.title}>
                      {rel.text}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {logsJobId && (
        <UnifiedJobModal
          jobId={logsJobId}
          jobSummary={logsJob ?? undefined}
          onClose={() => { setLogsJobId(null); setLogsJob(null) }}
        />
      )}
      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}
    </div>
  )
}
