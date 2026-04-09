import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Save, Server, Clock, Code, Edit2 } from 'lucide-react'
import type { Workflow } from '@/types'
import { getWorkflowParams, saveWorkflowParams } from '@/services/api/workflows'
import ServerUrlEditor from '@/components/ui/ServerUrlEditor'

interface BulkEditModalProps {
  workflows: Workflow[]
  onClose: () => void
  onSave: () => void
}

export default function BulkEditModal({
  workflows,
  onClose,
  onSave,
}: BulkEditModalProps) {
  const [serverUrl, setServerUrl] = useState<string | string[] | undefined>(undefined)
  const [timeoutSec, setTimeoutSec] = useState<number | undefined>(undefined)
  const [devMode, setDevMode] = useState<boolean | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedWorkflows, setFailedWorkflows] = useState<string[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const comfyUIWorkflows = workflows.filter((w) => w.params.parser === 'comfyui')
  const hasComfyUI = comfyUIWorkflows.length > 0

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      setFailedWorkflows([])
      setProgress({ current: 0, total: workflows.length })

      const failed: string[] = []

      for (let i = 0; i < workflows.length; i++) {
        const workflow = workflows[i]
        try {
          const fullParams = await getWorkflowParams(workflow.name)
          const updatedParams = { ...fullParams }

          if (workflow.params.parser === 'comfyui' && serverUrl !== undefined) {
            if (!updatedParams.comfyui_config) updatedParams.comfyui_config = {}
            updatedParams.comfyui_config = { ...updatedParams.comfyui_config, serverUrl }
          }

          if (timeoutSec !== undefined) {
            if (timeoutSec > 0) updatedParams.timeout = timeoutSec
            else delete updatedParams.timeout
          }

          if (devMode !== undefined) {
            updatedParams.devMode = devMode || undefined
          }

          await saveWorkflowParams(workflow.name, updatedParams)
          setProgress({ current: i + 1, total: workflows.length })
        } catch (err) {
          console.error(`Failed to save ${workflow.name}:`, err)
          failed.push(workflow.name)
        }
      }

      if (failed.length > 0) {
        setFailedWorkflows(failed)
        setError(`Failed to save ${failed.length} workflow${failed.length !== 1 ? 's' : ''}`)
        setSaving(false)
        return
      }

      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflows')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-secondary border border-default rounded-xl w-full max-w-[520px] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/[0.15] flex items-center justify-center shrink-0">
              <Edit2 size={15} className="text-accent-light" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-primary m-0">
                Bulk Edit {workflows.length} Workflow{workflows.length !== 1 ? 's' : ''}
              </h2>
              <p className="text-xs text-muted mt-0.5 m-0">Changes apply to all selected</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-tertiary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
          {/* Error */}
          {error && (
            <div className="bg-semantic-error/[0.08] border border-semantic-error/20 rounded-lg px-3 py-2.5 text-sm text-semantic-error">
              <p>{error}</p>
              {failedWorkflows.length > 0 && (
                <ul className="mt-1.5 pl-4 text-xs space-y-0.5 list-disc">
                  {failedWorkflows.map((name) => <li key={name}>{name}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Progress */}
          {saving && (
            <div className="relative bg-primary border border-default rounded-lg overflow-hidden h-9 flex items-center px-3">
              <div
                className="absolute inset-y-0 left-0 bg-accent/25 transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
              <span className="relative text-xs font-medium text-primary">
                Saving {progress.current} of {progress.total}...
              </span>
            </div>
          )}

          {/* Selected workflows */}
          <div>
            <span className="text-[13px] font-semibold uppercase tracking-wide text-muted">
              Selected workflows
            </span>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {workflows.map((w) => (
                <span
                  key={w.name}
                  className="text-xs px-2.5 py-1 rounded-md bg-tertiary text-secondary font-medium"
                >
                  {w.params.label || w.name}
                </span>
              ))}
            </div>
          </div>

          {/* Server URL */}
          {hasComfyUI && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-muted text-[13px] font-semibold uppercase tracking-wide">
                <Server size={12} className="flex-shrink-0" />
                ComfyUI Server URL
              </div>
              <ServerUrlEditor
                compact
                value={serverUrl}
                onChange={setServerUrl}
                placeholder="Leave empty to keep current"
              />
              <p className="text-[13px] text-muted">
                Updates {comfyUIWorkflows.length} ComfyUI workflow{comfyUIWorkflows.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}

          {/* Timeout */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-muted text-[13px] font-semibold uppercase tracking-wide">
              <Clock size={12} className="flex-shrink-0" />
              Timeout (seconds)
            </div>
            <input
              type="number"
              value={timeoutSec || ''}
              onChange={(e) => setTimeoutSec(e.target.value ? parseInt(e.target.value) : undefined)}
              placeholder="Leave empty to keep current"
              min="0"
              className="w-full px-2.5 py-1.5 bg-primary border border-default rounded text-primary text-xs placeholder:text-muted focus:outline-none focus:border-accent/60 transition-colors"
            />
            <p className="text-[13px] text-muted">
              Set to 0 or leave empty to remove timeout
            </p>
          </div>

          {/* Dev Mode */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted text-[13px] font-semibold uppercase tracking-wide">
              <Code size={12} className="flex-shrink-0" />
              Dev Mode
            </div>
            <div className="flex gap-2">
              {([
                { value: undefined, label: 'Keep current' },
                { value: true, label: 'Enable' },
                { value: false, label: 'Disable' },
              ] as const).map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setDevMode(opt.value as boolean | undefined)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    devMode === opt.value
                      ? 'bg-accent/20 border-accent/50 text-accent-light'
                      : 'bg-primary border-default text-muted hover:border-light hover:text-secondary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Warning */}
        {!saving && (devMode === false || timeoutSec === 0) && (
          <div className="mx-5 mb-3 px-3 py-2 bg-semantic-warning/[0.08] border border-semantic-warning/20 rounded-lg text-xs text-semantic-warning">
            <strong>Note:</strong>{' '}
            {devMode === false && timeoutSec === 0
              ? 'Dev mode will be disabled and timeout will be cleared'
              : devMode === false
                ? 'Dev mode will be disabled'
                : 'Timeout will be cleared'}{' '}
            on all {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}.
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-default shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3.5 py-1.5 text-sm rounded-lg bg-tertiary text-secondary border border-default hover:text-primary transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save size={14} />
            {saving ? 'Saving...' : `Save ${workflows.length} Workflow${workflows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
