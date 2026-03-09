import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { TimeSeriesItem } from '@/features/dashboard/useTimeViewSeries'

export const CHART_HEIGHT = 260
export const CHART_PADDING = { top: 12, right: 12, bottom: 32, left: 52 }
const Y_AXIS_TICKS = 5
const DOWNLOAD_LEGEND_HEIGHT = 44
const DOWNLOAD_LEGEND_ITEM_GAP = 14
const DOWNLOAD_LEGEND_LABEL_GAP = 6

interface UseTimeSeriesPanelOptions {
  title: string
  series: TimeSeriesItem[]
  dates: string[]
  selectedKeys: Set<string>
  onSelectionChange: (selected: Set<string>) => void
}

export function useTimeSeriesPanel({ title, series, dates, selectedKeys, onSelectionChange }: UseTimeSeriesPanelOptions) {
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

  const handleSelectNone = useCallback(() => onSelectionChange(new Set()), [onSelectionChange])

  const toggleOne = useCallback((name: string) => {
    const next = new Set(selectedKeys)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onSelectionChange(next)
  }, [selectedKeys, onSelectionChange])

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
    for (const s of visibleSeries) for (const v of s.values) if (v > m) m = v
    return m || 1
  }, [visibleSeries])

  const chartWidth = Math.max(600, (dates.length * 56) | 0)
  const innerWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

  const scaleY = (v: number): number => CHART_PADDING.top + innerHeight - (v / maxVal) * innerHeight
  const scaleX = (i: number): number => CHART_PADDING.left + (i / Math.max(1, dates.length - 1)) * innerWidth

  const yTickValues = useMemo((): number[] => {
    const out: number[] = []
    for (let i = 0; i <= Y_AXIS_TICKS; i++) out.push(Math.round((maxVal * i) / Y_AXIS_TICKS))
    return out
  }, [maxVal])

  const handleChartMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || dates.length === 0) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgPt = pt.matrixTransform(ctm.inverse())
    if (svgPt.x < CHART_PADDING.left || svgPt.x > CHART_PADDING.left + innerWidth) {
      setHoveredIndex(null); setTooltipPos(null); return
    }
    const idx = Math.round(((svgPt.x - CHART_PADDING.left) * (dates.length - 1)) / innerWidth)
    setHoveredIndex(Math.max(0, Math.min(idx, dates.length - 1)))
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [dates.length, innerWidth])

  const handleChartMouseLeave = useCallback(() => { setHoveredIndex(null); setTooltipPos(null) }, [])

  const hoveredDate = hoveredIndex != null ? dates[hoveredIndex] : null
  const hoveredValues = hoveredIndex != null
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
    const getVar = (v: string): string => getComputedStyle(root).getPropertyValue(v).trim() || '#888'
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
      if (x + approxWidth > maxX && x > CHART_PADDING.left) { x = CHART_PADDING.left; row += 1 }
      const legendY = CHART_HEIGHT + 18 + row * rowHeight
      const rectEl = document.createElementNS(ns, 'rect')
      rectEl.setAttribute('x', String(x)); rectEl.setAttribute('y', String(legendY - colorSize + 2))
      rectEl.setAttribute('width', String(colorSize)); rectEl.setAttribute('height', String(colorSize))
      rectEl.setAttribute('fill', s.color); rectEl.setAttribute('rx', '2')
      legendG.appendChild(rectEl)
      const textEl = document.createElementNS(ns, 'text')
      textEl.setAttribute('x', String(x + colorSize + DOWNLOAD_LEGEND_LABEL_GAP))
      textEl.setAttribute('y', String(legendY + 1)); textEl.setAttribute('fill', textColor)
      textEl.setAttribute('font-size', String(fontSize)); textEl.setAttribute('font-family', 'system-ui, sans-serif')
      textEl.textContent = s.name
      legendG.appendChild(textEl)
      x += approxWidth + DOWNLOAD_LEGEND_ITEM_GAP
    }
    const totalHeight = CHART_HEIGHT + DOWNLOAD_LEGEND_HEIGHT + row * 20
    clone.setAttribute('width', String(chartWidth)); clone.setAttribute('height', String(totalHeight))
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
    const str = new XMLSerializer().serializeToString(clone)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = chartWidth; canvas.height = totalHeight
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
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str)
  }, [dates.length, chartWidth, title, visibleSeries])

  return {
    dropdownOpen, setDropdownOpen, search, setSearch,
    hoveredIndex, tooltipPos, dropdownRef, svgRef, chartWrapRef,
    filteredNames, handleSelectAll, handleSelectNone, toggleOne,
    visibleSeries, maxVal, chartWidth, innerWidth, innerHeight,
    scaleY, scaleX, yTickValues,
    handleChartMouseMove, handleChartMouseLeave, handleDownload,
    hoveredDate, hoveredValues,
  }
}
