import { useState, useEffect, useCallback } from 'react'
import { X, History, RotateCcw, Trash2, AlertTriangle, FileDiff } from 'lucide-react'
import type { HistoryEntry, WorkflowParams } from '@/types'
import {
  getWorkflowHistory,
  getHistoryFileContent,
  restoreFromHistory,
  deleteHistoryEntry,
  clearWorkflowHistory,
} from '@/services/api/workflows'
import {
  detectParamsChanges,
  formatValueForDisplay,
  type ParamsChangeItem,
  type ParamsChangeType,
} from '@/utils/paramsDiff'
import './HistoryModal.css'
import './SaveConfirmationModal.css'

interface HistoryModalProps {
  workflowName: string
  currentParams: WorkflowParams | null
  onClose: () => void
  onRestored: () => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function HistoryModal({
  workflowName,
  currentParams,
  onClose,
  onRestored,
}: HistoryModalProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Restore confirmation state
  const [restoreEntry, setRestoreEntry] = useState<HistoryEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [paramsDiff, setParamsDiff] = useState<ParamsChangeItem[] | null>(null)
  const [showFullDiff, setShowFullDiff] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getWorkflowHistory(workflowName)
      setEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [workflowName])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleRestore = async (entry: HistoryEntry) => {
    setRestoreEntry(entry)
    setParamsDiff(null)
    setShowFullDiff(false)

    // If the entry has params.json, load a diff
    if (entry.files.includes('params.json') && currentParams) {
      setDiffLoading(true)
      try {
        const raw = await getHistoryFileContent(workflowName, entry.timestamp, 'params.json')
        const historyParams = JSON.parse(raw) as WorkflowParams
        const changes = detectParamsChanges(currentParams, historyParams)
        setParamsDiff(changes)
      } catch {
        setParamsDiff(null)
      } finally {
        setDiffLoading(false)
      }
    }
  }

  const handleRestoreConfirm = async () => {
    if (!restoreEntry) return
    try {
      setRestoring(true)
      setError(null)
      await restoreFromHistory(workflowName, restoreEntry.timestamp)
      setRestoreEntry(null)
      onRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore')
      setRestoring(false)
    }
  }

  const handleDeleteEntry = async (entry: HistoryEntry) => {
    try {
      await deleteHistoryEntry(workflowName, entry.timestamp)
      setEntries((prev) => prev.filter((e) => e.timestamp !== entry.timestamp))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry')
    }
  }

  const handleClearAll = async () => {
    try {
      await clearWorkflowHistory(workflowName)
      setEntries([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear history')
    }
  }

  const getChangeTypeColor = (type: ParamsChangeType) => {
    switch (type) {
      case 'added': return 'var(--success)'
      case 'removed': return 'var(--error)'
      case 'modified': return 'var(--warning)'
      default: return 'var(--text-primary)'
    }
  }

  const getChangeTypeLabel = (type: ParamsChangeType) => {
    switch (type) {
      case 'added': return 'Added'
      case 'removed': return 'Removed'
      case 'modified': return 'Modified'
      default: return 'Changed'
    }
  }

  // Restore confirmation view
  if (restoreEntry) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content history-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2><RotateCcw size={20} /> Restore from History</h2>
            <button onClick={() => setRestoreEntry(null)} className="modal-close"><X size={20} /></button>
          </div>

          <div className="modal-body">
            <div className="history-restore-confirm">
              <div className="history-restore-info">
                <AlertTriangle size={20} />
                <div>
                  <strong>Restore to previous version</strong>
                  <p>
                    This will overwrite current files with the backed-up versions from{' '}
                    <strong>{new Date(restoreEntry.iso).toLocaleString()}</strong>.
                    Your current files will be backed up first.
                  </p>
                </div>
              </div>

              <div className="history-restore-files">
                <h4>Files to restore</h4>
                <ul>
                  {restoreEntry.files.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>

              {/* Params diff */}
              {diffLoading && <p style={{ color: 'var(--text-secondary)' }}>Loading diff...</p>}
              {paramsDiff && paramsDiff.length > 0 && (
                <>
                  <div className="changes-summary">
                    <p>
                      <strong>{paramsDiff.length}</strong> param change{paramsDiff.length !== 1 ? 's' : ''} will be reverted:
                    </p>
                    <button onClick={() => setShowFullDiff(!showFullDiff)} className="btn btn-secondary btn-small">
                      <FileDiff size={14} />
                      {showFullDiff ? 'Hide' : 'Show'} Full Diff
                    </button>
                  </div>
                  <div className="changes-list">
                    {paramsDiff.slice(0, showFullDiff ? undefined : 5).map((change, i) => (
                      <div key={i} className="change-item">
                        <div className="change-header">
                          <span className="change-type-badge" style={{ backgroundColor: getChangeTypeColor(change.type) }}>
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
                            <strong>Restored:</strong>
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
                              <strong>Restored:</strong>
                              <pre>{formatValueForDisplay(change.newValue)}</pre>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {!showFullDiff && paramsDiff.length > 5 && (
                      <div className="more-changes">
                        <p>... and {paramsDiff.length - 5} more changes</p>
                        <button onClick={() => setShowFullDiff(true)} className="btn btn-secondary btn-small">
                          Show All Changes
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {paramsDiff && paramsDiff.length === 0 && (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                  The backed-up params.json is identical to the current version.
                </p>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button onClick={() => setRestoreEntry(null)} className="btn btn-secondary" disabled={restoring}>Cancel</button>
            <button onClick={handleRestoreConfirm} className="btn btn-warning" disabled={restoring}>
              <RotateCcw size={16} />
              {restoring ? 'Restoring...' : 'Restore'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Main history list view
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><History size={20} /> History</h2>
          <button onClick={onClose} className="modal-close"><X size={20} /></button>
        </div>

        <div className="modal-body">
          {error && <div className="error-banner"><p>{error}</p></div>}

          {loading ? (
            <div className="history-empty"><p>Loading history...</p></div>
          ) : entries.length === 0 ? (
            <div className="history-empty"><p>No history entries yet. History is created automatically when files are modified.</p></div>
          ) : (
            <div className="history-timeline">
              {entries.map((entry) => (
                <div key={entry.timestamp} className="history-entry">
                  <History size={16} className="history-entry-icon" />
                  <div className="history-entry-content">
                    <div className="history-entry-header">
                      <span className="history-entry-action">{entry.action}</span>
                      <span className="history-entry-time" title={new Date(entry.iso).toLocaleString()}>
                        {timeAgo(entry.iso)}
                      </span>
                    </div>
                    <div className="history-entry-files">
                      {entry.files.map((f) => <span key={f} className="history-file-badge">{f}</span>)}
                    </div>
                  </div>
                  <div className="history-entry-actions">
                    <button
                      onClick={() => handleRestore(entry)}
                      className="btn btn-secondary"
                      title="Restore to this version"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                    <button
                      onClick={() => handleDeleteEntry(entry)}
                      className="btn btn-secondary"
                      title="Delete this entry"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {entries.length > 0 && (
            <button onClick={handleClearAll} className="btn btn-secondary" style={{ marginRight: 'auto' }}>
              <Trash2 size={14} /> Clear All
            </button>
          )}
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  )
}
