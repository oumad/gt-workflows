import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { createWorkflow } from '@/services/api/workflows'
import type { WorkflowParams } from '@/types'
import { Plus, X, Sparkles } from 'lucide-react'
import { useWorkflows } from '@/hooks/useWorkflows'

interface WorkflowCreateProps {
  onCreated: () => void
}

export function WorkflowCreate({ onCreated }: WorkflowCreateProps) {
  const navigate = useNavigate()
  const { workflows } = useWorkflows()
  const [workflowName, setWorkflowName] = useState('')
  const [parserType, setParserType] = useState<'comfyui' | 'default'>('comfyui')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goBack = () => navigate('/workflows')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = workflowName.trim()
    if (!trimmedName) {
      setError('Workflow name is required')
      return
    }

    const isDuplicate = workflows.some(
      (w) => w.name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (isDuplicate) {
      setError(`A workflow named "${trimmedName}" already exists`)
      return
    }

    try {
      setCreating(true)
      setError(null)

      const params: WorkflowParams = {
        parser: parserType,
        label: label.trim() || undefined,
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
        params.selectors = {}
      }

      await createWorkflow(trimmedName, params)
      onCreated()
      navigate(`/workflows/workflow/${encodeURIComponent(trimmedName)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow')
    } finally {
      setCreating(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={goBack}>
      <div
        className="bg-[#1a2332] border border-[#2d3a4a] rounded-xl w-full max-w-[520px] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3a4a]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-700/15 flex items-center justify-center">
              <Sparkles size={15} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#e8ecf1]">Create New Workflow</h2>
              <p className="text-xs text-[#697784] mt-0.5">Set up a new workflow from scratch</p>
            </div>
          </div>
          <button
            onClick={goBack}
            className="p-1.5 rounded-md text-[#697784] hover:text-[#e8ecf1] hover:bg-[#243044] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="px-5 py-4 space-y-4">
            {/* Error */}
            {error && (
              <div className="bg-red-900/15 border border-red-800/30 rounded-lg px-3 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* Workflow Name */}
            <div className="space-y-1.5">
              <label htmlFor="workflowName" className="flex items-center gap-1 text-[14px] font-medium uppercase tracking-wide text-[#697784]">
                Workflow Name <span className="text-red-400">*</span>
              </label>
              <input
                id="workflowName"
                type="text"
                value={workflowName}
                onChange={(e) => { setWorkflowName(e.target.value); setError(null) }}
                placeholder="e.g., My Awesome Workflow"
                required
                autoFocus
                className="w-full px-2.5 py-1.5 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#e8ecf1] text-xs placeholder-[#697784] focus:outline-none focus:border-purple-500/60 transition-colors"
              />
              <p className="text-[14px] text-[#697784]">This will be the folder name for your workflow</p>
            </div>

            {/* Parser Type */}
            <div className="space-y-1.5">
              <label className="text-[14px] font-medium uppercase tracking-wide text-[#697784]">
                Parser Type
              </label>
              <div className="flex gap-2">
                {([
                  { value: 'comfyui' as const, label: 'ComfyUI' },
                  { value: 'default' as const, label: 'Default' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setParserType(opt.value)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      parserType === opt.value
                        ? 'bg-purple-700/20 border-purple-500/50 text-purple-300'
                        : 'bg-[#0f1419] border-[#2d3a4a] text-[#8b9aab] hover:border-[#3d4d5e] hover:text-[#b8c4d0]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[14px] text-[#697784]">
                {parserType === 'comfyui'
                  ? 'For ComfyUI workflows exported in API format'
                  : 'For custom scripts (Python, Node, etc.)'}
              </p>
            </div>

            {/* Label */}
            <div className="space-y-1.5">
              <label htmlFor="label" className="text-[14px] font-medium uppercase tracking-wide text-[#697784]">
                Label (Optional)
              </label>
              <input
                id="label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Display name (uses folder name if not set)"
                className="w-full px-2.5 py-1.5 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#e8ecf1] text-xs placeholder-[#697784] focus:outline-none focus:border-purple-500/60 transition-colors"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="description" className="text-[14px] font-medium uppercase tracking-wide text-[#697784]">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this workflow does..."
                rows={3}
                className="w-full px-2.5 py-1.5 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#e8ecf1] text-xs placeholder-[#697784] focus:outline-none focus:border-purple-500/60 transition-colors resize-y"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[#2d3a4a]">
            <button
              type="button"
              onClick={goBack}
              className="text-sm py-2 px-4 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-900/10 transition-colors border border-[#2d3a4a]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !workflowName.trim()}
              className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Plus size={14} />
              {creating ? 'Creating...' : 'Create Workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
