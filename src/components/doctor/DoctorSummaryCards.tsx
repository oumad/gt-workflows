import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, Hash, Percent } from 'lucide-react'
import type { DoctorState } from './useDoctor'
import type { DoctorRankItem, WeeklyHistoryItem } from '@/services/api/stats'

// ── Shared style constants ────────────────────────────────────────────────────

const CARD = 'bg-secondary border border-default/70 rounded-[10px] px-[1.1rem] py-4 flex flex-col gap-1'
const CARD_HEADER = 'text-sm font-semibold uppercase tracking-[0.06em] text-muted mb-[0.1rem]'
const NAV_BTN = 'inline-flex items-center justify-center w-7 h-7 bg-transparent border border-default rounded-md text-muted cursor-pointer shrink-0 transition-[background,color] duration-150 enabled:hover:bg-tertiary enabled:hover:text-primary disabled:opacity-30 disabled:cursor-default'

// ── Sub-components ────────────────────────────────────────────────────────────

function WeeklyTrendCard({ history }: { history: WeeklyHistoryItem[] }): React.ReactElement {
  const [weekIdx, setWeekIdx] = useState(0)
  const [showPct, setShowPct] = useState(false)
  const current = history[weekIdx]
  const previous = weekIdx < history.length - 1 ? history[weekIdx + 1] : null
  const hasPrev = weekIdx < history.length - 1
  const hasNext = weekIdx > 0

  let trendColor = 'text-muted'
  let TrendIcon = Minus
  if (current && previous && current.count !== previous.count) {
    if (current.count > previous.count) {
      trendColor = 'text-semantic-error'
      TrendIcon = TrendingUp
    } else {
      trendColor = 'text-semantic-success'
      TrendIcon = TrendingDown
    }
  }

  const failRate = current && current.total > 0
    ? ((current.count / current.total) * 100)
    : 0

  return (
    <div className={`${CARD} flex-1`}>
      <div className="flex items-center justify-between gap-2 mb-[0.4rem]">
        <span className={CARD_HEADER}>Weekly Failure Trend</span>
        <button
          type="button"
          className={`inline-flex items-center justify-center w-[26px] h-[26px] border rounded-[5px] cursor-pointer transition-[background,color,border-color] duration-150 hover:bg-tertiary hover:text-primary ${showPct ? 'bg-accent/15 border-accent text-[#c9a6f0]' : 'bg-transparent border-default text-muted'}`}
          onClick={() => setShowPct((v) => !v)}
          title={showPct ? 'Show count' : 'Show failure rate'}
        >
          {showPct ? <Hash size={13} /> : <Percent size={13} />}
        </button>
      </div>
      <div className="flex items-center gap-1 flex-1">
        <button type="button" className={NAV_BTN} disabled={!hasPrev} onClick={() => setWeekIdx((i) => i + 1)} title="Older week">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 flex flex-col items-center gap-[0.1rem] text-center">
          <div className="text-[1.9rem] font-bold tabular-nums leading-[1.2] text-primary flex items-baseline gap-[0.4rem]">
            {showPct
              ? (current ? `${failRate % 1 === 0 ? failRate.toFixed(0) : failRate.toFixed(1)}%` : '—')
              : (current ? current.count.toLocaleString() : '—')
            }
            {current && previous && (
              <TrendIcon size={16} className={`shrink-0 ${trendColor}`} />
            )}
          </div>
          <div className="text-sm text-muted">{current?.label ?? '—'}</div>
          {current && (
            <div className="text-sm text-[#697784] mt-[0.1rem]">
              {showPct
                ? `${current.count.toLocaleString()} failures / ${current.total.toLocaleString()} total`
                : previous ? `vs. ${previous.label}: ${previous.count.toLocaleString()}` : ''
              }
            </div>
          )}
        </div>
        <button type="button" className={NAV_BTN} disabled={!hasNext} onClick={() => setWeekIdx((i) => i - 1)} title="More recent week">
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

function RankingCard({ title, items, emptyLabel, onItemClick }: {
  title: string
  items: DoctorRankItem[]
  emptyLabel: string
  onItemClick?: (name: string) => void
}): React.ReactElement {
  const max = items.length ? items[0].count : 1
  const clickable = Boolean(onItemClick)
  return (
    <div className={`${CARD} min-h-[140px] max-h-[320px] overflow-hidden`}>
      <div className={CARD_HEADER}>{title}</div>
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm py-5">{emptyLabel}</div>
      ) : (
        <ul className="doctor-rank-list list-none m-0 mt-[0.4rem] pr-1 pb-1 flex flex-col gap-[0.4rem] overflow-y-auto flex-1 min-h-0">
          {items.slice(0, 10).map((item) => (
            <li
              key={item.name}
              className={`grid grid-cols-[1fr_auto] gap-[0.35rem] items-center text-sm${clickable ? ' group cursor-pointer rounded px-[0.2rem] -mx-[0.2rem] transition-[background] duration-[120ms] hover:bg-accent/10' : ''}`}
              onClick={onItemClick ? () => onItemClick(item.name) : undefined}
              title={item.name}
            >
              <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-secondary${clickable ? ' group-hover:text-[#c9a6f0]' : ''}`}>{item.name}</span>
              <span className="font-semibold tabular-nums text-right min-w-9 text-semantic-error text-sm">{item.count.toLocaleString()}</span>
              <div className="col-span-2 h-[2px] rounded-[2px] bg-default/60 overflow-hidden">
                <div className="h-full rounded-[2px] bg-gradient-to-r from-[#7a2a2a] to-semantic-error transition-[width] duration-300" style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface DoctorSummaryCardsProps {
  d: DoctorState
  periodLabel: string
  onSetLogsServerUrl: (url: string) => void
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function DoctorSummaryCards({ d, periodLabel, onSetLogsServerUrl }: DoctorSummaryCardsProps): React.ReactElement {
  const navigate = useNavigate()

  const noDataLabel = (label: string) =>
    d.hideAborted ? `${label} (excl. aborted)` : label

  const handleWorkflowClick = (name: string) => {
    if (name && name !== '—') navigate(`/workflows/workflow/${encodeURIComponent(name)}`)
  }

  return (
    <>
      {/* Top row: summary cards + top error types */}
      <div className="grid grid-cols-[1fr_1.6fr] gap-4 mb-4 items-stretch max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-4">
          <div className={CARD}>
            <div className={CARD_HEADER}>Total Failures</div>
            <div className="text-[2rem] font-bold leading-[1.2] text-primary flex items-baseline gap-2 tabular-nums">
              {d.totalFailed.toLocaleString()}
            </div>
            <div className="text-sm text-muted mt-[0.1rem]">
              {periodLabel}{d.hideAborted ? ' · excl. aborted' : ''}
            </div>
          </div>
          <WeeklyTrendCard history={d.weeklyHistory} />
        </div>
        <RankingCard
          title="Top Error Types"
          items={d.topErrors}
          emptyLabel={noDataLabel('No errors in this period')}
          onItemClick={(errorText) => d.setFailedJobsFilter('error', errorText)}
        />
      </div>

      {/* Rankings row */}
      <div className="grid grid-cols-3 gap-4 mb-4 max-[900px]:grid-cols-1">
        <RankingCard
          title="Workflows with Most Failures"
          items={d.topWorkflows}
          emptyLabel={noDataLabel('No failures in this period')}
          onItemClick={handleWorkflowClick}
        />
        <RankingCard
          title="Servers with Most Failures"
          items={d.topServers}
          emptyLabel={noDataLabel('No server failures in this period')}
          onItemClick={(url) => onSetLogsServerUrl(url)}
        />
        <RankingCard
          title="Users with Most Failures"
          items={d.topUsers}
          emptyLabel={noDataLabel('No user failures in this period')}
          onItemClick={(user) => d.setFailedJobsFilter('user', user)}
        />
      </div>
    </>
  )
}
