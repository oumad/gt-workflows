import { useState, useEffect } from 'react'
import { X, RotateCcw, AlertTriangle, FileDiff } from 'lucide-react'
import { WorkflowParams } from '../types'
import './SaveConfirmationModal.css'

interface ResetConfirmationModalProps {
  currentParams: WorkflowParams | null
  fileParams: WorkflowParams | null
  hasUnsavedChanges: boolean
  onReset: () => void
  onCancel: () => void
}

interface ChangeItem {
  path: string
  oldValue: any
  newValue: any
  type: 'added' | 'removed' | 'modified'
}

export default function ResetConfirmationModal({
  currentParams,
  fileParams,
  hasUnsavedChanges,
  onReset,
  onCancel,
}: ResetConfirmationModalProps) {
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const [showDiff, setShowDiff] = useState(false)
  const [hasMismatch, setHasMismatch] = useState(false)

  useEffect(() => {
    if (currentParams && fileParams) {
      const detectedChanges = detectChanges(currentParams, fileParams)
      setChanges(detectedChanges)
      setHasMismatch(detectedChanges.length > 0)
    }
  }, [currentParams, fileParams])

  const detectChanges = (current: any, file: any, path = ''): ChangeItem[] => {
    const changes: ChangeItem[] = []
    
    if (current === null || current === undefined) {
      if (file !== null && file !== undefined) {
        changes.push({
          path: path || 'root',
          oldValue: null,
          newValue: file,
          type: 'added'
        })
      }
      return changes
    }
    
    if (file === null || file === undefined) {
      changes.push({
        path: path || 'root',
        oldValue: current,
        newValue: null,
        type: 'removed'
      })
      return changes
    }

    // Handle arrays
    if (Array.isArray(current) || Array.isArray(file)) {
      const currentArr = Array.isArray(current) ? current : []
      const fileArr = Array.isArray(file) ? file : []
      
      if (JSON.stringify(currentArr) !== JSON.stringify(fileArr)) {
        changes.push({
          path: path || 'root',
          oldValue: currentArr,
          newValue: fileArr,
          type: 'modified'
        })
      }
      return changes
    }

    // Handle objects
    if (typeof current === 'object' && typeof file === 'object') {
      const allKeys = new Set([...Object.keys(current), ...Object.keys(file)])
      
      for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key
        const currentVal = current[key]
        const fileVal = file[key]
        
        if (!(key in current)) {
          changes.push({
            path: newPath,
            oldValue: undefined,
            newValue: fileVal,
            type: 'added'
          })
        } else if (!(key in file)) {
          changes.push({
            path: newPath,
            oldValue: currentVal,
            newValue: undefined,
            type: 'removed'
          })
        } else {
          const nestedChanges = detectChanges(currentVal, fileVal, newPath)
          changes.push(...nestedChanges)
        }
      }
      return changes
    }

    // Primitive values
    if (JSON.stringify(current) !== JSON.stringify(file)) {
      changes.push({
        path: path || 'root',
        oldValue: current,
        newValue: file,
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
        return 'Will be added'
      case 'removed':
        return 'Will be removed'
      case 'modified':
        return 'Will be changed'
      default:
        return 'Changed'
    }
  }

  if (!currentParams || !fileParams) {
    return null
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content save-confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>
              <RotateCcw size={20} />
              Confirm Reset
            </h2>
            {hasMismatch && (
              <div className="conflict-warning">
                <AlertTriangle size={16} />
                <span>Warning: Your current view differs from the saved file!</span>
              </div>
            )}
          </div>
          <button onClick={onCancel} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {hasMismatch && (
            <div className="conflict-banner">
              <AlertTriangle size={20} />
              <div>
                <strong>File Mismatch Detected</strong>
                <p>
                  The params.json file on disk differs from what you're currently viewing. 
                  Resetting will reload the file and discard your current view.
                </p>
              </div>
            </div>
          )}

          {hasUnsavedChanges && !hasMismatch && (
            <div className="conflict-banner" style={{ borderColor: 'var(--warning)' }}>
              <AlertTriangle size={20} />
              <div>
                <strong>Unsaved Changes</strong>
                <p>
                  You have unsaved changes that will be discarded when resetting.
                </p>
              </div>
            </div>
          )}

          {changes.length === 0 ? (
            <div className="no-changes">
              <p>No differences detected. Current view matches the saved file.</p>
            </div>
          ) : (
            <>
              <div className="changes-summary">
                <p>
                  <strong>{changes.length}</strong> difference{changes.length !== 1 ? 's' : ''} between current view and file:
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
                        <strong>Current view:</strong>
                        <pre>{formatValue(change.oldValue)}</pre>
                      </div>
                    )}
                    {change.type === 'added' && (
                      <div className="change-value added">
                        <strong>File has:</strong>
                        <pre>{formatValue(change.newValue)}</pre>
                      </div>
                    )}
                    {change.type === 'modified' && (
                      <>
                        <div className="change-value removed">
                          <strong>Current view:</strong>
                          <pre>{formatValue(change.oldValue)}</pre>
                        </div>
                        <div className="change-value added">
                          <strong>File has:</strong>
                          <pre>{formatValue(change.newValue)}</pre>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {!showDiff && changes.length > 10 && (
                  <div className="more-changes">
                    <p>... and {changes.length - 10} more differences</p>
                    <button
                      onClick={() => setShowDiff(true)}
                      className="btn btn-secondary btn-small"
                    >
                      Show All Differences
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
          <button onClick={onReset} className="btn btn-warning">
            <RotateCcw size={16} />
            Reset & Reload File
          </button>
        </div>
      </div>
    </div>
  )
}

