import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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

const CHANGE_COLORS: Record<ParamsChangeType, string> = {
  added: '#4db896',
  removed: '#d16b6b',
  modified: '#d4a335',
}

const CHANGE_LABELS: Record<ParamsChangeType, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
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

  // ── Restore confirmation view ──
  if (restoreEntry) {
    return createPortal(
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          className="bg-secondary border border-default rounded-xl w-full flex flex-col overflow-hidden shadow-2xl"
          style={{ maxWidth: 640, maxHeight: '80vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-semantic-warning/[0.12] flex items-center justify-center shrink-0">
                <RotateCcw size={15} className="text-semantic-warning" />
              </div>
              <h2 className="text-[15px] font-semibold text-primary m-0">Restore from History</h2>
            </div>
            <button onClick={() => setRestoreEntry(null)} className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-tertiary transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-track]:bg-transparent">
            {/* Warning */}
            <div className="flex gap-3 p-3 rounded-lg bg-semantic-warning/[0.06] border border-semantic-warning/20 mb-4">
              <AlertTriangle size={18} className="text-semantic-warning flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-primary mb-1">Restore to previous version</p>
                <p className="text-xs text-muted m-0 leading-relaxed">
                  This will overwrite current files with the backed-up versions from{' '}
                  <strong className="text-primary">{new Date(restoreEntry.iso).toLocaleString()}</strong>.
                  Your current files will be backed up first.
                </p>
              </div>
            </div>

            {/* Files to restore */}
            <div className="p-3 rounded-lg bg-tertiary border border-default mb-4">
              <h4 className="text-xs uppercase font-semibold text-muted mb-2 tracking-wider">Files to restore</h4>
              <div className="flex gap-1.5 flex-wrap">
                {restoreEntry.files.map((f) => (
                  <span key={f} className="text-xs px-2 py-0.5 rounded bg-primary border border-default text-secondary font-mono">{f}</span>
                ))}
              </div>
            </div>

            {/* Params diff */}
            {diffLoading && <p className="text-sm text-muted text-center py-2">Loading diff...</p>}
            {paramsDiff && paramsDiff.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-default">
                  <p className="text-sm text-secondary m-0">
                    <strong className="text-primary">{paramsDiff.length}</strong> change{paramsDiff.length !== 1 ? 's' : ''} will be reverted
                  </p>
                  <button
                    onClick={() => setShowFullDiff(!showFullDiff)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-tertiary text-secondary hover:text-primary hover:bg-tertiary transition-colors border border-light"
                  >
                    <FileDiff size={13} />
                    {showFullDiff ? 'Hide' : 'Show'} Full Diff
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {paramsDiff.slice(0, showFullDiff ? undefined : 5).map((change, i) => (
                    <div key={i} className="p-3 rounded-lg bg-primary border border-default">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[13px] font-semibold uppercase text-white"
                          style={{ backgroundColor: CHANGE_COLORS[change.type] || '#e8ecf1' }}
                        >
                          {CHANGE_LABELS[change.type] || 'Changed'}
                        </span>
                        <span className="font-mono text-xs text-muted break-all">{change.path}</span>
                      </div>
                      {change.type === 'removed' && (
                        <div className="mt-1.5 p-2 rounded bg-semantic-error/[0.05] border-l-2 border-semantic-error/40">
                          <p className="text-xs uppercase font-semibold text-muted mb-1">Current</p>
                          <pre className="text-xs text-secondary whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.oldValue)}</pre>
                        </div>
                      )}
                      {change.type === 'added' && (
                        <div className="mt-1.5 p-2 rounded bg-semantic-success/[0.05] border-l-2 border-semantic-success/40">
                          <p className="text-xs uppercase font-semibold text-muted mb-1">Restored</p>
                          <pre className="text-xs text-secondary whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.newValue)}</pre>
                        </div>
                      )}
                      {change.type === 'modified' && (
                        <>
                          <div className="mt-1.5 p-2 rounded bg-semantic-error/[0.05] border-l-2 border-semantic-error/40">
                            <p className="text-xs uppercase font-semibold text-muted mb-1">Current</p>
                            <pre className="text-xs text-secondary whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.oldValue)}</pre>
                          </div>
                          <div className="mt-1.5 p-2 rounded bg-semantic-success/[0.05] border-l-2 border-semantic-success/40">
                            <p className="text-xs uppercase font-semibold text-muted mb-1">Restored</p>
                            <pre className="text-xs text-secondary whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.newValue)}</pre>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {!showFullDiff && paramsDiff.length > 5 && (
                    <div className="text-center py-3">
                      <p className="text-xs text-muted mb-2">... and {paramsDiff.length - 5} more changes</p>
                      <button onClick={() => setShowFullDiff(true)} className="px-3 py-1 text-xs rounded-md bg-tertiary text-secondary hover:text-primary hover:bg-tertiary transition-colors border border-light">
                        Show All Changes
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
            {paramsDiff && paramsDiff.length === 0 && (
              <p className="text-sm text-muted text-center py-4">
                The backed-up params.json is identical to the current version.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-default shrink-0">
            <button
              onClick={() => setRestoreEntry(null)}
              disabled={restoring}
              className="px-3.5 py-1.5 text-sm rounded-lg bg-tertiary text-secondary border border-default hover:text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRestoreConfirm}
              disabled={restoring}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-semantic-warning/[0.15] text-semantic-warning hover:bg-semantic-warning/25 transition-colors border border-semantic-warning/20 disabled:opacity-50"
            >
              <RotateCcw size={14} />
              {restoring ? 'Restoring...' : 'Restore'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // ── Main history list view ──
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-secondary border border-default rounded-xl w-full flex flex-col overflow-hidden shadow-2xl"
        style={{ maxWidth: 640, maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/[0.15] flex items-center justify-center shrink-0">
              <History size={15} className="text-accent-light" />
            </div>
            <h2 className="text-[15px] font-semibold text-primary m-0">History</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-tertiary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-track]:bg-transparent">
          {error && (
            <div className="flex gap-2 p-3 mb-4 rounded-lg bg-semantic-error/[0.06] border border-semantic-error/20 text-sm text-semantic-error">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-10 text-sm text-muted">Loading history...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted">
              No history entries yet. History is created automatically when files are modified.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {entries.map((entry) => (
                <div
                  key={entry.timestamp}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-tertiary border border-default hover:border-accent/30 transition-colors"
                >
                  <History size={14} className="text-muted flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-primary">{entry.action}</span>
                      <span className="text-xs text-muted whitespace-nowrap" title={new Date(entry.iso).toLocaleString()}>
                        {timeAgo(entry.iso)}
                      </span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {entry.files.map((f) => (
                        <span key={f} className="text-xs px-1.5 py-0.5 rounded bg-primary border border-default text-muted font-mono">{f}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleRestore(entry)}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-secondary text-secondary hover:text-primary hover:bg-tertiary transition-colors border border-light"
                      title="Restore to this version"
                    >
                      <RotateCcw size={11} /> Restore
                    </button>
                    <button
                      onClick={() => handleDeleteEntry(entry)}
                      className="flex items-center justify-center w-7 h-7 rounded-md text-muted hover:text-semantic-error hover:bg-semantic-error/10 transition-colors"
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

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-default shrink-0">
          {entries.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-muted hover:text-semantic-error hover:bg-semantic-error/10 transition-colors mr-auto"
            >
              <Trash2 size={13} /> Clear All
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm rounded-lg bg-tertiary text-secondary border border-default hover:text-primary transition-colors ml-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
