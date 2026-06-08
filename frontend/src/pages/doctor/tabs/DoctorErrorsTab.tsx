import { useEffect, useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Download, Filter, Search, MoreVertical, Bot, ChevronRight } from 'lucide-react'
import { SortableHeader } from '../../../components/ui/SortableHeader'
import { Pagination } from '../../../components/ui/Pagination'
import { SetoModal } from '../../../components/seto/SetoModal'
import {
  type ErrorAgg,
  type Range,
  ERROR_CODE_LABEL,
  ERROR_CODE_COLOR,
  errorCodeTone,
  downloadCSV,
  rangeToDays,
} from '../../analytics/analyticsHelpers'
import { type DrillTarget } from '../DoctorList'

const ROWS_PER_PAGE = 20
type SortKey = 'fails' | 'rate' | 'code'

type Row = {
  code: string
  label: string
  color: string
  count: number
  share: number
  sample: string | null
}

function ErrChip({ code }: { code: string }) {
  return (
    <span className={`chip chip-${errorCodeTone(code)}`} style={{ fontSize: 10 }}>
      {code}
    </span>
  )
}

export function DoctorErrorsTab({
  errors,
  excludeAborted,
  range,
  onDrill,
}: {
  errors: ErrorAgg[]
  excludeAborted: boolean
  range: Range
  onDrill: (t: DrillTarget) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('fails')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  /** Code currently open in the Seto modal — null when closed. Set via the
   *  row dot menu's "Ask Seto" action. */
  const [setoCode, setSetoCode] = useState<string | null>(null)

  const rows: Row[] = useMemo(() => {
    const visible = excludeAborted ? errors.filter((e) => e.code !== 'ABORTED') : errors
    const total = visible.reduce((a, e) => a + e.count, 0)
    return visible.map((e) => ({
      code: e.code,
      label: ERROR_CODE_LABEL[e.code] ?? e.code,
      color: ERROR_CODE_COLOR[e.code] ?? 'var(--ink-3)',
      count: e.count,
      share: total > 0 ? (e.count / total) * 100 : 0,
      sample: e.samples?.[0]?.slice(0, 200) ?? null,
    }))
  }, [errors, excludeAborted])

  const filtered = useMemo(() => {
    if (!query.trim()) return rows
    const q = query.toLowerCase()
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.sample ?? '').toLowerCase().includes(q),
    )
  }, [rows, query])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      if (sortKey === 'code') {
        const cmp = a.code.localeCompare(b.code)
        return sortDir === 'asc' ? cmp : -cmp
      }
      const av = sortKey === 'fails' ? a.count : a.share
      const bv = sortKey === 'fails' ? b.count : b.share
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return arr
  }, [filtered, sortKey, sortDir])

  // Reset to first page on any control change so the user doesn't land on an
  // empty page after a filter narrows the result set.
  useEffect(() => {
    setPage(1)
  }, [query, sortKey, sortDir, excludeAborted])

  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE))
  const pageRows = sorted.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)
  const totalCount = rows.reduce((a, r) => a + r.count, 0)

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const onExport = () => {
    downloadCSV(
      `doctor-errors-${range}.csv`,
      ['code', 'label', 'count', 'share %', 'sample reason'],
      sorted.map((r) => [r.code, r.label, r.count, r.share.toFixed(1), r.sample ?? '']),
    )
  }

  const days = rangeToDays(range)
  const rangeNote = days > 0 ? `last ${days} days` : 'all time'

  return (
    <>
      <div
        className="row"
        style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <span className="chip">
          <strong className="mono">{rows.length}</strong> {rows.length === 1 ? 'error' : 'errors'}
        </span>
        <span className="chip chip-bad">{totalCount.toLocaleString()} fails</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>· {rangeNote}</span>
        <span className="spacer" />
        <div className="search-wrap" style={{ width: 240 }}>
          <span className="search-ico">
            <Search size={14} />
          </span>
          <input
            className="input search-input"
            style={{ width: '100%' }}
            placeholder="Filter by code, label or sample…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn btn-sm" onClick={onExport} disabled={sorted.length === 0}>
          <Download size={14} /> Export
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title row" style={{ gap: 6 }}>
            <Filter size={12} /> Showing {pageRows.length} of {sorted.length}
            {sorted.length !== rows.length ? ` (filtered from ${rows.length})` : ''}
          </div>
          <span className="spacer" />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            Click any row to drill into the jobs that failed with this code
          </span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <SortableHeader<SortKey>
                label="Code"
                col="code"
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                style={{ width: 130 }}
              />
              <th>Error type</th>
              <SortableHeader<SortKey>
                label="Count"
                col="fails"
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <SortableHeader<SortKey>
                label="Share"
                col="rate"
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <th>Sample reason</th>
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.code}
                onClick={() => onDrill({ kind: 'error', id: r.code, color: r.color, label: r.label })}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <ErrChip code={r.code} />
                </td>
                <td>
                  <strong>{r.label}</strong>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {r.count.toLocaleString()}
                </td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <div className="bar" style={{ flex: 1, minWidth: 80 }}>
                      <i style={{ width: r.share + '%', background: r.color }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11 }}>
                      {r.share.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    maxWidth: 320,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={r.sample ?? undefined}
                >
                  {r.sample ?? '—'}
                </td>
                <ErrorRowMenu
                  code={r.code}
                  label={r.label}
                  color={r.color}
                  onAskSeto={() => setSetoCode(r.code)}
                  onDrill={() =>
                    onDrill({ kind: 'error', id: r.code, color: r.color, label: r.label })
                  }
                />
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 32 }}
                >
                  {query
                    ? `No errors match “${query}”.`
                    : 'No errors recorded in this range.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={page}
          totalPages={totalPages}
          onChange={setPage}
          leftLabel={`${sorted.length.toLocaleString()} total`}
        />
      </div>
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

/* ─── Per-row dot menu ──────────────────────────────────────────
   Same visual shape as JobRowMenu but only two actions: "Ask Seto" (opens
   the error-kind Seto modal) and "Show jobs" (drills into the failures
   list filtered by this code). The whole-row click also drills, so the
   menu's "Show jobs" is mostly here for parity. */
function ErrorRowMenu({
  code,
  onAskSeto,
  onDrill,
}: {
  code: string
  label: string
  color: string
  onAskSeto: () => void
  onDrill: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  return (
    <td style={{ width: 32, padding: '0 4px' }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        className="btn btn-ghost"
        style={{ width: 26, height: 26, padding: 0, border: 0, color: 'var(--ink-3)' }}
        onClick={toggle}
        title={`Actions for ${code}`}
      >
        <MoreVertical size={13} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              width: 200,
              zIndex: 9999,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
              fontSize: 12,
            }}
          >
            <MenuItem
              icon={Bot}
              label="Ask Seto"
              onClick={() => {
                setOpen(false)
                onAskSeto()
              }}
            />
            <MenuItem
              icon={ChevronRight}
              label="Show failing jobs"
              onClick={() => {
                setOpen(false)
                onDrill()
              }}
            />
          </div>,
          document.body,
        )}
    </td>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
}) {
  return (
    <button
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="row"
      style={{
        width: '100%',
        padding: '7px 12px',
        background: 'transparent',
        border: 0,
        fontSize: 12,
        color: 'var(--ink)',
        cursor: 'default',
        gap: 8,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={13} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
      {label}
    </button>
  )
}
