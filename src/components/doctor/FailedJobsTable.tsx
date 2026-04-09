import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search, Loader2, Filter, X, GripHorizontal } from 'lucide-react'
import type { DoctorState } from './useDoctor'
import { FAILED_JOBS_PAGE_SIZE } from './useDoctor'
import type { ColumnKey } from './useColumnManager'
import { COLUMN_LABELS, DEFAULT_TABLE_HEIGHT, saveTableHeight } from './useColumnManager'
import type { FailedJobSummary } from '@/services/api/stats'
import { classifyFailure, durationColorClass } from '@/utils/failureClassifier'
import { displayServerName } from '@/utils/serverDisplay'
import { useServerAliases } from '@/hooks/useServerAliases'

// ── Shared style constants ────────────────────────────────────────────────────

const TD = 'py-2 px-4 border-b border-default/35 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-secondary group-hover:text-primary'
const TD_MUTED = 'py-2 px-4 border-b border-default/35 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-muted group-hover:text-primary'
const CELL_LINK = 'bg-transparent border-none text-[#c9a6f0] text-[inherit] font-[inherit] cursor-pointer p-0 text-left overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px] transition-colors duration-[120ms] hover:text-primary hover:underline hover:decoration-[#c9a6f0]/40'
const FILTER_BTN = 'inline-flex items-center justify-center w-[18px] h-[18px] bg-transparent border-none text-[#354556] cursor-pointer rounded-[3px] p-0 shrink-0 opacity-40 group-hover:opacity-100 transition-[opacity,color,background] duration-[120ms] hover:text-[#c9a6f0] hover:bg-accent/15'
const CHIP = 'inline-flex items-center gap-[0.3rem] py-[0.15rem] pr-[0.35rem] pl-2 bg-accent/[0.12] border border-accent/30 rounded-[5px] text-sm text-[#c9a6f0]'
const CHIP_REMOVE = 'inline-flex items-center justify-center bg-transparent border-none text-muted cursor-pointer p-[1px] rounded-[3px] transition-colors hover:text-primary'

// ── Cell formatters ───────────────────────────────────────────────────────────

function formatShortTs(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatRunDuration(processedOn: number | null, finishedOn: number | null): string {
  if (processedOn == null || finishedOn == null) return '—'
  const ms = finishedOn - processedOn
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function getShortError(reason: string | null): string {
  if (!reason) return ''
  const first = reason.split('\n')[0].trim()
  return first.length > 80 ? first.slice(0, 77) + '…' : first
}

function getErrorFirstLine(reason: string | null): string {
  if (!reason) return ''
  return reason.split('\n')[0].trim().slice(0, 120)
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface FailedJobsTableProps {
  d: DoctorState
  colOrder: ColumnKey[]
  colWidths: Partial<Record<ColumnKey, number>>
  tableHeight: number
  setTableHeight: (h: number) => void
  handleTableResizeStart: (e: React.MouseEvent) => void
  handleColResizeStart: (e: React.MouseEvent, col: ColumnKey) => void
  handleDragStart: (col: ColumnKey) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDrop: (col: ColumnKey) => void
  onViewLogs: (job: FailedJobSummary) => void
  onViewServerLogs: (serverUrl: string) => void
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function FailedJobsTable({
  d,
  colOrder,
  colWidths,
  tableHeight,
  setTableHeight,
  handleTableResizeStart,
  handleColResizeStart,
  handleDragStart,
  handleDragOver,
  handleDrop,
  onViewLogs,
  onViewServerLogs,
}: FailedJobsTableProps): React.ReactElement {
  const navigate = useNavigate()
  const aliases = useServerAliases()

  const totalPages = Math.max(1, Math.ceil(d.failedJobsTotal / FAILED_JOBS_PAGE_SIZE))
  const pageStart = d.failedJobsTotal === 0 ? 0 : (d.failedJobsPage - 1) * FAILED_JOBS_PAGE_SIZE + 1
  const pageEnd = Math.min(d.failedJobsPage * FAILED_JOBS_PAGE_SIZE, d.failedJobsTotal)
  const isSearching = d.searchPending || d.failedJobsLoading

  const hasFilters = Object.values(d.failedJobsFilters).some(Boolean)
  const activeFilterCount = Object.values(d.failedJobsFilters).filter(Boolean).length

  const handleWorkflowClick = useCallback((name: string) => {
    if (name && name !== '—') navigate(`/workflows/workflow/${encodeURIComponent(name)}`)
  }, [navigate])

  const renderCell = useCallback((col: ColumnKey, job: FailedJobSummary) => {
    switch (col) {
      case 'id':
        return <td key={col} className={`${TD_MUTED} font-mono text-sm max-w-[80px]`}>{job.id}</td>
      case 'workflow':
        return (
          <td key={col} className={TD}>
            <span className="inline-flex items-center gap-1">
              {job.name && job.name !== '—' ? (
                <button type="button" className={CELL_LINK} title={`Open ${job.name}`} onClick={(e) => { e.stopPropagation(); handleWorkflowClick(job.name) }}>
                  {job.name}
                </button>
              ) : <span className="text-muted">—</span>}
              {job.name && job.name !== '—' && (
                <button type="button" className={FILTER_BTN} title="Filter by workflow" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('workflow', job.name) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      case 'server': {
        const shortSrv = job.server && job.server !== '—' ? displayServerName(job.server, aliases) : null
        return (
          <td key={col} className={TD}>
            <span className="inline-flex items-center gap-1">
              {shortSrv ? (
                <button type="button" className={CELL_LINK} title={`View logs for ${job.server}`} onClick={(e) => { e.stopPropagation(); onViewServerLogs(job.server) }}>
                  {shortSrv}
                </button>
              ) : <span className="text-muted">—</span>}
              {shortSrv && (
                <button type="button" className={FILTER_BTN} title="Filter by server" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('server', job.server) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      }
      case 'error': {
        const firstLine = getErrorFirstLine(job.failedReason)
        const shortErr = getShortError(job.failedReason)
        const cls = classifyFailure(job.failedReason)
        return (
          <td key={col} className="py-2 px-4 border-b border-default/35 max-w-[300px] text-sm group-hover:text-semantic-error" title={job.failedReason ?? undefined}>
            <span className="flex flex-col gap-[2px] w-full overflow-hidden">
              <span className="flex w-full overflow-hidden gap-1 items-center">
                <span className={`inline-flex items-center gap-1 shrink-0 text-[10px] font-semibold px-[0.4em] py-[0.1em] rounded border ${cls.colorClass}`}>
                  {cls.icon} {cls.label}
                </span>
                {firstLine && (
                  <button type="button" className={FILTER_BTN} title="Filter by error" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('error', firstLine) }}>
                    <Filter size={10} />
                  </button>
                )}
              </span>
              <span className="text-semantic-error overflow-hidden whitespace-nowrap text-ellipsis">{shortErr}</span>
            </span>
          </td>
        )
      }
      case 'user':
        return (
          <td key={col} className={TD}>
            <span className="inline-flex items-center gap-1">
              <span>{job.user}</span>
              {job.user && job.user !== '—' && (
                <button type="button" className={FILTER_BTN} title="Filter by user" onClick={(e) => { e.stopPropagation(); d.setFailedJobsFilter('user', job.user) }}>
                  <Filter size={10} />
                </button>
              )}
            </span>
          </td>
        )
      case 'duration': {
        const durMs = (job.processedOn != null && job.finishedOn != null) ? job.finishedOn - job.processedOn : null
        const dur = formatRunDuration(job.processedOn, job.finishedOn)
        const queueWait = (job.timestamp != null && job.processedOn != null) ? job.processedOn - job.timestamp : null
        return (
          <td key={col} className={`${TD_MUTED} whitespace-nowrap text-sm`}>
            <span className="inline-flex flex-col gap-[2px]">
              <span className={`tabular-nums font-medium ${durationColorClass(durMs)}`}>
                {dur}
                {durMs != null && durMs >= 600_000 && (
                  <span className="ml-1 text-[10px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1 py-px">SLOW</span>
                )}
              </span>
              {queueWait != null && queueWait > 5000 && (
                <span className="text-[10px] text-muted tabular-nums">+{formatRunDuration(job.timestamp, job.processedOn)} in queue</span>
              )}
            </span>
          </td>
        )
      }
      case 'time':
        return <td key={col} className={`${TD_MUTED} whitespace-nowrap text-sm`}>{formatShortTs(job.finishedOn)}</td>
    }
  }, [handleWorkflowClick, d.setFailedJobsFilter, onViewServerLogs])

  return (
    <div className="bg-secondary border border-default/70 rounded-[10px] overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 py-3 px-[1.1rem] border-b border-default/60 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[0.9rem] font-semibold m-0 text-primary">Failure Log</h2>
          {d.failedJobsTotal > 0 && (
            <span className="text-sm text-muted">{d.failedJobsTotal.toLocaleString()} entries</span>
          )}
        </div>
        <div className="relative flex items-center">
          {isSearching
            ? <Loader2 size={14} className="absolute left-[0.6rem] text-muted pointer-events-none spin" />
            : <Search size={14} className="absolute left-[0.6rem] text-muted pointer-events-none" />
          }
          <input
            type="text"
            className={`h-[30px] px-3 pl-8 text-sm border border-default rounded-md bg-primary text-primary w-[280px] max-w-full transition-[border-color] duration-150 placeholder:text-muted focus:outline-none focus:border-accent${isSearching ? ' opacity-60' : ''}`}
            placeholder="Search by ID, workflow, server, user or message…"
            value={d.failedJobsSearch}
            onChange={(e) => d.setFailedJobsSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="flex items-center gap-[0.4rem] py-[0.4rem] px-[1.1rem] border-b border-default/40 flex-wrap">
          <Filter size={12} className="text-muted shrink-0" />
          {d.failedJobsFilters.workflow && (
            <span className={CHIP}>
              <span className="text-muted text-sm">workflow:</span>
              {d.failedJobsFilters.workflow}
              <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('workflow', '')} title="Remove filter"><X size={11} /></button>
            </span>
          )}
          {d.failedJobsFilters.server && (
            <span className={CHIP}>
              <span className="text-muted text-sm">server:</span>
              {d.failedJobsFilters.server}
              <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('server', '')} title="Remove filter"><X size={11} /></button>
            </span>
          )}
          {d.failedJobsFilters.user && (
            <span className={CHIP}>
              <span className="text-muted text-sm">user:</span>
              {d.failedJobsFilters.user}
              <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('user', '')} title="Remove filter"><X size={11} /></button>
            </span>
          )}
          {d.failedJobsFilters.error && (
            <span className={CHIP}>
              <span className="text-muted text-sm">error:</span>
              {d.failedJobsFilters.error.length > 40 ? d.failedJobsFilters.error.slice(0, 37) + '…' : d.failedJobsFilters.error}
              <button type="button" className={CHIP_REMOVE} onClick={() => d.setFailedJobsFilter('error', '')} title="Remove filter"><X size={11} /></button>
            </span>
          )}
          {activeFilterCount > 1 && (
            <button
              type="button"
              className="bg-transparent border-none text-muted text-sm cursor-pointer py-[0.15rem] px-[0.35rem] rounded transition-[color,background] duration-[120ms] ml-[0.1rem] hover:text-primary hover:bg-tertiary"
              onClick={d.clearFailedJobsFilters}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {d.failedJobsLoading && d.failedJobs.length === 0 ? (
        <div className="py-10 px-4 text-center text-muted text-sm">Loading…</div>
      ) : d.failedJobs.length === 0 ? (
        <div className="py-10 px-4 text-center text-muted text-sm">
          {d.failedJobsSearch
            ? `No results for "${d.failedJobsSearch}"${d.hideAborted ? ' (excl. aborted)' : ''}.`
            : d.hideAborted
              ? 'No failures found (excluding aborted).'
              : 'No failures in the queue.'
          }
        </div>
      ) : (
        <>
          <div className="overflow-x-auto doctor-table-scroll" style={{ maxHeight: `${tableHeight}px` }}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {colOrder.map((col) => (
                    <th
                      key={col}
                      draggable
                      onDragStart={() => handleDragStart(col)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(col)}
                      style={colWidths[col] ? { width: `${colWidths[col]}px` } : undefined}
                      className="relative text-left py-[0.4rem] px-4 text-sm font-semibold uppercase tracking-[0.05em] text-muted border-b border-default/70 whitespace-nowrap cursor-grab select-none active:cursor-grabbing"
                    >
                      <span className="flex items-center gap-[0.3rem] pr-2">
                        {COLUMN_LABELS[col]}
                      </span>
                      <span
                        className="doctor-col-resize absolute right-0 top-0 bottom-0 w-[14px] flex items-center justify-center cursor-col-resize z-[2] bg-transparent hover:bg-accent-light/35 active:bg-accent-light/35"
                        onMouseDown={(e) => handleColResizeStart(e, col)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.failedJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="group cursor-pointer transition-[background] duration-[120ms] hover:bg-accent/5 doctor-failed-row"
                    onClick={() => onViewLogs(job)}
                  >
                    {colOrder.map((col) => renderCell(col, job))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 py-2 px-4 border-t border-default/50">
            <div className="flex items-center gap-2 flex-1 justify-center">
              <button
                type="button"
                className="btn btn-toolbar btn-sm"
                disabled={d.failedJobsPage <= 1 || d.failedJobsLoading}
                onClick={() => d.setFailedJobsPage(d.failedJobsPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-muted tabular-nums">
                {pageStart}–{pageEnd} of {d.failedJobsTotal.toLocaleString()}
              </span>
              <button
                type="button"
                className="btn btn-toolbar btn-sm"
                disabled={d.failedJobsPage >= totalPages || d.failedJobsLoading}
                onClick={() => d.setFailedJobsPage(d.failedJobsPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div
              className="flex items-center justify-center w-8 h-6 text-[#354556] cursor-row-resize rounded shrink-0 transition-[color,background] duration-[120ms] hover:text-muted hover:bg-tertiary"
              onMouseDown={handleTableResizeStart}
              onDoubleClick={() => { setTableHeight(DEFAULT_TABLE_HEIGHT); saveTableHeight(DEFAULT_TABLE_HEIGHT) }}
              title="Drag to resize table · Double-click to reset"
            >
              <GripHorizontal size={14} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
