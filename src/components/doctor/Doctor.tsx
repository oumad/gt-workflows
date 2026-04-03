import React, { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Stethoscope, RefreshCw, AlertCircle, Timer, TimerOff, Activity as ActivityIcon } from 'lucide-react'
import { useDoctor, DOCTOR_PERIODS } from './useDoctor'
import DoctorSummaryCards from './DoctorSummaryCards'
import FailedJobsTable from './FailedJobsTable'
import { useColumnManager } from './useColumnManager'
import FailedJobModal from './FailedJobModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import type { FailedJobSummary, DoctorPeriod } from '@/services/api/stats'
import { usePeriod } from '@/contexts/PeriodContext'
import './Doctor.css'
import './FailedJobModal.css'

function formatRefreshedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function Doctor(): React.ReactElement {
  const d = useDoctor()
  const location = useLocation()
  const navigate = useNavigate()
  const appliedLocationStateRef = useRef(false)
  const { period: globalPeriod, setPeriod: setGlobalPeriod } = usePeriod()
  const [selectedJob, setSelectedJob] = useState<FailedJobSummary | null>(null)
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)

  const {
    colOrder, colWidths, tableHeight, setTableHeight,
    handleTableResizeStart, handleColResizeStart,
    handleDragStart, handleDragOver, handleDrop,
  } = useColumnManager()

  // Sync global period into doctor on mount and whenever global period changes
  useEffect(() => {
    if (globalPeriod !== d.period) {
      d.setPeriod(globalPeriod as DoctorPeriod)
    }
  }, [globalPeriod]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply location state filter once on mount (e.g. navigated from SlowJobsPanel)
  useEffect(() => {
    if (appliedLocationStateRef.current) return
    appliedLocationStateRef.current = true
    const state = location.state as { filterUser?: string } | null
    if (state?.filterUser) {
      d.setFailedJobsFilter('user', state.filterUser)
    }
  }, []) // empty deps — run once

  const periodLabel = DOCTOR_PERIODS.find((p) => p.id === d.period)?.label ?? 'All time'
  const autoLabel = d.autoInterval
    ? d.autoInterval < 60 ? `${d.autoInterval}s` : `${d.autoInterval / 60}m`
    : null

  return (
    <div className="flex flex-col h-full text-[15px]">
      {/* Sticky header — top-14 = 3.5rem, sits below the h-14 app nav bar */}
      <div className="sticky top-14 z-20 bg-primary">
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <Stethoscope size={22} className="text-accent/70" />
            <h1 className="text-xl font-semibold text-primary m-0">Doctor</h1>
            <div className="flex-1 h-px bg-default/50 ml-2" />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors duration-150 shrink-0"
              onClick={() => navigate('/activity')}
              title="Go to Activity monitor"
            >
              <ActivityIcon size={14} />
              Activity
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-6 py-[0.4rem] border-b border-default/40 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Period select */}
            <select
              className="h-8 px-[0.6rem] rounded-md border border-default bg-secondary text-primary text-sm cursor-pointer focus:outline-none focus:border-accent transition-[border-color] duration-150"
              value={d.period}
              onChange={(e) => {
                const p = e.target.value as DoctorPeriod
                d.setPeriod(p)
                setGlobalPeriod(p)
              }}
              disabled={d.loading}
            >
              {DOCTOR_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>

            {/* Excl. aborted toggle */}
            <button
              type="button"
              className={`inline-flex items-center h-8 px-3 border rounded-md text-sm cursor-pointer transition-[background,border-color,color] duration-150 whitespace-nowrap ${d.hideAborted ? 'bg-accent/15 border-accent/40 text-[#c9a6f0] hover:bg-accent/22 hover:border-accent/55' : 'bg-secondary border-default text-muted hover:border-light hover:text-secondary'}`}
              onClick={() => d.setHideAborted(!d.hideAborted)}
              title="Exclude jobs aborted by the user from all panels"
            >
              Excl. aborted
            </button>

            {/* Refresh + auto-refresh grouped */}
            <div className="inline-flex items-stretch h-8 rounded-md border border-default overflow-hidden bg-secondary">
              <button
                type="button"
                className="inline-flex items-center justify-center px-[0.6rem] h-full border-r border-default text-sm text-primary hover:bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={d.refresh}
                disabled={d.loading}
                title={d.lastRefreshed ? `Refresh · last updated ${formatRefreshedTime(d.lastRefreshed)}` : 'Refresh data'}
              >
                <RefreshCw size={15} className={d.loading ? 'spin' : ''} />
              </button>
              <button
                type="button"
                className={`inline-flex items-center justify-center gap-[0.3rem] px-[0.6rem] h-full min-w-9 text-sm transition-colors ${d.autoInterval ? 'bg-accent/[0.18] text-[#c9a6f0]' : 'text-primary hover:bg-tertiary'}`}
                onClick={d.cycleAutoInterval}
                title={d.autoInterval
                  ? `Auto-refreshing every ${d.autoInterval < 60 ? `${d.autoInterval}s` : `${d.autoInterval / 60}m`} — click to cycle`
                  : 'Enable auto-refresh (5s → 30s → 1m → 5m)'}
              >
                {d.autoInterval ? <Timer size={15} /> : <TimerOff size={15} />}
                {autoLabel && <span>{autoLabel}</span>}
              </button>
            </div>
          </div>

          {d.lastRefreshed && (
            <span className="text-[0.8rem] text-muted whitespace-nowrap shrink-0">
              Updated {formatRefreshedTime(d.lastRefreshed)}
            </span>
          )}
        </div>
      </div>

      <div className="px-6 py-5">
        {d.loading && d.configured === null ? (
          <div className="text-center py-16 px-4 text-muted text-sm">Running diagnostics…</div>
        ) : d.error ? (
          <div className="flex items-center gap-2 p-4 px-5 text-semantic-error bg-semantic-error/[0.08] border border-semantic-error/20 rounded-lg text-sm">
            <AlertCircle size={18} />{d.error}
          </div>
        ) : d.configured === false ? (
          <div className="text-center py-16 px-4 text-muted text-sm">
            <p>Queue is not configured.</p>
            <p className="text-sm mt-2 text-[#697784]">
              Set <code>REDIS_URL</code> in the server environment to enable diagnostics.
            </p>
          </div>
        ) : (
          <>
            <DoctorSummaryCards
              d={d}
              periodLabel={periodLabel}
              onSetLogsServerUrl={setLogsServerUrl}
            />
            <FailedJobsTable
              d={d}
              colOrder={colOrder}
              colWidths={colWidths}
              tableHeight={tableHeight}
              setTableHeight={setTableHeight}
              handleTableResizeStart={handleTableResizeStart}
              handleColResizeStart={handleColResizeStart}
              handleDragStart={handleDragStart}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              onViewLogs={setSelectedJob}
              onViewServerLogs={setLogsServerUrl}
            />
          </>
        )}
      </div>

      {selectedJob && (
        <FailedJobModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}
    </div>
  )
}
