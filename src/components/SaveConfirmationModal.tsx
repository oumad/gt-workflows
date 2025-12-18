import { useState, useEffect } from 'react'
import { X, Save, AlertTriangle, RefreshCw, FileDiff } from 'lucide-react'
import { WorkflowParams } from '../types'
import './SaveConfirmationModal.css'

interface SaveConfirmationModalProps {
  originalParams: WorkflowParams | null
  currentParams: WorkflowParams | null
  hasExternalChanges: boolean
  externalParams: WorkflowParams | null
  onSave: () => void
  onCancel: () => void
  onReload: () => void
  onOverwrite: () => void
}

interface ChangeItem {
  path: string
  oldValue: any
  newValue: any
  type: 'added' | 'removed' | 'modified'
}

export default function SaveConfirmationModal({
  originalParams,
  currentParams,
  hasExternalChanges,
  externalParams,
  onSave,
  onCancel,
  onReload,
  onOverwrite,
}: SaveConfirmationModalProps) {
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    if (originalParams && currentParams) {
      const detectedChanges = detectChanges(originalParams, currentParams)
      setChanges(detectedChanges)
    }
  }, [originalParams, currentParams])

  const detectChanges = (old: any, current: any, path = ''): ChangeItem[] => {
    const changes: ChangeItem[] = []
    
    if (old === null || old === undefined) {
      if (current !== null && current !== undefined) {
        changes.push({
          path: path || 'root',
          oldValue: null,
          newValue: current,
          type: 'added'
        })
      }
      return changes
    }
    
    if (current === null || current === undefined) {
      changes.push({
        path: path || 'root',
        oldValue: old,
        newValue: null,
        type: 'removed'
      })
      return changes
    }

    // Handle arrays
    if (Array.isArray(old) || Array.isArray(current)) {
      const oldArr = Array.isArray(old) ? old : []
      const currentArr = Array.isArray(current) ? current : []
      
      if (JSON.stringify(oldArr) !== JSON.stringify(currentArr)) {
        changes.push({
          path: path || 'root',
          oldValue: oldArr,
          newValue: currentArr,
          type: 'modified'
        })
      }
      return changes
    }

    // Handle objects
    if (typeof old === 'object' && typeof current === 'object') {
      const allKeys = new Set([...Object.keys(old), ...Object.keys(current)])
      
      for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key
        const oldVal = old[key]
        const currentVal = current[key]
        
        if (!(key in old)) {
          changes.push({
            path: newPath,
            oldValue: undefined,
            newValue: currentVal,
            type: 'added'
          })
        } else if (!(key in current)) {
          changes.push({
            path: newPath,
            oldValue: oldVal,
            newValue: undefined,
            type: 'removed'
          })
        } else if (typeof oldVal === 'object' && typeof currentVal === 'object' && 
                   oldVal !== null && currentVal !== null && 
                   !Array.isArray(oldVal) && !Array.isArray(currentVal)) {
          // Recursively check nested objects
          changes.push(...detectChanges(oldVal, currentVal, newPath))
        } else if (JSON.stringify(oldVal) !== JSON.stringify(currentVal)) {
          changes.push({
            path: newPath,
            oldValue: oldVal,
            newValue: currentVal,
            type: 'modified'
          })
        }
      }
    } else if (old !== current) {
      changes.push({
        path: path || 'root',
        oldValue: old,
        newValue: current,
        type: 'modified'
      })
    }

    return changes
  }

  const formatValue = (value: any): string => {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return String(value)
  }

  const getChangeTypeColor = (type: ChangeItem['type']) => {
    switch (type) {
      case 'added':
        return 'var(--success)'
      case 'removed':
        return 'var(--error)'
      case 'modified':
        return 'var(--warning)'
      default:
        return 'var(--text-primary)'
    }
  }

  const getChangeTypeLabel = (type: ChangeItem['type']) => {
    switch (type) {
      case 'added':
        return 'Added'
      case 'removed':
        return 'Removed'
      case 'modified':
        return 'Modified'
      default:
        return 'Changed'
    }
  }

  if (!originalParams || !currentParams) {
    return null
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content save-confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>
              <Save size={20} />
              Confirm Save
            </h2>
            {hasExternalChanges && (
              <div className="conflict-warning">
                <AlertTriangle size={16} />
                <span>Warning: params.json has been modified externally!</span>
              </div>
            )}
          </div>
          <button onClick={onCancel} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {hasExternalChanges && (
            <div className="conflict-banner">
              <AlertTriangle size={20} />
              <div>
                <strong>External Changes Detected</strong>
                <p>
                  The params.json file has been modified outside of this UI. 
                  Saving now will overwrite those external changes.
                </p>
                <div className="conflict-actions">
                  <button onClick={onReload} className="btn btn-secondary">
                    <RefreshCw size={16} />
                    Reload & Discard My Changes
                  </button>
                  <button onClick={onOverwrite} className="btn btn-warning">
                    <Save size={16} />
                    Overwrite External Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {changes.length === 0 ? (
            <div className="no-changes">
              <p>No changes detected. The workflow is already up to date.</p>
            </div>
          ) : (
            <>
              <div className="changes-summary">
                <p>
                  <strong>{changes.length}</strong> change{changes.length !== 1 ? 's' : ''} detected:
                </p>
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className="btn btn-secondary btn-small"
                >
                  <FileDiff size={14} />
                  {showDiff ? 'Hide' : 'Show'} Full Diff
                </button>
              </div>

              <div className="changes-list">
                {changes.slice(0, showDiff ? undefined : 10).map((change, index) => (
                  <div key={index} className="change-item">
                    <div className="change-header">
                      <span
                        className="change-type-badge"
                        style={{ backgroundColor: getChangeTypeColor(change.type) }}
                      >
                        {getChangeTypeLabel(change.type)}
                      </span>
                      <span className="change-path">{change.path}</span>
                    </div>
                    {change.type === 'removed' && (
                      <div className="change-value removed">
                        <strong>Removed:</strong>
                        <pre>{formatValue(change.oldValue)}</pre>
                      </div>
                    )}
                    {change.type === 'added' && (
                      <div className="change-value added">
                        <strong>Added:</strong>
                        <pre>{formatValue(change.newValue)}</pre>
                      </div>
                    )}
                    {change.type === 'modified' && (
                      <>
                        <div className="change-value removed">
                          <strong>Old:</strong>
                          <pre>{formatValue(change.oldValue)}</pre>
                        </div>
                        <div className="change-value added">
                          <strong>New:</strong>
                          <pre>{formatValue(change.newValue)}</pre>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {!showDiff && changes.length > 10 && (
                  <div className="more-changes">
                    <p>... and {changes.length - 10} more changes</p>
                    <button
                      onClick={() => setShowDiff(true)}
                      className="btn btn-secondary btn-small"
                    >
                      Show All Changes
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          {hasExternalChanges ? (
            <button onClick={onOverwrite} className="btn btn-warning">
              <Save size={16} />
              Overwrite & Save
            </button>
          ) : changes.length === 0 ? (
            <button onClick={onSave} className="btn btn-primary">
              <Save size={16} />
              Apply (No Changes)
            </button>
          ) : (
            <button onClick={onSave} className="btn btn-primary">
              <Save size={16} />
              Apply Changes
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

