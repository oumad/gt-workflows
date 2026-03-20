import { useState } from 'react'
import { X, Server, Pencil } from 'lucide-react'
import { normalizeServerUrl, hasInvalidScheme } from '@/components/servers/useServers'
import './AddServerModal.css'

export interface AddServerResult {
  url: string
  name?: string
  tags?: string[]
}

interface AddServerModalProps {
  onConfirm: (result: AddServerResult) => void
  onCancel: () => void
  existingUrls: string[]
  initialValues?: { url: string; name?: string; tags?: string[] }
}

export default function AddServerModal({
  onConfirm,
  onCancel,
  existingUrls,
  initialValues,
}: AddServerModalProps) {
  const isEdit = !!initialValues
  const [url, setUrl] = useState(initialValues?.url ?? '')
  const [name, setName] = useState(initialValues?.name ?? '')
  const [tags, setTags] = useState(initialValues?.tags?.join(', ') ?? '')
  const [urlError, setUrlError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeServerUrl(url)
    setUrlError(null)
    if (!normalized) {
      setUrlError('URL is required')
      return
    }
    if (hasInvalidScheme(normalized)) {
      setUrlError('Only http:// and https:// URLs are allowed')
      return
    }
    const duplicate = existingUrls.filter((u) => u !== initialValues?.url).includes(normalized)
    if (duplicate) {
      setUrlError('This server is already in the list')
      return
    }
    const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)
    onConfirm({
      url: normalized,
      name: name.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content add-server-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="add-server-title">
            {isEdit ? <Pencil size={18} /> : <Server size={20} />}
            <span>{isEdit ? 'Edit server' : 'Add monitored server'}</span>
          </div>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form className="add-server-body" onSubmit={handleSubmit}>
          <div className="add-server-field">
            <label htmlFor="add-server-url">
              URL <span className="add-server-required">(required)</span>
            </label>
            <input
              id="add-server-url"
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setUrlError(null) }}
              placeholder="http://127.0.0.1:8188"
              className={urlError ? 'add-server-input add-server-input-error' : 'add-server-input'}
              autoFocus
              autoComplete="url"
            />
            {urlError && <span className="add-server-error">{urlError}</span>}
          </div>
          <div className="add-server-field">
            <label htmlFor="add-server-name">Name (optional)</label>
            <input
              id="add-server-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Local ComfyUI"
              className="add-server-input"
              autoComplete="off"
            />
          </div>
          <div className="add-server-field">
            <label htmlFor="add-server-tags">Tags (optional, comma-separated)</label>
            <input
              id="add-server-tags"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. production, europe"
              className="add-server-input"
              autoComplete="off"
            />
          </div>
          <div className="add-server-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? 'Save changes' : 'Add server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
