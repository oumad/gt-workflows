import React, { useMemo, useState, useRef } from 'react'
import type { HeatmapData } from '@/features/dashboard/timeViewUtils'

export interface Annotation {
  id: string
  date: string
  text: string
  color: string
}

export interface HeatmapPanelProps {
  title: string
  data: HeatmapData | null
  loading?: boolean
  annotations?: Annotation[]
  dateRange?: string
}

const CELL_SIZE = 28
const GAP = 2
const LABEL_W = 36
const LABEL_H = 20
const COLS = 24
const ROWS = 7

/** Interpolate between two hex colors. t in [0,1]. */
function lerpColor(a: string, b: string, t: number): string {
  const parse = (c: string) => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ]
  const ca = parse(a)
  const cb = parse(b)
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t)
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`
}

const COLOR_EMPTY = '#1a2332'
const COLOR_LOW = '#2d1f5e'
const COLOR_MID = '#7a4db0'
const COLOR_HIGH = '#c9a6f0'

function cellColor(count: number, max: number): string {
  if (count === 0 || max === 0) return COLOR_EMPTY
  const t = count / max
  if (t < 0.5) return lerpColor(COLOR_LOW, COLOR_MID, t * 2)
  return lerpColor(COLOR_MID, COLOR_HIGH, (t - 0.5) * 2)
}

export function HeatmapPanel({ title, data, loading = false, annotations = [], dateRange }: HeatmapPanelProps): React.ReactElement {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; day: string; hour: number; count: number } | null>(null)
  const [pinTooltip, setPinTooltip] = useState<{ x: number; y: number; text: string; color: string; date: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const svgWidth = LABEL_W + COLS * (CELL_SIZE + GAP)
  const svgHeight = LABEL_H + ROWS * (CELL_SIZE + GAP)

  // Annotation pins: parse date, determine ISO weekday, position at hour 12
  const annotationPins = useMemo(() => {
    return annotations.map((ann) => {
      const [y, m, d] = ann.date.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      const isoDay = (date.getDay() + 6) % 7 // 0=Mon...6=Sun
      const col = 12 // noon
      const x = LABEL_W + col * (CELL_SIZE + GAP) + CELL_SIZE / 2
      const y_px = LABEL_H + isoDay * (CELL_SIZE + GAP) + CELL_SIZE / 2
      return { x, y_px, color: ann.color, text: ann.text, date: ann.date }
    })
  }, [annotations])

  const handlePinMouse = (e: React.MouseEvent, pin: { x: number; y_px: number; color: string; text: string; date: string }) => {
    e.stopPropagation()
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip(null)
    setPinTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: pin.text, color: pin.color, date: pin.date })
  }

  const cells = useMemo(() => {
    if (!data || data.grid.length === 0) return []
    const out: { row: number; col: number; count: number; color: string }[] = []
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const count = data.grid[r]?.[c] ?? 0
        out.push({ row: r, col: c, count, color: cellColor(count, data.maxCount) })
      }
    }
    return out
  }, [data])

  const handleCellMouse = (e: React.MouseEvent, row: number, col: number, count: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      day: data?.dayLabels[row] ?? '',
      hour: col,
      count,
    })
  }

  return (
    <section className="dashboard-timeseries-panel dashboard-heatmap-panel">
      <div className="dashboard-timeseries-header">
        <h2 className="dashboard-timeseries-title">{title}</h2>
        {dateRange && <span style={{ fontSize: 12, color: '#8897a8', marginLeft: 'auto' }}>{dateRange}</span>}
      </div>
      {loading ? (
        <div className="dashboard-timeseries-loading" aria-busy="true">
          <span className="dashboard-workflows-loading-spinner" />
          <span>Loading…</span>
        </div>
      ) : !data || data.maxCount === 0 ? (
        <p className="dashboard-timeseries-empty">No data in range.</p>
      ) : (
        <div className="dashboard-heatmap-wrap" ref={wrapRef}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{ width: '100%', maxWidth: svgWidth, height: 'auto' }}
            aria-label={title}
          >
            {/* Hour labels */}
            {Array.from({ length: COLS }, (_, c) => (
              c % 3 === 0 && (
                <text
                  key={`h${c}`}
                  x={LABEL_W + c * (CELL_SIZE + GAP) + CELL_SIZE / 2}
                  y={LABEL_H - 4}
                  textAnchor="middle"
                  className="dashboard-heatmap-label"
                >
                  {c === 0 ? '12a' : c < 12 ? `${c}a` : c === 12 ? '12p' : `${c - 12}p`}
                </text>
              )
            ))}

            {/* Day labels + cells */}
            {data.dayLabels.map((day, r) => (
              <React.Fragment key={day}>
                <text
                  x={LABEL_W - 6}
                  y={LABEL_H + r * (CELL_SIZE + GAP) + CELL_SIZE / 2 + 4}
                  textAnchor="end"
                  className="dashboard-heatmap-label"
                >
                  {day}
                </text>
              </React.Fragment>
            ))}

            {cells.map(({ row, col, count, color }) => (
              <rect
                key={`${row}-${col}`}
                x={LABEL_W + col * (CELL_SIZE + GAP)}
                y={LABEL_H + row * (CELL_SIZE + GAP)}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={4}
                fill={color}
                className="dashboard-heatmap-cell"
                onMouseMove={(e) => handleCellMouse(e, row, col, count)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}

            {/* Annotation pins */}
            {annotationPins.map((pin, i) => (
              <circle
                key={`pin-${i}`}
                cx={pin.x}
                cy={pin.y_px}
                r={6}
                fill={pin.color}
                stroke="#fff"
                strokeWidth={2}
                opacity={0.9}
                style={{ cursor: 'pointer' }}
                onMouseMove={(e) => handlePinMouse(e, pin)}
                onMouseLeave={() => setPinTooltip(null)}
              />
            ))}
          </svg>

          {/* Color legend */}
          <div className="dashboard-heatmap-legend">
            <span className="dashboard-heatmap-legend-text">Less</span>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <span
                key={t}
                className="dashboard-heatmap-legend-swatch"
                style={{ backgroundColor: t === 0 ? COLOR_EMPTY : cellColor(Math.round(t * data.maxCount), data.maxCount) }}
              />
            ))}
            <span className="dashboard-heatmap-legend-text">More</span>
          </div>

          {/* Cell tooltip */}
          {tooltip && (
            <div
              className="dashboard-timeseries-tooltip"
              style={{ position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 8 }}
              role="tooltip"
            >
              <div className="dashboard-timeseries-tooltip-header">
                <span className="dashboard-timeseries-tooltip-date">{tooltip.day} {tooltip.hour}:00–{tooltip.hour}:59</span>
              </div>
              <div style={{ fontSize: 12, color: '#b8c4d0', padding: '0.2rem 0' }}>
                {tooltip.count} job{tooltip.count !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {/* Pin tooltip */}
          {pinTooltip && (
            <div
              className="dashboard-timeseries-tooltip"
              style={{ position: 'absolute', left: pinTooltip.x + 12, top: pinTooltip.y - 8 }}
              role="tooltip"
            >
              <div className="dashboard-timeseries-tooltip-header">
                <span className="dashboard-timeseries-tooltip-date">{pinTooltip.date}</span>
              </div>
              <div className="dashboard-timeseries-tooltip-annotations" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                <div className="dashboard-timeseries-tooltip-annotation-row">
                  <span className="dashboard-timeseries-tooltip-annotation-dot" style={{ backgroundColor: pinTooltip.color }} />
                  <span className="dashboard-timeseries-tooltip-annotation-text">{pinTooltip.text}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
