import { useState } from 'react'
import { X, Save, Server, Clock, Code, CheckSquare } from 'lucide-react'
import type { Workflow } from '@/types'
import { getWorkflowParams, saveWorkflowParams } from '@/services/api/workflows'
import './BulkEditModal.css'

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
  const [serverUrl, setServerUrl] = useState('')
  const [timeout, setTimeout] = useState<number | undefined>(undefined)
  const [devMode, setDevMode] = useState<boolean | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  // Determine which fields are applicable
  const comfyUIWorkflows = workflows.filter(
    (w) => w.params.parser === 'comfyui'
  )
  const hasComfyUI = comfyUIWorkflows.length > 0

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)
      setProgress({ current: 0, total: workflows.length })

      // Save all workflows
      for (let i = 0; i < workflows.length; i++) {
        const workflow = workflows[i]
        try {
          // Load full params from server to preserve all fields
          const fullParams = await getWorkflowParams(workflow.name)
          const updatedParams = { ...fullParams }

          // Update server URL for ComfyUI workflows
          if (
            workflow.params.parser === 'comfyui' &&
            serverUrl.trim()
          ) {
            if (!updatedParams.comfyui_config) {
              updatedParams.comfyui_config = {}
            }
            updatedParams.comfyui_config = {
              ...updatedParams.comfyui_config,
              serverUrl: serverUrl.trim(),
            }
          }

          // Update timeout
          if (timeout !== undefined) {
            if (timeout > 0) {
              updatedParams.timeout = timeout
            } else {
              delete updatedParams.timeout
            }
          }

          // Update dev mode
          if (devMode !== undefined) {
            updatedParams.devMode = devMode || undefined
          }

          await saveWorkflowParams(workflow.name, updatedParams)
          setProgress({ current: i + 1, total: workflows.length })
        } catch (err) {
          console.error(`Failed to save ${workflow.name}:`, err)
          // Continue with other workflows even if one fails
        }
      }

      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflows')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content bulk-edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>
              <CheckSquare size={20} />
              Bulk Edit {workflows.length} Workflow{workflows.length !== 1 ? 's' : ''}
            </h2>
            <p className="modal-subtitle">
              Changes will be applied to all selected workflows
            </p>
          </div>
          <button onClick={onClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-banner">
              <p>{error}</p>
            </div>
          )}

          {saving && (
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
              <span className="progress-text">
                Saving {progress.current} of {progress.total}...
              </span>
            </div>
          )}

          <div className="selected-workflows-list">
            <h3>Selected Workflows:</h3>
            <div className="workflow-names">
              {workflows.map((w) => (
                <span key={w.name} className="workflow-name-tag">
                  {w.name}
                </span>
              ))}
            </div>
          </div>

          {hasComfyUI && (
            <div className="form-group">
              <label htmlFor="bulk-serverUrl">
                <Server size={16} />
                ComfyUI Server URL
              </label>
              <input
                id="bulk-serverUrl"
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="Leave empty to keep current values"
                className="form-input"
              />
              <small>
                Will only update {comfyUIWorkflows.length} ComfyUI workflow
                {comfyUIWorkflows.length !== 1 ? 's' : ''}
              </small>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="bulk-timeout">
              <Clock size={16} />
              Timeout (seconds)
            </label>
            <input
              id="bulk-timeout"
              type="number"
              value={timeout || ''}
              onChange={(e) =>
                setTimeout(e.target.value ? parseInt(e.target.value) : undefined)
              }
              placeholder="Leave empty to keep current values"
              min="0"
              className="form-input"
            />
            <small>
              Set to 0 or leave empty to remove timeout from workflows
            </small>
          </div>

          <div className="form-group checkbox-group">
            <label htmlFor="bulk-devMode">
              <Code size={16} />
              <span>Dev Mode</span>
            </label>
            <div className="checkbox-options">
              <label className="checkbox-option">
                <input
                  type="radio"
                  name="devMode"
                  checked={devMode === undefined}
                  onChange={() => setDevMode(undefined)}
                />
                <span>Keep current</span>
              </label>
              <label className="checkbox-option">
                <input
                  type="radio"
                  name="devMode"
                  checked={devMode === true}
                  onChange={() => setDevMode(true)}
                />
                <span>Enable</span>
              </label>
              <label className="checkbox-option">
                <input
                  type="radio"
                  name="devMode"
                  checked={devMode === false}
                  onChange={() => setDevMode(false)}
                />
                <span>Disable</span>
              </label>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            <Save size={16} />
            {saving ? 'Saving...' : `Save ${workflows.length} Workflow${workflows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

