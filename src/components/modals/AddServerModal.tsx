import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Server, Pencil } from 'lucide-react'
import { normalizeServerUrl, hasInvalidScheme } from '@/components/servers/useServers'

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

const CLS_INPUT = 'w-full px-3 py-2 bg-primary border rounded-lg text-primary text-sm placeholder:text-muted focus:outline-none transition-colors'

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

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="bg-secondary border border-default rounded-xl w-full flex flex-col overflow-hidden shadow-2xl"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-default shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/[0.15] flex items-center justify-center shrink-0">
              {isEdit
                ? <Pencil size={15} className="text-accent-light" />
                : <Server size={15} className="text-accent-light" />}
            </div>
            <h2 className="text-[15px] font-semibold text-primary m-0">
              {isEdit ? 'Edit server' : 'Add monitored server'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-tertiary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body + Footer wrapped in form */}
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 px-5 py-5">
            {/* URL field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-server-url" className="text-sm font-medium text-primary">
                URL <span className="text-muted font-normal">(required)</span>
              </label>
              <input
                id="add-server-url"
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setUrlError(null) }}
                placeholder="http://127.0.0.1:8188"
                className={`${CLS_INPUT} ${urlError ? 'border-semantic-error' : 'border-default focus:border-accent/60'}`}
                autoFocus
                autoComplete="url"
              />
              {urlError && <span className="text-sm text-semantic-error">{urlError}</span>}
            </div>

            {/* Name field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-server-name" className="text-sm font-medium text-primary">
                Name <span className="text-muted font-normal">(optional)</span>
              </label>
              <input
                id="add-server-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Local ComfyUI"
                className={`${CLS_INPUT} border-default focus:border-accent/60`}
                autoComplete="off"
              />
            </div>

            {/* Tags field */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-server-tags" className="text-sm font-medium text-primary">
                Tags <span className="text-muted font-normal">(optional, comma-separated)</span>
              </label>
              <input
                id="add-server-tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. production, europe"
                className={`${CLS_INPUT} border-default focus:border-accent/60`}
                autoComplete="off"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-default shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 text-sm rounded-lg bg-tertiary text-secondary border border-default hover:text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              {isEdit ? 'Save changes' : 'Add server'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
