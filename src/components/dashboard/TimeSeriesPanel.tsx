import React from 'react'
import { ChevronDown, Download } from 'lucide-react'
import type { TimeSeriesItem } from '@/features/dashboard/useTimeViewSeries'
import { useTimeSeriesPanel, CHART_HEIGHT, CHART_PADDING } from './useTimeSeriesPanel'
import './Dashboard.css'

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
  title, series, dates, selectedKeys, onSelectionChange,
  dropdownLabel = 'Filter', loading = false,
}: TimeSeriesPanelProps): React.ReactElement {
  const p = useTimeSeriesPanel({ title, series, dates, selectedKeys, onSelectionChange })

  return (
    <section className="dashboard-timeseries-panel">
      <div className="dashboard-timeseries-header">
        <h2 className="dashboard-timeseries-title">{title}</h2>
        <div className="dashboard-timeseries-header-actions">
          <button
            type="button"
            className="dashboard-timeseries-download-btn"
            onClick={p.handleDownload}
            disabled={dates.length === 0}
            title="Download chart as PNG"
            aria-label="Download chart as PNG"
          >
            <Download size={16} /> Download
          </button>
          <div className="dashboard-timeseries-dropdown-wrap" ref={p.dropdownRef}>
            <button
              type="button"
              className="dashboard-timeseries-dropdown-btn"
              onClick={() => p.setDropdownOpen((o) => !o)}
              aria-expanded={p.dropdownOpen}
              aria-haspopup="listbox"
              title={dropdownLabel}
            >
              <span className="dashboard-timeseries-dropdown-btn-text">
                {selectedKeys.size === 0 ? 'None selected' : selectedKeys.size === series.length ? 'All' : `${selectedKeys.size} selected`}
              </span>
              <ChevronDown size={16} className={`dashboard-timeseries-dropdown-chevron ${p.dropdownOpen ? 'open' : ''}`} aria-hidden />
            </button>
            {p.dropdownOpen && (
              <div className="dashboard-timeseries-dropdown-panel" role="listbox">
                <div className="dashboard-timeseries-dropdown-panel-header">
                  <span className="dashboard-timeseries-dropdown-panel-title">{dropdownLabel}</span>
                </div>
                <div className="dashboard-timeseries-dropdown-search-wrap">
                  <input
                    type="search"
                    className="dashboard-timeseries-dropdown-search"
                    placeholder="Search…"
                    value={p.search}
                    onChange={(e) => p.setSearch(e.target.value)}
                    aria-label="Search"
                    autoFocus
                  />
                </div>
                <div className="dashboard-timeseries-dropdown-actions">
                  <button type="button" className="dashboard-timeseries-dropdown-action" onClick={p.handleSelectAll}>Select all</button>
                  <button type="button" className="dashboard-timeseries-dropdown-action" onClick={p.handleSelectNone}>Select none</button>
                </div>
                <ul className="dashboard-timeseries-dropdown-list">
                  {p.filteredNames.map((name) => {
                    const item = series.find((s) => s.name === name)
                    return (
                      <li key={name}>
                        <label className="dashboard-timeseries-dropdown-item">
                          <input type="checkbox" checked={selectedKeys.has(name)} onChange={() => p.toggleOne(name)} aria-label={name} />
                          <span className="dashboard-timeseries-dropdown-color" style={{ backgroundColor: item?.color ?? '#888' }} />
                          <span className="dashboard-timeseries-dropdown-name" title={name}>{name}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {p.filteredNames.length === 0 && <p className="dashboard-timeseries-dropdown-empty">No matches</p>}
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
          <div className="dashboard-timeseries-chart-wrap" ref={p.chartWrapRef}>
            <svg
              ref={p.svgRef}
              className="dashboard-timeseries-chart dashboard-timeseries-chart--hover"
              viewBox={`0 0 ${p.chartWidth} ${CHART_HEIGHT}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ width: '100%', height: CHART_HEIGHT }}
              aria-label={`Time series: ${title}`}
              onMouseMove={p.handleChartMouseMove}
              onMouseLeave={p.handleChartMouseLeave}
            >
              <rect x={CHART_PADDING.left} y={CHART_PADDING.top} width={p.innerWidth} height={p.innerHeight} fill="transparent" aria-hidden />
              <text
                x={CHART_PADDING.left - 8} y={CHART_PADDING.top + p.innerHeight / 2}
                className="dashboard-timeseries-chart-y-label" textAnchor="middle"
                transform={`rotate(-90, ${CHART_PADDING.left - 8}, ${CHART_PADDING.top + p.innerHeight / 2})`}
              >Count</text>
              {p.yTickValues.map((tickVal) => {
                const y = p.scaleY(tickVal)
                return (
                  <g key={tickVal}>
                    <line x1={CHART_PADDING.left} y1={y} x2={CHART_PADDING.left + p.innerWidth} y2={y} className="dashboard-timeseries-chart-gridline" strokeWidth={1} strokeDasharray="2 2" />
                    <text x={CHART_PADDING.left - 6} y={y + 4} className="dashboard-timeseries-chart-y-tick" textAnchor="end">{tickVal}</text>
                  </g>
                )
              })}
              {p.visibleSeries.map((s) => (
                <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} points={s.values.map((v, i) => `${p.scaleX(i)},${p.scaleY(v)}`).join(' ')} />
              ))}
              {p.hoveredIndex != null && (
                <>
                  <line x1={p.scaleX(p.hoveredIndex)} y1={CHART_PADDING.top} x2={p.scaleX(p.hoveredIndex)} y2={CHART_PADDING.top + p.innerHeight} className="dashboard-timeseries-chart-hover-line" strokeWidth={1} />
                  {p.visibleSeries.map((s) => (
                    <circle key={s.name} cx={p.scaleX(p.hoveredIndex!)} cy={p.scaleY(s.values[p.hoveredIndex!] ?? 0)} r={4} fill={s.color} stroke="var(--bg-secondary)" strokeWidth={2} className="dashboard-timeseries-chart-hover-dot" />
                  ))}
                </>
              )}
              {dates.map((d, i) => {
                const step = dates.length <= 12 ? 1 : Math.ceil(dates.length / 12)
                if (i % step !== 0 && i !== dates.length - 1) return null
                return <text key={d} x={p.scaleX(i)} y={CHART_HEIGHT - 8} className="dashboard-timeseries-chart-label" textAnchor="middle">{d.slice(5)}</text>
              })}
            </svg>
            {p.tooltipPos != null && p.hoveredDate && (
              <div className="dashboard-timeseries-tooltip" style={{ left: p.tooltipPos.x + 12, top: p.tooltipPos.y + 12 }} role="tooltip">
                <div className="dashboard-timeseries-tooltip-date">{p.hoveredDate}</div>
                <ul className="dashboard-timeseries-tooltip-list">
                  {p.hoveredValues.map(({ name, color, value }) => (
                    <li key={name} className="dashboard-timeseries-tooltip-row">
                      <span className="dashboard-timeseries-tooltip-color" style={{ backgroundColor: color }} />
                      <span className="dashboard-timeseries-tooltip-name">{name}</span>
                      <span className="dashboard-timeseries-tooltip-value">{value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {p.visibleSeries.length > 0 && (
            <div className="dashboard-timeseries-legend" role="list">
              {p.visibleSeries.map((s) => (
                <div key={s.name} className="dashboard-timeseries-legend-item" title={s.name}>
                  <span className="dashboard-timeseries-legend-color" style={{ backgroundColor: s.color }} />
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
