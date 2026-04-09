import React, { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import type { Annotation } from '@/features/dashboard/useAnnotations'
import { ANNOTATION_COLORS } from '@/features/dashboard/useAnnotations'

export interface AnnotationsPanelProps {
  annotations: Annotation[]
  /** Current date range (YYYY-MM-DD) to filter display */
  visibleDates: string[]
  onAdd: (date: string, text: string, color?: string) => void
  onRemove: (id: string) => void
}

export function AnnotationsPanel({ annotations, visibleDates, onAdd, onRemove }: AnnotationsPanelProps): React.ReactElement {
  const [adding, setAdding] = useState(false)
  const [newDate, setNewDate] = useState(() => visibleDates[0] ?? '')
  const [newText, setNewText] = useState('')
  const [newColor, setNewColor] = useState<string>(ANNOTATION_COLORS[0])

  // Keep default date in sync with visible range
  useEffect(() => {
    if (visibleDates.length > 0) setNewDate(visibleDates[0])
  }, [visibleDates])

  const dateSet = new Set(visibleDates)
  const visible = annotations.filter((a) => dateSet.has(a.date)).sort((a, b) => a.date.localeCompare(b.date))

  const handleAdd = () => {
    if (!newDate || !newText.trim()) return
    onAdd(newDate, newText.trim(), newColor)
    setNewText('')
    setAdding(false)
  }

  return (
    <section className="dashboard-annotations-panel">
      <div className="dashboard-annotations-header">
        <h2 className="dashboard-timeseries-title">Annotations</h2>
        <button
          type="button"
          className="dashboard-annotations-add-btn"
          onClick={() => setAdding(!adding)}
          title="Add annotation"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {adding && (
        <div className="dashboard-annotations-form">
          <input
            type="date"
            className="dashboard-annotations-input"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            aria-label="Date"
          />
          <input
            type="text"
            className="dashboard-annotations-input dashboard-annotations-input--text"
            placeholder="e.g. Deployed new model"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            aria-label="Description"
            autoFocus
          />
          <div className="dashboard-annotations-colors">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`dashboard-annotations-color-btn${newColor === c ? ' dashboard-annotations-color-btn--active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setNewColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          <button type="button" className="dashboard-annotations-save-btn" onClick={handleAdd} disabled={!newDate || !newText.trim()}>
            Save
          </button>
        </div>
      )}

      {visible.length === 0 && !adding ? (
        <p className="dashboard-annotations-empty">No annotations in this range.</p>
      ) : (
        <ul className="dashboard-annotations-list">
          {visible.map((a) => (
            <li key={a.id} className="dashboard-annotations-item">
              <span className="dashboard-annotations-dot" style={{ backgroundColor: a.color }} />
              <span className="dashboard-annotations-date">{a.date.slice(5)}</span>
              <span className="dashboard-annotations-text">{a.text}</span>
              <button
                type="button"
                className="dashboard-annotations-remove-btn"
                onClick={() => onRemove(a.id)}
                title="Remove"
                aria-label={`Remove annotation: ${a.text}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
