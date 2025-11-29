import { useState, useEffect } from 'react'
import { X, Save, Server, Clock, Code } from 'lucide-react'
import { WorkflowParams } from '../types'
import { saveWorkflowParams } from '../api/workflows'
import './QuickEditModal.css'

interface QuickEditModalProps {
  workflowName: string
  params: WorkflowParams
  onClose: () => void
  onSave: () => void
}

export default function QuickEditModal({
  workflowName,
  params,
  onClose,
  onSave,
}: QuickEditModalProps) {
  const [serverUrl, setServerUrl] = useState('')
  const [timeout, setTimeout] = useState<number | undefined>(undefined)
  const [devMode, setDevMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (params.comfyui_config?.serverUrl) {
      setServerUrl(params.comfyui_config.serverUrl)
    }
    if (params.timeout !== undefined) {
      setTimeout(params.timeout)
    }
    if (params.devMode !== undefined) {
      setDevMode(params.devMode)
    }
  }, [params])

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)

      const updatedParams: WorkflowParams = { ...params }

      // Update server URL for ComfyUI workflows
      if (params.parser === 'comfyui' && updatedParams.comfyui_config) {
        updatedParams.comfyui_config = {
          ...updatedParams.comfyui_config,
          serverUrl: serverUrl,
        }
      }

      // Update timeout
      if (timeout !== undefined && timeout > 0) {
        updatedParams.timeout = timeout
      } else {
        delete updatedParams.timeout
      }

      // Update dev mode
      updatedParams.devMode = devMode || undefined

      await saveWorkflowParams(workflowName, updatedParams)
      onSave()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const isComfyUI = params.parser === 'comfyui'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Quick Edit: {workflowName}</h2>
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

          {isComfyUI && (
            <div className="form-group">
              <label htmlFor="serverUrl">
                <Server size={16} />
                ComfyUI Server URL
              </label>
              <input
                id="serverUrl"
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://127.0.0.1:8188"
                className="form-input"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="timeout">
              <Clock size={16} />
              Timeout (seconds)
            </label>
            <input
              id="timeout"
              type="number"
              value={timeout || ''}
              onChange={(e) =>
                setTimeout(e.target.value ? parseInt(e.target.value) : undefined)
              }
              placeholder="No timeout"
              min="1"
              className="form-input"
            />
            <small>Leave empty for no timeout</small>
          </div>

          <div className="form-group checkbox-group">
            <label htmlFor="devMode">
              <input
                id="devMode"
                type="checkbox"
                checked={devMode}
                onChange={(e) => setDevMode(e.target.checked)}
                className="checkbox-input"
              />
              <Code size={16} />
              <span>Dev Mode Only</span>
            </label>
            <small>Workflow will only be visible in dev mode</small>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (isComfyUI && !serverUrl.trim())}
            className="btn btn-primary"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

