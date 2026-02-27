import { useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import './ServerUrlEditor.css'

interface ServerUrlEditorProps {
  value: string | string[] | undefined
  onChange: (value: string | string[] | undefined) => void
  compact?: boolean
  placeholder?: string
  className?: string
  onViewLogs?: (url: string) => void
}

export default function ServerUrlEditor({
  value,
  onChange,
  compact = false,
  placeholder = 'http://127.0.0.1:8188',
  className = '',
}: ServerUrlEditorProps) {
  const newFieldRef = useRef<HTMLInputElement>(null)
  const focusNewField = useRef(false)

  useEffect(() => {
    if (focusNewField.current && newFieldRef.current) {
      newFieldRef.current.focus()
      focusNewField.current = false
    }
  })

  const isArray = Array.isArray(value)
  const urls = isArray ? value : []

  const handleSingleChange = (newValue: string) => {
    onChange(newValue || undefined)
  }

  const handleAddServer = () => {
    if (isArray) {
      onChange([...urls, ''])
    } else {
      onChange([value || '', ''])
    }
    focusNewField.current = true
  }

  const handleUrlChange = (index: number, newUrl: string) => {
    const updated = [...urls]
    updated[index] = newUrl
    onChange(updated)
  }

  const handleRemoveUrl = (index: number) => {
    const updated = urls.filter((_, i) => i !== index)
    if (updated.length === 0) {
      onChange(undefined)
    } else if (updated.length === 1) {
      onChange(updated[0] || undefined)
    } else {
      onChange(updated)
    }
  }

  // Single string mode
  if (!isArray) {
    return (
      <div className={`server-url-editor ${compact ? 'server-url-editor--compact' : ''} ${className}`}>
        <div className="server-url-row">
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleSingleChange(e.target.value)}
            placeholder={placeholder}
            className={compact ? 'quick-info-edit-input' : 'info-input'}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="server-url-add-btn"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleAddServer()
            }}
            title="Add another server URL"
          >
            <Plus size={compact ? 12 : 14} />
          </button>
        </div>
      </div>
    )
  }

  // Array mode
  return (
    <div className={`server-url-editor ${compact ? 'server-url-editor--compact' : ''} ${className}`}>
      {urls.map((url, index) => (
        <div key={index} className="server-url-row">
          {!compact && <span className="server-url-index">{index + 1}.</span>}
          <input
            ref={index === urls.length - 1 ? newFieldRef : undefined}
            type="text"
            value={url}
            onChange={(e) => handleUrlChange(index, e.target.value)}
            placeholder={placeholder}
            className={compact ? 'quick-info-edit-input' : 'info-input'}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="server-url-remove-btn"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleRemoveUrl(index)
            }}
            title="Remove this server URL"
          >
            <X size={compact ? 12 : 14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="server-url-add-btn"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          handleAddServer()
        }}
        title="Add another server URL"
      >
        <Plus size={compact ? 12 : 14} />
        {!compact && <span>Add Server</span>}
      </button>
    </div>
  )
}
