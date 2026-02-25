import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Copy, Upload, Image as ImageIcon } from 'lucide-react'
import type { Workflow } from '@/types'
import { duplicateWorkflow, uploadFile, getWorkflowParams, saveWorkflowParams } from '@/services/api/workflows'
import { compressImage } from '@/utils/imageCompression'
import AuthImage from '@/components/ui/AuthImage'
import './DuplicateModal.css'

interface DuplicateModalProps {
  workflow: Workflow
  onClose: () => void
  onSuccess: (newWorkflowName?: string) => void
  navigateToNew?: boolean
}

export default function DuplicateModal({
  workflow,
  onClose,
  onSuccess,
  navigateToNew = false,
}: DuplicateModalProps) {
  const navigate = useNavigate()
  const [newName, setNewName] = useState(`${workflow.name} (Copy)`)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [iconDragOver, setIconDragOver] = useState(false)

  // Generate default name on mount
  useEffect(() => {
    setNewName(`${workflow.name} (Copy)`)
  }, [workflow.name])

  const handleIconChange = (file: File | null) => {
    if (!file) {
      setIconFile(null)
      setIconPreview(null)
      return
    }

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    setIconFile(file)
    setError(null)

    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
      setIconPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleDuplicate = async () => {
    if (!newName.trim()) {
      setError('Workflow name is required')
      return
    }

    if (newName.trim() === workflow.name) {
      setError('New workflow name must be different from the original')
      return
    }

    try {
      setDuplicating(true)
      setError(null)

      // First, duplicate the workflow
      await duplicateWorkflow(workflow.name, newName.trim())

      // If an icon file was selected, upload it and update params.json
      if (iconFile) {
        try {
          const compressedFile = await compressImage(iconFile, 800, 0.85)
          const uploadResult = await uploadFile(newName.trim(), compressedFile)
          
          // Update params.json to reference the new icon
          const params = await getWorkflowParams(newName.trim())
          await saveWorkflowParams(newName.trim(), {
            ...params,
            icon: uploadResult.relativePath,
          })
        } catch (iconError) {
          console.warn('Failed to upload icon, but workflow was duplicated:', iconError)
          // Don't fail the whole operation if icon upload fails
        }
      }

      const newWorkflowName = newName.trim()
      onSuccess(newWorkflowName)
      onClose()
      
      // Navigate to the new workflow if requested
      if (navigateToNew) {
        navigate(`/workflows/workflow/${encodeURIComponent(newWorkflowName)}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate workflow')
    } finally {
      setDuplicating(false)
    }
  }

  const hasCurrentIcon = !!workflow.params.icon

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content duplicate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Duplicate Workflow</h2>
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

          <div className="form-group">
            <label htmlFor="newName">
              New Workflow Name <span className="required">*</span>
            </label>
            <input
              id="newName"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setError(null)
              }}
              placeholder="Enter a unique workflow name"
              className="form-input"
              autoFocus
            />
            <small>
              Must be different from "{workflow.name}". This will be the folder name.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="icon">Icon (Optional)</label>
            <div className="icon-upload-section">
              <div className="icon-preview-container">
                {iconPreview ? (
                  <div className="icon-preview">
                    <img src={iconPreview} alt="New icon preview" />
                    <button
                      type="button"
                      onClick={() => handleIconChange(null)}
                      className="icon-remove-btn"
                      title="Remove icon"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : hasCurrentIcon ? (
                  <div className="icon-preview">
                    <AuthImage
                      workflowName={workflow.name}
                      iconPath={workflow.params.icon!}
                      alt="Current icon"
                    />
                    <span className="icon-label">Current icon (will be copied)</span>
                  </div>
                ) : (
                  <div className="icon-placeholder">
                    <ImageIcon size={32} />
                    <span>No icon</span>
                  </div>
                )}
              </div>
              <label
                className={`file-drop-zone ${iconDragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIconDragOver(true)
                }}
                onDragLeave={() => setIconDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIconDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) {
                    handleIconChange(file)
                  }
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    handleIconChange(file)
                  }}
                  style={{ display: 'none' }}
                />
                <Upload size={20} />
                <span>Click or drop to change icon</span>
              </label>
              <small>
                Leave empty to use the same icon as the original workflow
              </small>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleDuplicate}
            disabled={duplicating || !newName.trim() || newName.trim() === workflow.name}
            className="btn btn-primary"
          >
            <Copy size={16} />
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  )
}
