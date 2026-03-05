import { useState, useEffect } from 'react'
import { X, Save, AlertTriangle, RefreshCw, FileDiff } from 'lucide-react'
import type { WorkflowParams } from '@/types'
import {
  detectParamsChanges,
  formatValueForDisplay,
  type ParamsChangeItem,
  type ParamsChangeType,
} from '@/utils/paramsDiff'
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

export default function SaveConfirmationModal({
  originalParams,
  currentParams,
  hasExternalChanges,
  externalParams: _externalParams, // Currently unused but kept for API consistency
  onSave,
  onCancel,
  onReload,
  onOverwrite,
}: SaveConfirmationModalProps) {
  const [changes, setChanges] = useState<ParamsChangeItem[]>([])
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    if (originalParams && currentParams) {
      setChanges(detectParamsChanges(originalParams, currentParams))
    }
  }, [originalParams, currentParams])

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
                        <strong>Removed:</strong>
                        <pre>{formatValueForDisplay(change.oldValue)}</pre>
                      </div>
                    )}
                    {change.type === 'added' && (
                      <div className="change-value added">
                        <strong>Added:</strong>
                        <pre>{formatValueForDisplay(change.newValue)}</pre>
                      </div>
                    )}
                    {change.type === 'modified' && (
                      <>
                        <div className="change-value removed">
                          <strong>Old:</strong>
                          <pre>{formatValueForDisplay(change.oldValue)}</pre>
                        </div>
                        <div className="change-value added">
                          <strong>New:</strong>
                          <pre>{formatValueForDisplay(change.newValue)}</pre>
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

