/**
 * WorkflowPerformancePanel — shows avg/p95/max duration and failure rate by workflow.
 * Helps identify which workflows are consistently slow or unreliable.
 */
import { useState, useEffect, useRef } from 'react'
import { BarChart2, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'
import { getWorkflowPerformance } from '@/services/api/stats'
import type { WorkflowPerfEntry } from '@/services/api/stats'
import type { ActivityStatsPeriod } from './useActivityStats'
import { durationColorClass, formatDurationMs } from '@/utils/failureClassifier'

// ── types ────────────────────────────────────────────────────────────────────

type SortKey = 'avgMs' | 'p95Ms' | 'maxMs' | 'totalCount' | 'failRate'
type SortDir = 'asc' | 'desc'

// ── helpers ──────────────────────────────────────────────────────────────────

function failRateColor(rate: number): string {
  if (rate === 0) return 'text-emerald-400'
  if (rate < 10) return 'text-primary'
  if (rate < 30) return 'text-amber-400'
  return 'text-red-400'
}

// ── main component ───────────────────────────────────────────────────────────

export default function WorkflowPerformancePanel({ period }: { period: ActivityStatsPeriod }) {
  const [workflows, setWorkflows] = useState<WorkflowPerfEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('avgMs')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    getWorkflowPerformance(period, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setConfigured(res.configured)
        setWorkflows(res.workflows)
        setError(res.error ?? null)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [period])

  if (configured === false) return null

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...workflows].sort((a, b) => {
    const av = a[sortKey] ?? -1
    const bv = b[sortKey] ?? -1
    return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
  })

  const SortBtn = ({ col, label, title }: { col: SortKey; label: string; title?: string }) => {
    const active = sortKey === col
    return (
      <th
        className={`px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] whitespace-nowrap cursor-pointer select-none transition-colors ${active ? 'text-accent-light' : 'text-muted hover:text-secondary'}`}
        onClick={() => toggleSort(col)}
        title={title}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
        </span>
      </th>
    )
  }

  return (
    <div className="bg-secondary border border-default rounded-[10px] overflow-hidden flex flex-col">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-[0.6rem] border-b border-default shrink-0">
        <BarChart2 size={14} className="text-muted shrink-0" />
        <span className="flex-1 text-sm font-semibold uppercase tracking-[0.06em] text-muted">Workflow Performance</span>
        {loading && <span className="w-3 h-3 border-2 border-default border-t-accent rounded-full animate-spin shrink-0" />}
        {!loading && workflows.length > 0 && (
          <span className="text-[10px] text-muted/60 tabular-nums">{workflows.length} workflows</span>
        )}
      </div>

      {/* Body */}
      {loading && workflows.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted">Loading…</div>
      ) : error ? (
        <div className="py-6 text-center text-sm text-semantic-error">{error}</div>
      ) : workflows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">No workflow data in this period.</div>
      ) : (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-secondary z-10">
              <tr className="border-b border-default">
                <th className="px-4 py-[0.4rem] text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted whitespace-nowrap">Workflow</th>
                <SortBtn col="avgMs" label="Avg Time" title="Average generation time" />
                <SortBtn col="p95Ms" label="P95" title="95th percentile generation time — 95% of jobs finish within this" />
                <SortBtn col="maxMs" label="Max" title="Longest recorded generation time" />
                <SortBtn col="totalCount" label="Runs" title="Total job count in this period" />
                <SortBtn col="failRate" label="Fail %" title="Percentage of jobs that failed" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((wf) => (
                <tr key={wf.name} className="border-b border-default/40 last:border-b-0 hover:bg-tertiary/30 transition-colors">
                  <td className="px-4 py-[0.5rem] max-w-[220px]">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap block font-medium text-primary" title={wf.name}>
                      {wf.name}
                    </span>
                  </td>
                  <td className={`px-4 py-[0.5rem] tabular-nums font-medium whitespace-nowrap ${durationColorClass(wf.avgMs)}`}>
                    {wf.avgMs != null ? formatDurationMs(wf.avgMs) : '—'}
                    {wf.avgMs != null && wf.avgMs >= 600_000 && (
                      <span className="ml-1 text-[9px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1 py-px align-middle">SLOW</span>
                    )}
                  </td>
                  <td className={`px-4 py-[0.5rem] tabular-nums whitespace-nowrap ${durationColorClass(wf.p95Ms)}`}>
                    {wf.p95Ms != null ? formatDurationMs(wf.p95Ms) : '—'}
                  </td>
                  <td className={`px-4 py-[0.5rem] tabular-nums whitespace-nowrap ${durationColorClass(wf.maxMs)}`}>
                    {wf.maxMs != null ? formatDurationMs(wf.maxMs) : '—'}
                  </td>
                  <td className="px-4 py-[0.5rem] tabular-nums text-muted whitespace-nowrap">
                    {wf.totalCount.toLocaleString()}
                    {wf.failCount > 0 && (
                      <span className="ml-1 text-[10px] text-red-400">({wf.failCount} failed)</span>
                    )}
                  </td>
                  <td className={`px-4 py-[0.5rem] tabular-nums font-medium whitespace-nowrap ${failRateColor(wf.failRate)}`}>
                    {wf.failRate === 0 ? '0%' : `${wf.failRate.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
