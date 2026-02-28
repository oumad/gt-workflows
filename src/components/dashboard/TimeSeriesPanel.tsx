import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import type { TimeSeriesItem } from '@/features/dashboard/useTimeViewSeries'
import './Dashboard.css'

const CHART_HEIGHT = 260
const CHART_PADDING = { top: 12, right: 12, bottom: 32, left: 52 }
const Y_AXIS_TICKS = 5
const DOWNLOAD_LEGEND_HEIGHT = 44
const DOWNLOAD_LEGEND_ITEM_GAP = 14
const DOWNLOAD_LEGEND_LABEL_GAP = 6

export interface TimeSeriesPanelProps {
  title: string
  series: TimeSeriesItem[]
  dates: string[]
  selectedKeys: Set<string>
  onSelectionChange: (selected: Set<string>) => void
  dropdownLabel?: string
  loading?: boolean
}

export function TimeSeriesPanel({
  title,
  series,
  dates,
  selectedKeys,
  onSelectionChange,
  dropdownLabel = 'Filter',
  loading = false,
}: TimeSeriesPanelProps): React.ReactElement {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const chartWrapRef = useRef<HTMLDivElement>(null)

  const filteredNames = useMemo((): string[] => {
    if (!search.trim()) return series.map((s) => s.name)
    const q = search.trim().toLowerCase()
    return series.map((s) => s.name).filter((name) => name.toLowerCase().includes(q))
  }, [series, search])

  const handleSelectAll = useCallback(() => {
    onSelectionChange(new Set(series.map((s) => s.name)))
  }, [series, onSelectionChange])

  const handleSelectNone = useCallback(() => {
    onSelectionChange(new Set())
  }, [onSelectionChange])

  const toggleOne = useCallback(
    (name: string) => {
      const next = new Set(selectedKeys)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      onSelectionChange(next)
    },
    [selectedKeys, onSelectionChange]
  )

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const visibleSeries = useMemo(
    () => series.filter((s) => selectedKeys.has(s.name)),
    [series, selectedKeys]
  )

  const maxVal = useMemo((): number => {
    if (visibleSeries.length === 0) return 1
    let m = 0
    for (const s of visibleSeries) {
      for (const v of s.values) if (v > m) m = v
    }
    return m || 1
  }, [visibleSeries])

  const chartWidth = Math.max(600, (dates.length * 56) | 0)
  const innerWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

  const scaleY = (v: number): number =>
    CHART_PADDING.top + innerHeight - (v / maxVal) * innerHeight
  const scaleX = (i: number): number =>
    CHART_PADDING.left + (i / Math.max(1, dates.length - 1)) * innerWidth

  const yTickValues = useMemo((): number[] => {
    const out: number[] = []
    for (let i = 0; i <= Y_AXIS_TICKS; i++) {
      out.push(Math.round((maxVal * i) / Y_AXIS_TICKS))
    }
    return out
  }, [maxVal])

  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      if (!svg || dates.length === 0) return
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const svgPt = pt.matrixTransform(ctm.inverse())
      const x = svgPt.x
      if (x < CHART_PADDING.left || x > CHART_PADDING.left + innerWidth) {
        setHoveredIndex(null)
        setTooltipPos(null)
        return
      }
      const idx = Math.round(
        ((x - CHART_PADDING.left) * (dates.length - 1)) / innerWidth
      )
      const clamped = Math.max(0, Math.min(idx, dates.length - 1))
      setHoveredIndex(clamped)
      setTooltipPos({ x: e.clientX, y: e.clientY })
    },
    [dates.length, innerWidth]
  )

  const handleChartMouseLeave = useCallback(() => {
    setHoveredIndex(null)
    setTooltipPos(null)
  }, [])

  const hoveredDate = hoveredIndex != null ? dates[hoveredIndex] : null
  const hoveredValues =
    hoveredIndex != null
      ? visibleSeries.map((s) => ({ name: s.name, color: s.color, value: s.values[hoveredIndex] ?? 0 }))
      : []

  const handleDownload = useCallback(() => {
    const svg = svgRef.current
    if (!svg || dates.length === 0) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.querySelectorAll('.dashboard-timeseries-chart-hover-line, .dashboard-timeseries-chart-hover-dot').forEach((el) => el.remove())
    const rect = clone.querySelector('rect[aria-hidden]')
    if (rect) rect.remove()
    const root = document.documentElement
    const getVar = (v: string): string =>
      getComputedStyle(root).getPropertyValue(v).trim() || '#888'
    const textColor = getVar('--text-secondary')
    const ns = 'http://www.w3.org/2000/svg'
    const legendG = document.createElementNS(ns, 'g')
    legendG.setAttribute('class', 'dashboard-timeseries-download-legend')
    let x = CHART_PADDING.left
    let row = 0
    const rowHeight = 20
    const colorSize = 10
    const fontSize = 11
    const maxX = chartWidth - CHART_PADDING.right
    for (const s of visibleSeries) {
      const approxWidth = colorSize + DOWNLOAD_LEGEND_LABEL_GAP + Math.min(s.name.length * (fontSize * 0.6), 180)
      if (x + approxWidth > maxX && x > CHART_PADDING.left) {
        x = CHART_PADDING.left
        row += 1
      }
      const legendY = CHART_HEIGHT + 18 + row * rowHeight
      const rectEl = document.createElementNS(ns, 'rect')
      rectEl.setAttribute('x', String(x))
      rectEl.setAttribute('y', String(legendY - colorSize + 2))
      rectEl.setAttribute('width', String(colorSize))
      rectEl.setAttribute('height', String(colorSize))
      rectEl.setAttribute('fill', s.color)
      rectEl.setAttribute('rx', '2')
      legendG.appendChild(rectEl)
      const textEl = document.createElementNS(ns, 'text')
      textEl.setAttribute('x', String(x + colorSize + DOWNLOAD_LEGEND_LABEL_GAP))
      textEl.setAttribute('y', String(legendY + 1))
      textEl.setAttribute('fill', textColor)
      textEl.setAttribute('font-size', String(fontSize))
      textEl.setAttribute('font-family', 'system-ui, sans-serif')
      textEl.textContent = s.name
      legendG.appendChild(textEl)
      x += approxWidth + DOWNLOAD_LEGEND_ITEM_GAP
    }
    const totalHeight = CHART_HEIGHT + DOWNLOAD_LEGEND_HEIGHT + row * 20
    clone.setAttribute('width', String(chartWidth))
    clone.setAttribute('height', String(totalHeight))
    clone.setAttribute('viewBox', `0 0 ${chartWidth} ${totalHeight}`)
    clone.appendChild(legendG)
    const style = document.createElementNS(ns, 'style')
    style.textContent = `
      .dashboard-timeseries-chart-gridline { stroke: ${getVar('--border')}; }
      .dashboard-timeseries-chart-y-label, .dashboard-timeseries-chart-y-tick, .dashboard-timeseries-chart-label { fill: ${getVar('--text-muted')}; }
      .dashboard-timeseries-chart-hover-line { stroke: ${getVar('--accent')}; }
      .dashboard-timeseries-download-legend text { fill: ${textColor}; }
    `
    clone.insertBefore(style, clone.firstChild)
    const serializer = new XMLSerializer()
    const str = serializer.serializeToString(clone)
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = chartWidth
      canvas.height = totalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = getComputedStyle(root).getPropertyValue('--bg-secondary').trim() || '#1a1a1a'
      ctx.fillRect(0, 0, chartWidth, totalHeight)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
    img.onerror = () => {}
    img.src = svgDataUrl
  }, [dates.length, chartWidth, title, visibleSeries])

  return (
    <section className="dashboard-timeseries-panel">
      <div className="dashboard-timeseries-header">
        <h2 className="dashboard-timeseries-title">{title}</h2>
        <div className="dashboard-timeseries-header-actions">
          <button
            type="button"
            className="dashboard-timeseries-download-btn"
            onClick={handleDownload}
            disabled={dates.length === 0}
            title="Download chart as PNG"
            aria-label="Download chart as PNG"
          >
            <Download size={16} />
            Download
          </button>
          <div className="dashboard-timeseries-dropdown-wrap" ref={dropdownRef}>
          <button
            type="button"
            className="dashboard-timeseries-dropdown-btn"
            onClick={() => setDropdownOpen((o) => !o)}
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
            title={dropdownLabel}
          >
            <span className="dashboard-timeseries-dropdown-btn-text">
              {selectedKeys.size === 0
                ? 'None selected'
                : selectedKeys.size === series.length
                  ? 'All'
                  : `${selectedKeys.size} selected`}
            </span>
            <ChevronDown
              size={16}
              className={`dashboard-timeseries-dropdown-chevron ${dropdownOpen ? 'open' : ''}`}
              aria-hidden
            />
          </button>
          {dropdownOpen && (
            <div className="dashboard-timeseries-dropdown-panel" role="listbox">
              <div className="dashboard-timeseries-dropdown-panel-header">
                <span className="dashboard-timeseries-dropdown-panel-title">{dropdownLabel}</span>
              </div>
              <div className="dashboard-timeseries-dropdown-search-wrap">
                <input
                  type="search"
                  className="dashboard-timeseries-dropdown-search"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search"
                  autoFocus
                />
              </div>
              <div className="dashboard-timeseries-dropdown-actions">
                <button type="button" className="dashboard-timeseries-dropdown-action" onClick={handleSelectAll}>
                  Select all
                </button>
                <button type="button" className="dashboard-timeseries-dropdown-action" onClick={handleSelectNone}>
                  Select none
                </button>
              </div>
              <ul className="dashboard-timeseries-dropdown-list">
                {filteredNames.map((name) => {
                  const item = series.find((s) => s.name === name)
                  const color = item?.color ?? '#888'
                  const checked = selectedKeys.has(name)
                  return (
                    <li key={name}>
                      <label className="dashboard-timeseries-dropdown-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(name)}
                          aria-label={name}
                        />
                        <span className="dashboard-timeseries-dropdown-color" style={{ backgroundColor: color }} />
                        <span className="dashboard-timeseries-dropdown-name" title={name}>
                          {name}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {filteredNames.length === 0 && (
                <p className="dashboard-timeseries-dropdown-empty">No matches</p>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
      {loading ? (
        <div className="dashboard-timeseries-loading" aria-busy="true">
          <span className="dashboard-workflows-loading-spinner" />
          <span>Loading…</span>
        </div>
      ) : dates.length === 0 ? (
        <p className="dashboard-timeseries-empty">No data in range.</p>
      ) : (
        <>
          <div
            className="dashboard-timeseries-chart-wrap"
            ref={chartWrapRef}
          >
            <svg
              ref={svgRef}
              className="dashboard-timeseries-chart dashboard-timeseries-chart--hover"
              viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ width: '100%', height: CHART_HEIGHT }}
              aria-label={`Time series: ${title}`}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
            >
              <rect
                x={CHART_PADDING.left}
                y={CHART_PADDING.top}
                width={innerWidth}
                height={innerHeight}
                fill="transparent"
                aria-hidden
              />
              <text
                x={CHART_PADDING.left - 8}
                y={CHART_PADDING.top + innerHeight / 2}
                className="dashboard-timeseries-chart-y-label"
                textAnchor="middle"
                transform={`rotate(-90, ${CHART_PADDING.left - 8}, ${CHART_PADDING.top + innerHeight / 2})`}
              >
                Count
              </text>
              {yTickValues.map((tickVal, i) => {
                const y = scaleY(tickVal)
                return (
                  <g key={tickVal}>
                    <line
                      x1={CHART_PADDING.left}
                      y1={y}
                      x2={CHART_PADDING.left + innerWidth}
                      y2={y}
                      className="dashboard-timeseries-chart-gridline"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                    <text
                      x={CHART_PADDING.left - 6}
                      y={y + 4}
                      className="dashboard-timeseries-chart-y-tick"
                      textAnchor="end"
                    >
                      {tickVal}
                    </text>
                  </g>
                )
              })}
              {visibleSeries.map((s) => {
                const points = s.values
                  .map((v, i) => `${scaleX(i)},${scaleY(v)}`)
                  .join(' ')
                return (
                  <polyline
                    key={s.name}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    points={points}
                  />
                )
              })}
              {hoveredIndex != null && (
                <>
                  <line
                    x1={scaleX(hoveredIndex)}
                    y1={CHART_PADDING.top}
                    x2={scaleX(hoveredIndex)}
                    y2={CHART_PADDING.top + innerHeight}
                    className="dashboard-timeseries-chart-hover-line"
                    strokeWidth={1}
                  />
                  {visibleSeries.map((s) => {
                    const v = s.values[hoveredIndex] ?? 0
                    return (
                      <circle
                        key={s.name}
                        cx={scaleX(hoveredIndex)}
                        cy={scaleY(v)}
                        r={4}
                        fill={s.color}
                        stroke="var(--bg-secondary)"
                        strokeWidth={2}
                        className="dashboard-timeseries-chart-hover-dot"
                      />
                    )
                  })}
                </>
              )}
              {dates.map((d, i) => {
                const step = dates.length <= 12 ? 1 : Math.ceil(dates.length / 12)
                if (i % step !== 0 && i !== dates.length - 1) return null
                return (
                  <text
                    key={d}
                    x={scaleX(i)}
                    y={CHART_HEIGHT - 8}
                    className="dashboard-timeseries-chart-label"
                    textAnchor="middle"
                  >
                    {d.slice(5)}
                  </text>
                )
              })}
            </svg>
            {tooltipPos != null && hoveredDate && (
              <div
                className="dashboard-timeseries-tooltip"
                style={{
                  left: tooltipPos.x + 12,
                  top: tooltipPos.y + 12,
                }}
                role="tooltip"
              >
                <div className="dashboard-timeseries-tooltip-date">
                  {hoveredDate}
                </div>
                <ul className="dashboard-timeseries-tooltip-list">
                  {hoveredValues.map(({ name, color, value }) => (
                    <li key={name} className="dashboard-timeseries-tooltip-row">
                      <span
                        className="dashboard-timeseries-tooltip-color"
                        style={{ backgroundColor: color }}
                      />
                      <span className="dashboard-timeseries-tooltip-name">{name}</span>
                      <span className="dashboard-timeseries-tooltip-value">{value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {visibleSeries.length > 0 && (
            <div className="dashboard-timeseries-legend" role="list">
              {visibleSeries.map((s) => (
                <div key={s.name} className="dashboard-timeseries-legend-item" title={s.name}>
                  <span
                    className="dashboard-timeseries-legend-color"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="dashboard-timeseries-legend-name">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
