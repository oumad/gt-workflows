import { useState, useEffect } from 'react'
import { X, Upload, FileDiff, Shield } from 'lucide-react'
import type { WorkflowParams } from '@/types'
import {
  detectParamsChanges,
  formatValueForDisplay,
  type ParamsChangeItem,
  type ParamsChangeType,
} from '@/utils/paramsDiff'
import './SaveConfirmationModal.css'

interface ImportParamsModalProps {
  currentParams: WorkflowParams
  importedParams: WorkflowParams
  serverUrlPreserved: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ImportParamsModal({
  currentParams,
  importedParams,
  serverUrlPreserved,
  onConfirm,
  onCancel,
}: ImportParamsModalProps) {
  const [changes, setChanges] = useState<ParamsChangeItem[]>([])
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    const detected = detectParamsChanges(currentParams, importedParams)
    setChanges(detected)
  }, [currentParams, importedParams])

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

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content save-confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>
              <Upload size={20} />
              Import params.json
            </h2>
          </div>
          <button onClick={onCancel} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {serverUrlPreserved && (
            <div className="conflict-banner" style={{ borderColor: 'var(--accent-color, #4a9eff)' }}>
              <Shield size={20} style={{ color: 'var(--accent-color, #4a9eff)' }} />
              <div>
                <strong>Server URL Preserved</strong>
                <p style={{ margin: 0 }}>
                  The imported file's <code>serverUrl</code> will be replaced with your current server URL configuration.
                </p>
              </div>
            </div>
          )}

          {changes.length === 0 ? (
            <div className="no-changes">
              <p>No differences detected. The imported file matches your current params.</p>
            </div>
          ) : (
            <>
              <div className="changes-summary">
                <p>
                  <strong>{changes.length}</strong> change{changes.length !== 1 ? 's' : ''} will be applied:
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
                        <strong>Current:</strong>
                        <pre>{formatValueForDisplay(change.oldValue)}</pre>
                      </div>
                    )}
                    {change.type === 'added' && (
                      <div className="change-value added">
                        <strong>Imported:</strong>
                        <pre>{formatValueForDisplay(change.newValue)}</pre>
                      </div>
                    )}
                    {change.type === 'modified' && (
                      <>
                        <div className="change-value removed">
                          <strong>Current:</strong>
                          <pre>{formatValueForDisplay(change.oldValue)}</pre>
                        </div>
                        <div className="change-value added">
                          <strong>Imported:</strong>
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
          <button onClick={onConfirm} className="btn btn-primary" disabled={changes.length === 0}>
            <Upload size={16} />
            Apply Import
          </button>
        </div>
      </div>
    </div>
  )
}
