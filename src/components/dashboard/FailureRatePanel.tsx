import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import type { FailureRateByDay } from '@/features/dashboard/timeViewUtils'

export interface Annotation {
  id: string
  date: string
  text: string
  color: string
}

export interface FailureRatePanelProps {
  title: string
  data: FailureRateByDay | null
  loading?: boolean
  annotations?: Annotation[]
}

const CHART_HEIGHT = 200
const PADDING = { top: 16, right: 16, bottom: 36, left: 44 }
const FALLBACK_WIDTH = 800

export function FailureRatePanel({ title, data, loading = false, annotations = [] }: FailureRatePanelProps): React.ReactElement {
  const chartWrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = chartWrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width)
        if (w > 0) setMeasuredWidth(w)
      }
    })
    ro.observe(el)
    const w = el.getBoundingClientRect().width
    if (w > 0) setMeasuredWidth(Math.round(w))
    return () => ro.disconnect()
  }, [])

  // Auto-unpin on page scroll (not tooltip scroll)
  useEffect(() => {
    const handlePageScroll = (e: Event) => {
      if (pinnedIndex == null) return
      if (tooltipRef.current?.contains(e.target as Node)) return
      setPinnedIndex(null)
    }
    document.addEventListener('scroll', handlePageScroll, true)
    return () => document.removeEventListener('scroll', handlePageScroll, true)
  }, [pinnedIndex])

  const chartWidth = measuredWidth || FALLBACK_WIDTH
  const innerW = chartWidth - PADDING.left - PADDING.right
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom

  const { dates, rates, failedCounts, totalCounts } = data ?? { dates: [], rates: [], failedCounts: [], totalCounts: [] }

  const displayIndex = pinnedIndex != null ? pinnedIndex : hoveredIndex

  const annotationIndices = useMemo(() => {
    const dateSet = new Map(dates.map((d, i) => [d, i]))
    return annotations
      .map((ann) => ({ ...ann, index: dateSet.get(ann.date) }))
      .filter((ann) => ann.index != null)
  }, [annotations, dates])

  const hoveredDate = displayIndex != null ? dates[displayIndex] : null
  const hoveredDateAnnotations = useMemo(() => {
    if (!hoveredDate) return []
    return annotations.filter((a) => a.date === hoveredDate)
  }, [annotations, hoveredDate])

  const maxRate = useMemo(() => Math.max(10, ...rates), [rates])

  const scaleX = useCallback((i: number) => PADDING.left + (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW), [dates.length, innerW])
  const scaleY = useCallback((v: number) => PADDING.top + innerH - (v / maxRate) * innerH, [innerH, maxRate])

  const yTicks = useMemo(() => {
    const ticks: number[] = []
    const step = maxRate <= 10 ? 2 : maxRate <= 50 ? 10 : 20
    for (let v = 0; v <= maxRate; v += step) ticks.push(v)
    return ticks
  }, [maxRate])

  const points = useMemo(() => rates.map((r, i) => `${scaleX(i)},${scaleY(r)}`).join(' '), [rates, scaleX, scaleY])

  // Area fill under line
  const areaPath = useMemo(() => {
    if (rates.length === 0) return ''
    const pts = rates.map((r, i) => `${scaleX(i)},${scaleY(r)}`)
    return `M${scaleX(0)},${PADDING.top + innerH} L${pts.join(' L')} L${scaleX(rates.length - 1)},${PADDING.top + innerH} Z`
  }, [rates, scaleX, scaleY, innerH])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (pinnedIndex != null) return
    const svg = svgRef.current
    if (!svg || dates.length === 0) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgPt = pt.matrixTransform(ctm.inverse())
    const idx = Math.round(((svgPt.x - PADDING.left) / innerW) * (dates.length - 1))
    const clamped = Math.max(0, Math.min(dates.length - 1, idx))
    setHoveredIndex(clamped)
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [dates.length, innerW, pinnedIndex])

  const handleMouseLeave = useCallback(() => {
    if (pinnedIndex == null) { setHoveredIndex(null); setTooltipPos(null) }
  }, [pinnedIndex])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (hoveredIndex != null) {
      setPinnedIndex(pinnedIndex === hoveredIndex ? null : hoveredIndex)
    }
  }, [hoveredIndex, pinnedIndex])

  return (
    <section className="dashboard-timeseries-panel dashboard-failure-rate-panel">
      <div className="dashboard-timeseries-header">
        <h2 className="dashboard-timeseries-title">{title}</h2>
      </div>
      {loading ? (
        <div className="dashboard-timeseries-loading" aria-busy="true">
          <span className="dashboard-workflows-loading-spinner" />
          <span>Loading…</span>
        </div>
      ) : dates.length === 0 ? (
        <p className="dashboard-timeseries-empty">No data in range.</p>
      ) : (
        <div className="dashboard-timeseries-chart-wrap" ref={chartWrapRef}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: 'auto', cursor: 'pointer' }}
            aria-label={title}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
          >
            {/* Y gridlines + ticks */}
            {yTicks.map((v) => (
              <g key={v}>
                <line
                  x1={PADDING.left} y1={scaleY(v)}
                  x2={PADDING.left + innerW} y2={scaleY(v)}
                  className="dashboard-timeseries-chart-gridline"
                  strokeWidth={1} strokeDasharray="2 2"
                />
                <text x={PADDING.left - 6} y={scaleY(v) + 4} className="dashboard-timeseries-chart-y-tick" textAnchor="end">
                  {v}%
                </text>
              </g>
            ))}

            {/* Area fill */}
            <path d={areaPath} fill="rgba(220, 38, 38, 0.1)" />

            {/* Annotation vertical lines */}
            {annotationIndices.map((ann) => (
              <line
                key={`ann-${ann.id}`}
                x1={scaleX(ann.index!)}
                y1={PADDING.top}
                x2={scaleX(ann.index!)}
                y2={PADDING.top + innerH}
                stroke={ann.color}
                strokeWidth={2}
                opacity={0.6}
                strokeDasharray="4 4"
              />
            ))}

            {/* Line */}
            <polyline fill="none" stroke="#dc2626" strokeWidth={2} points={points} />

            {/* Hover */}
            {hoveredIndex != null && (
              <>
                <line
                  x1={scaleX(hoveredIndex)} y1={PADDING.top}
                  x2={scaleX(hoveredIndex)} y2={PADDING.top + innerH}
                  className="dashboard-timeseries-chart-hover-line" strokeWidth={1}
                />
                <circle
                  cx={scaleX(hoveredIndex)} cy={scaleY(rates[hoveredIndex] ?? 0)}
                  r={4} fill="#dc2626" stroke="var(--bg-secondary, #1a2332)" strokeWidth={2}
                />
              </>
            )}

            {/* X labels */}
            {dates.map((d, i) => {
              const step = dates.length <= 12 ? 1 : Math.ceil(dates.length / 12)
              if (i % step !== 0 && i !== dates.length - 1) return null
              return (
                <text key={d} x={scaleX(i)} y={CHART_HEIGHT - 8} className="dashboard-timeseries-chart-label" textAnchor="middle">
                  {d.slice(5)}
                </text>
              )
            })}
          </svg>

          {/* Tooltip */}
          {displayIndex != null && tooltipPos && (
            <div
              ref={tooltipRef}
              className="dashboard-timeseries-tooltip"
              style={{
                left: tooltipPos.x + 12,
                top: tooltipPos.y + 12,
                maxHeight: pinnedIndex != null ? '220px' : 'auto',
                overflowY: pinnedIndex != null ? 'auto' : 'visible',
              }}
              role="tooltip"
            >
              <div className="dashboard-timeseries-tooltip-header">
                <span className="dashboard-timeseries-tooltip-date">{dates[displayIndex]}</span>
                {pinnedIndex != null && (
                  <button type="button" className="dashboard-timeseries-tooltip-close" onClick={() => setPinnedIndex(null)} title="Unpin">×</button>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#f87171', padding: '0.15rem 0' }}>
                {rates[displayIndex]?.toFixed(1)}% failure rate
              </div>
              <div style={{ fontSize: 11, color: '#697784', marginBottom: hoveredDateAnnotations.length > 0 ? '0.4rem' : 0 }}>
                {failedCounts[displayIndex]} failed / {totalCounts[displayIndex]} total
              </div>
              {hoveredDateAnnotations.length > 0 && (
                <div className="dashboard-timeseries-tooltip-annotations">
                  {hoveredDateAnnotations.map((ann) => (
                    <div key={ann.id} className="dashboard-timeseries-tooltip-annotation-row">
                      <span className="dashboard-timeseries-tooltip-annotation-dot" style={{ backgroundColor: ann.color }} />
                      <span className="dashboard-timeseries-tooltip-annotation-text">{ann.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
