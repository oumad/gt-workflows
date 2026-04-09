import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Copy, Upload, Image as ImageIcon } from 'lucide-react'
import type { Workflow } from '@/types'
import { duplicateWorkflow, uploadFile, getWorkflowParams, saveWorkflowParams } from '@/services/api/workflows'
import { compressImage } from '@/utils/imageCompression'
import AuthImage from '@/components/ui/AuthImage'

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
    const reader = new FileReader()
    reader.onload = (e) => setIconPreview(e.target?.result as string)
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
      await duplicateWorkflow(workflow.name, newName.trim())
      if (iconFile) {
        try {
          const compressedFile = await compressImage(iconFile, 800, 0.85)
          const uploadResult = await uploadFile(newName.trim(), compressedFile)
          const params = await getWorkflowParams(newName.trim())
          await saveWorkflowParams(newName.trim(), { ...params, icon: uploadResult.relativePath })
        } catch (iconError) {
          console.warn('Failed to upload icon, but workflow was duplicated:', iconError)
        }
      }
      const newWorkflowName = newName.trim()
      onSuccess(newWorkflowName)
      onClose()
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

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-secondary border border-default rounded-xl w-full flex flex-col overflow-hidden shadow-2xl"
        style={{ maxWidth: 480, maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/[0.15] flex items-center justify-center shrink-0">
              <Copy size={15} className="text-accent-light" />
            </div>
            <h2 className="text-[15px] font-semibold text-primary m-0">Duplicate Workflow</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-tertiary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-[#354556] [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-track]:bg-transparent">
          {error && (
            <div className="flex gap-2 p-3 mb-4 rounded-lg bg-semantic-error/[0.06] border border-semantic-error/20 text-sm text-semantic-error">
              {error}
            </div>
          )}

          {/* Name input */}
          <div className="mb-5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              Workflow Name <span className="text-semantic-error">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setError(null) }}
              placeholder="Enter a unique workflow name"
              autoFocus
              className="w-full px-3 py-2 bg-primary border border-default rounded-lg text-primary text-sm placeholder:text-muted focus:outline-none focus:border-accent/60 transition-colors"
            />
            <p className="mt-1.5 text-xs text-muted">
              Must be different from &ldquo;{workflow.name}&rdquo;. This will be the folder name.
            </p>
          </div>

          {/* Icon section */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              Icon <span className="text-muted normal-case font-normal">(optional)</span>
            </label>

            {/* Current / preview icon */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-tertiary border border-default mb-3">
              <div className="w-14 h-14 rounded-lg overflow-hidden border border-light bg-primary flex-shrink-0">
                {iconPreview ? (
                  <img src={iconPreview} alt="New icon" className="w-full h-full object-cover" />
                ) : hasCurrentIcon ? (
                  <AuthImage
                    workflowName={workflow.name}
                    iconPath={workflow.params.icon!}
                    alt="Current icon"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted">
                    <ImageIcon size={20} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {iconPreview ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-primary">New icon selected</span>
                    <button
                      type="button"
                      onClick={() => handleIconChange(null)}
                      className="text-xs px-2 py-0.5 rounded bg-semantic-error/10 text-semantic-error/80 hover:bg-semantic-error/20 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : hasCurrentIcon ? (
                  <span className="text-xs text-muted">Current icon will be copied</span>
                ) : (
                  <span className="text-xs text-muted">No icon set</span>
                )}
              </div>
            </div>

            {/* Upload zone */}
            <label
              className={`flex flex-col items-center gap-1.5 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                iconDragOver
                  ? 'border-accent/60 bg-accent/[0.04]'
                  : 'border-default hover:border-light bg-primary'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIconDragOver(true) }}
              onDragLeave={() => setIconDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIconDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file) handleIconChange(file)
              }}
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleIconChange(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
              <Upload size={16} className="text-muted" />
              <span className="text-xs text-muted">Click or drop to change icon</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-default shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm rounded-lg bg-tertiary text-secondary border border-default hover:text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDuplicate}
            disabled={duplicating || !newName.trim() || newName.trim() === workflow.name}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Copy size={14} />
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
