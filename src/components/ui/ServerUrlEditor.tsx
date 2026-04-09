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

const compactInputCls = 'w-full px-2 py-1 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#e8ecf1] text-xs focus:outline-none focus:border-purple-500/60'

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
      <div className={`${compact ? 'flex items-center gap-1.5 w-full' : 'server-url-editor'} ${className}`}>
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => handleSingleChange(e.target.value)}
          placeholder={placeholder}
          className={compact ? `${compactInputCls} flex-1 min-w-0` : 'info-input'}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          className={compact
            ? 'flex-shrink-0 flex items-center justify-center px-2 py-1 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#697784] hover:text-purple-400 hover:border-purple-500/60 transition-colors text-xs'
            : 'server-url-add-btn'}
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
    )
  }

  // Array mode
  return (
    <div className={`${compact ? 'flex flex-col gap-1.5 w-full' : 'server-url-editor'} ${className}`}>
      {urls.map((url, index) => (
        <div key={index} className={compact ? 'flex items-center gap-1.5' : 'server-url-row'}>
          {!compact && <span className="server-url-index">{index + 1}.</span>}
          <input
            ref={index === urls.length - 1 ? newFieldRef : undefined}
            type="text"
            value={url}
            onChange={(e) => handleUrlChange(index, e.target.value)}
            placeholder={placeholder}
            className={compact ? `${compactInputCls} flex-1 min-w-0` : 'info-input'}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className={compact
              ? 'flex-shrink-0 flex items-center justify-center px-2 py-1 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#697784] hover:text-red-400 hover:border-red-500/60 transition-colors text-xs'
              : 'server-url-remove-btn'}
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
        className={compact
          ? 'w-full flex items-center justify-center gap-1 px-2 py-1 bg-[#0f1419] border border-dashed border-[#2d3a4a] rounded text-[#697784] hover:text-purple-400 hover:border-purple-500/60 transition-colors text-xs'
          : 'server-url-add-btn'}
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
