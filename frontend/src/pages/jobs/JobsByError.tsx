import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Bot } from 'lucide-react'
import { api } from '../../lib/api'
import { RangeSelector } from '../../components/ui/RangeSelector'
import { SetoModal } from '../../components/seto/SetoModal'
import {
  type Range,
  rangeToDays,
  classifyError,
  errorCodeTone,
  ERROR_CODE_LABEL,
  ERROR_CODE_COLOR,
} from '../analytics/analyticsHelpers'
import {
  type UnifiedJobsPage,
  type Row,
  unifiedToRow,
  fmtSec,
  fmtCompleted,
  JobKindBadge,
  JobModal,
} from './shared'

/**
 * Failed-jobs view grouped by classified error code.
 *
 * Pulls the most recent N failed jobs in the selected range, groups them
 * client-side via `classifyError(failed_reason)`, and renders one row per
 * code with the count + an expand-to-list affordance.
 *
 * The window is bounded by the API's MAX_LIMIT (200) so very high-failure
 * windows show only the most recent runs. Counts are not the global truth
 * for the range — they're "of these 200 recent failures, N matched". For
 * the analytics-driven truth, the Doctor → Errors tab is the source.
 */
const FETCH_LIMIT = 200

export function JobsByError() {
  const [range, setRange] = useState<Range>('7d')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openRow, setOpenRow] = useState<Row | null>(null)
  /** Error code currently open in the Seto modal — set by the "Ask Seto"
   *  button on each group header. */
  const [setoCode, setSetoCode] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      status: 'failed',
      limit: String(FETCH_LIMIT),
      page: '1',
    })
    const days = rangeToDays(range)
    if (days > 0) params.set('days', String(days))
    api
      .get<UnifiedJobsPage>(`/api/jobs?${params}`)
      .then((res) => {
        const now = Date.now()
        setRows((res.items ?? []).map((j) => unifiedToRow(j, now)))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [range])

  // Group: code → { code, label, color, count, jobs[], sample }
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { code: string; label: string; color: string; jobs: Row[]; samples: string[] }
    >()
    for (const r of rows) {
      const code = classifyError(r.failedReason)
      const cur = map.get(code) ?? {
        code,
        label: ERROR_CODE_LABEL[code] ?? code,
        color: ERROR_CODE_COLOR[code] ?? 'var(--ink-3)',
        jobs: [],
        samples: [],
      }
      cur.jobs.push(r)
      if (r.failedReason && cur.samples.length < 3) cur.samples.push(r.failedReason.slice(0, 200))
      map.set(code, cur)
    }
    return [...map.values()].sort((a, b) => b.jobs.length - a.jobs.length)
  }, [rows])

  const toggle = (code: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const total = rows.length

  return (
    <>
      <div className="row" style={{ marginBottom: 12, gap: 10, alignItems: 'center' }}>
        <span className="chip chip-bad">
          <strong className="mono">{total.toLocaleString()}</strong> failed jobs grouped
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          · most recent {FETCH_LIMIT} failures in range · for global truth see Doctor → Errors
        </span>
        <span className="spacer" />
        <RangeSelector range={range} onChange={setRange} />
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>
          Loading failures…
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : groups.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>
          No failures in this range.
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {groups.map((g) => {
            const isOpen = expanded.has(g.code)
            const share = total > 0 ? (g.jobs.length / total) * 100 : 0
            return (
              <div className="card" key={g.code}>
                <button
                  type="button"
                  className="row card-pad"
                  onClick={() => toggle(g.code)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                    gap: 10,
                    alignItems: 'center',
                    textAlign: 'left',
                  }}
                >
                  <ChevronRight
                    size={14}
                    style={{
                      color: 'var(--ink-3)',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                      transition: 'transform .15s',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    className={`chip chip-${errorCodeTone(g.code)}`}
                    style={{ fontSize: 11, flexShrink: 0 }}
                  >
                    {g.code}
                  </span>
                  <strong style={{ flex: 1, minWidth: 0 }}>{g.label}</strong>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {g.jobs.length.toLocaleString()} · {share.toFixed(0)}%
                  </span>
                  <div className="bar" style={{ width: 80, flexShrink: 0 }}>
                    <i style={{ width: `${share}%`, background: g.color }} />
                  </div>
                  {/* Ask Seto button — non-toggling click target inside the
                      header button. stopPropagation prevents the row toggle. */}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSetoCode(g.code)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        setSetoCode(g.code)
                      }
                    }}
                    className="btn btn-sm btn-ghost"
                    style={{ gap: 4, flexShrink: 0 }}
                    title={`Ask Seto about ${g.code}`}
                  >
                    <Bot size={12} /> Ask Seto
                  </span>
                </button>
                {isOpen && (
                  <table className="tbl" style={{ borderTop: '1px solid var(--line)' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>Type</th>
                        <th style={{ width: 100 }}>Job ID</th>
                        <th>Name</th>
                        <th style={{ width: 120 }}>User</th>
                        <th style={{ width: 110 }}>Service</th>
                        <th style={{ width: 90 }}>Duration</th>
                        <th style={{ width: 155 }}>Failed</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.jobs.map((r) => (
                        <tr
                          key={r.key}
                          onClick={() => setOpenRow(r)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <JobKindBadge kind={r.kind} />
                          </td>
                          <td>
                            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                              {r.id}
                            </span>
                          </td>
                          <td>
                            <strong>{r.name}</strong>
                          </td>
                          <td style={{ color: r.who === '—' ? 'var(--ink-3)' : undefined }}>
                            {r.who}
                          </td>
                          <td className="mono" style={{ color: !r.server ? 'var(--ink-3)' : undefined }}>
                            {r.server ?? '—'}
                          </td>
                          <td className="mono">{fmtSec(r.totalSec)}</td>
                          <td style={{ color: 'var(--ink-2)', fontSize: 12 }}>
                            {fmtCompleted(r.completedAt)}
                          </td>
                          <td
                            style={{
                              fontSize: 12,
                              color: 'var(--ink-3)',
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={r.failedReason ?? undefined}
                          >
                            {r.failedReason ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}

      {openRow && <JobModal row={openRow} onClose={() => setOpenRow(null)} />}
      {setoCode && (
        <SetoModal
          kind="error"
          id={setoCode}
          label={ERROR_CODE_LABEL[setoCode] ?? setoCode}
          onClose={() => setSetoCode(null)}
        />
      )}
    </>
  )
}
