import { useState, useEffect } from 'react'
import { X, RotateCcw, AlertTriangle, FileDiff } from 'lucide-react'
import type { WorkflowParams } from '@/types'
import {
  detectParamsChanges,
  formatValueForDisplay,
  type ParamsChangeItem,
  type ParamsChangeType,
} from '@/utils/paramsDiff'
import './SaveConfirmationModal.css'

interface ResetConfirmationModalProps {
  currentParams: WorkflowParams | null
  fileParams: WorkflowParams | null
  hasUnsavedChanges: boolean
  onReset: () => void
  onCancel: () => void
}

export default function ResetConfirmationModal({
  currentParams,
  fileParams,
  hasUnsavedChanges,
  onReset,
  onCancel,
}: ResetConfirmationModalProps) {
  const [changes, setChanges] = useState<ParamsChangeItem[]>([])
  const [showDiff, setShowDiff] = useState(false)
  const [hasMismatch, setHasMismatch] = useState(false)

  useEffect(() => {
    if (currentParams && fileParams) {
      const detected = detectParamsChanges(currentParams, fileParams)
      setChanges(detected)
      setHasMismatch(detected.length > 0)
    }
  }, [currentParams, fileParams])

  const getChangeTypeColor = (type: ParamsChangeType) => {
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

  const getChangeTypeLabel = (type: ParamsChangeType) => {
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
                {changes.slice(0, showDiff ? undefined : 10).map((change: ParamsChangeItem, index: number) => (
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
                        <pre>{formatValueForDisplay(change.oldValue)}</pre>
                      </div>
                    )}
                    {change.type === 'added' && (
                      <div className="change-value added">
                        <strong>File has:</strong>
                        <pre>{formatValueForDisplay(change.newValue)}</pre>
                      </div>
                    )}
                    {change.type === 'modified' && (
                      <>
                        <div className="change-value removed">
                          <strong>Current view:</strong>
                          <pre>{formatValueForDisplay(change.oldValue)}</pre>
                        </div>
                        <div className="change-value added">
                          <strong>File has:</strong>
                          <pre>{formatValueForDisplay(change.newValue)}</pre>
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

