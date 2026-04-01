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
        return '#4db896'
      case 'removed':
        return '#d16b6b'
      case 'modified':
        return '#d4a335'
      default:
        return '#e8ecf1'
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
    <div className="modal-overlay modal-overlay--blur" onClick={onCancel}>
      <div
        className="flex flex-col overflow-hidden rounded-xl border border-[#2d3a4a] bg-[#1a2332] shadow-2xl"
        style={{ maxWidth: '640px', maxHeight: '90vh', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3a4a]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-yellow-500/10">
              <RotateCcw size={18} className="text-yellow-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#e8ecf1] m-0">Confirm Reset</h2>
              {hasMismatch && (
                <p className="text-xs text-yellow-400/80 mt-0.5 flex items-center gap-1">
                  <AlertTriangle size={12} /> View differs from saved file
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-[#697784] hover:text-[#e8ecf1] hover:bg-[#243044] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {hasMismatch && (
            <div className="flex gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 mb-4">
              <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#e8ecf1] mb-1">File Mismatch Detected</p>
                <p className="text-xs text-[#8b9aab] m-0 leading-relaxed">
                  The params.json file on disk differs from what you're currently viewing.
                  Resetting will reload the file and discard your current view.
                </p>
              </div>
            </div>
          )}

          {hasUnsavedChanges && !hasMismatch && (
            <div className="flex gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 mb-4">
              <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#e8ecf1] mb-1">Unsaved Changes</p>
                <p className="text-xs text-[#8b9aab] m-0 leading-relaxed">
                  You have unsaved changes that will be discarded when resetting.
                </p>
              </div>
            </div>
          )}

          {changes.length === 0 ? (
            <div className="text-center py-8 text-[#8b9aab] text-sm">
              No differences detected. Current view matches the saved file.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#2d3a4a]">
                <p className="text-sm text-[#b8c4d0] m-0">
                  <strong className="text-[#e8ecf1]">{changes.length}</strong> difference{changes.length !== 1 ? 's' : ''} between current view and file
                </p>
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-[#243044] text-[#b8c4d0] hover:text-[#e8ecf1] hover:bg-[#2d3a4a] transition-colors border border-[#354556]"
                >
                  <FileDiff size={13} />
                  {showDiff ? 'Hide' : 'Show'} Full Diff
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {changes.slice(0, showDiff ? undefined : 10).map((change: ParamsChangeItem, index: number) => (
                  <div key={index} className="p-3 rounded-lg bg-[#0f1419] border border-[#2d3a4a]">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[14px] font-semibold uppercase text-white"
                        style={{ backgroundColor: getChangeTypeColor(change.type) }}
                      >
                        {getChangeTypeLabel(change.type)}
                      </span>
                      <span className="font-mono text-xs text-[#8b9aab] break-all">{change.path}</span>
                    </div>
                    {change.type === 'removed' && (
                      <div className="mt-1.5 p-2 rounded bg-red-500/5 border-l-2 border-red-400/50">
                        <p className="text-[14px] uppercase font-semibold text-[#697784] mb-1">Current view</p>
                        <pre className="text-xs text-[#b8c4d0] whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.oldValue)}</pre>
                      </div>
                    )}
                    {change.type === 'added' && (
                      <div className="mt-1.5 p-2 rounded bg-green-500/5 border-l-2 border-green-400/50">
                        <p className="text-[14px] uppercase font-semibold text-[#697784] mb-1">File has</p>
                        <pre className="text-xs text-[#b8c4d0] whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.newValue)}</pre>
                      </div>
                    )}
                    {change.type === 'modified' && (
                      <>
                        <div className="mt-1.5 p-2 rounded bg-red-500/5 border-l-2 border-red-400/50">
                          <p className="text-[14px] uppercase font-semibold text-[#697784] mb-1">Current view</p>
                          <pre className="text-xs text-[#b8c4d0] whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.oldValue)}</pre>
                        </div>
                        <div className="mt-1.5 p-2 rounded bg-green-500/5 border-l-2 border-green-400/50">
                          <p className="text-[14px] uppercase font-semibold text-[#697784] mb-1">File has</p>
                          <pre className="text-xs text-[#b8c4d0] whitespace-pre-wrap break-all font-mono m-0">{formatValueForDisplay(change.newValue)}</pre>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {!showDiff && changes.length > 10 && (
                  <div className="text-center py-3 text-[#8b9aab] text-xs">
                    <p className="mb-2">... and {changes.length - 10} more differences</p>
                    <button
                      onClick={() => setShowDiff(true)}
                      className="px-3 py-1 text-xs rounded-md bg-[#243044] text-[#b8c4d0] hover:text-[#e8ecf1] hover:bg-[#2d3a4a] transition-colors border border-[#354556]"
                    >
                      Show All Differences
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#2d3a4a]">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[#243044] text-[#b8c4d0] hover:text-[#e8ecf1] hover:bg-[#2d3a4a] transition-colors border border-[#354556]"
          >
            Cancel
          </button>
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25 transition-colors border border-yellow-500/20"
          >
            <RotateCcw size={14} />
            Reset & Reload File
          </button>
        </div>
      </div>
    </div>
  )
}
