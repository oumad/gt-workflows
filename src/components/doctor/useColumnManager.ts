import { useState, useRef, useCallback } from 'react'

// ── Column system ─────────────────────────────────────────────────────────────

export const TABLE_HEIGHT_KEY = 'doctor-failed-table-height'
export const COL_ORDER_KEY = 'doctor-failed-col-order'
export const DEFAULT_TABLE_HEIGHT = 400
const MIN_TABLE_HEIGHT = 150
const MAX_TABLE_HEIGHT = 1200

export type ColumnKey = 'id' | 'workflow' | 'server' | 'error' | 'user' | 'time' | 'duration'

export const DEFAULT_COLUMNS: ColumnKey[] = ['id', 'workflow', 'server', 'error', 'user', 'duration', 'time']

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  id: 'Job',
  workflow: 'Workflow',
  server: 'Server',
  error: 'Error',
  user: 'User',
  time: 'Failed at',
  duration: 'Ran for',
}

export function loadTableHeight(): number {
  try {
    const v = Number(localStorage.getItem(TABLE_HEIGHT_KEY))
    if (v >= MIN_TABLE_HEIGHT && v <= MAX_TABLE_HEIGHT) return v
  } catch { /* ignore */ }
  return DEFAULT_TABLE_HEIGHT
}

export function saveTableHeight(h: number) {
  try { localStorage.setItem(TABLE_HEIGHT_KEY, String(h)) } catch { /* ignore */ }
}

export function loadColumnOrder(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed) && parsed.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((k) => parsed.includes(k))) {
        return parsed as ColumnKey[]
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_COLUMNS
}

export function saveColumnOrder(order: ColumnKey[]) {
  try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(order)) } catch { /* ignore */ }
}

export function useColumnManager() {
  const [tableHeight, setTableHeight] = useState(loadTableHeight)
  const [colOrder, setColOrder] = useState<ColumnKey[]>(loadColumnOrder)
  const [colWidths, setColWidths] = useState<Partial<Record<ColumnKey, number>>>({})
  const dragColRef = useRef<ColumnKey | null>(null)

  const handleColResizeStart = useCallback((e: React.MouseEvent, col: ColumnKey) => {
    e.preventDefault()
    e.stopPropagation()
    const th = (e.target as HTMLElement).closest('th')
    if (!th) return
    const startX = e.clientX
    const startW = th.offsetWidth
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(60, startW + (ev.clientX - startX))
      setColWidths((prev) => ({ ...prev, [col]: next }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleTableResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = tableHeight
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_TABLE_HEIGHT, Math.min(MAX_TABLE_HEIGHT, startH + (ev.clientY - startY)))
      setTableHeight(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setTableHeight((h) => { saveTableHeight(h); return h })
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [tableHeight])

  const handleDragStart = useCallback((col: ColumnKey) => {
    dragColRef.current = col
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((targetCol: ColumnKey) => {
    const source = dragColRef.current
    if (!source || source === targetCol) return
    setColOrder((prev) => {
      const next = [...prev]
      const srcIdx = next.indexOf(source)
      const tgtIdx = next.indexOf(targetCol)
      next.splice(srcIdx, 1)
      next.splice(tgtIdx, 0, source)
      saveColumnOrder(next)
      return next
    })
    dragColRef.current = null
  }, [])

  return {
    tableHeight,
    setTableHeight,
    colOrder,
    colWidths,
    handleTableResizeStart,
    handleColResizeStart,
    handleDragStart,
    handleDragOver,
    handleDrop,
  }
}
