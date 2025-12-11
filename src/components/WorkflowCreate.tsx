import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { createWorkflow } from '../api/workflows'
import { WorkflowParams } from '../types'
import { ArrowLeft, Plus } from 'lucide-react'
import './WorkflowCreate.css'

interface WorkflowCreateProps {
  onCreated: () => void
}

export default function WorkflowCreate({ onCreated }: WorkflowCreateProps) {
  const navigate = useNavigate()
  const [workflowName, setWorkflowName] = useState('')
  const [parserType, setParserType] = useState<'comfyui' | 'default'>('comfyui')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workflowName.trim()) {
      setError('Workflow name is required')
      return
    }

    try {
      setCreating(true)
      setError(null)

      const params: WorkflowParams = {
        parser: parserType,
        description: description.trim() || undefined,
      }

      if (parserType === 'comfyui') {
        params.process = '<COMFYUI>'
        params.main = ''
        params.comfyui_config = {
          serverUrl: 'http://127.0.0.1:8188',
          workflow: './workflow.json',
        }
      } else {
        params.process = 'python'
        params.main = 'main.py'
        params.parameters = {}
        params.ui = {}
        params.use = {}
      }

      await createWorkflow(workflowName.trim(), params)
      onCreated()
      navigate(`/workflow/${encodeURIComponent(workflowName.trim())}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="workflow-create">
      <div className="create-header">
        <Link to="/" className="btn btn-secondary">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1>Create New Workflow</h1>
      </div>

      <form onSubmit={handleSubmit} className="create-form">
        {error && (
          <div className="error-banner">
            <p>{error}</p>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="workflowName">
            Workflow Name <span className="required">*</span>
          </label>
          <input
            id="workflowName"
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            placeholder="e.g., My Awesome Workflow"
            required
            className="form-input"
          />
          <small>This will be the folder name for your workflow</small>
        </div>

        <div className="form-group">
          <label htmlFor="parserType">Parser Type</label>
          <select
            id="parserType"
            value={parserType}
            onChange={(e) =>
              setParserType(e.target.value as 'comfyui' | 'default')
            }
            className="form-select"
          >
            <option value="comfyui">ComfyUI</option>
            <option value="default">Default</option>
          </select>
          <small>
            {parserType === 'comfyui'
              ? 'For ComfyUI workflows exported in API format'
              : 'For custom scripts (Python, Node, etc.)'}
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this workflow does..."
            rows={3}
            className="form-textarea"
          />
        </div>

        <div className="form-actions">
          <Link to="/" className="btn btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={creating || !workflowName.trim()}
            className="btn btn-primary"
          >
            <Plus size={16} /> {creating ? 'Creating...' : 'Create Workflow'}
          </button>
        </div>
      </form>
    </div>
  )
}

