import { useState } from 'react'
import { X, Server } from 'lucide-react'
import './AddServerModal.css'

export interface AddServerResult {
  url: string
  name?: string
}

interface AddServerModalProps {
  onConfirm: (result: AddServerResult) => void
  onCancel: () => void
  existingUrls: string[]
}

function normalizeUrl(value: string): string {
  let u = value.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export default function AddServerModal({
  onConfirm,
  onCancel,
  existingUrls,
}: AddServerModalProps) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeUrl(url)
    setUrlError(null)
    if (!normalized) {
      setUrlError('URL is required')
      return
    }
    if (existingUrls.includes(normalized)) {
      setUrlError('This server is already in the list')
      return
    }
    onConfirm({
      url: normalized,
      name: name.trim() || undefined,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content add-server-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="add-server-title">
            <Server size={20} />
            <span>Add monitored server</span>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
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
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlError(null)
              }}
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
          <div className="add-server-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add server
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
