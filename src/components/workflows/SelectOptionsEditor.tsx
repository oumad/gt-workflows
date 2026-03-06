import { useState, useEffect, useRef } from 'react'
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Edit2, Image as ImageIcon, Link, Trash2, Plus } from 'lucide-react'

export type SelectOption =
  | string
  | number
  | { value: string | number; label?: string; image?: { name: string; size?: number }; fetchUrl?: string | boolean }

interface SelectOptionsEditorProps {
  options: Array<SelectOption>
  onChange: (options: Array<SelectOption>) => void
}

export function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [newOptionType, setNewOptionType] = useState<'simple' | 'object'>('simple')
  const [newOptionValue, setNewOptionValue] = useState('')
  const [newOptionLabel, setNewOptionLabel] = useState('')
  const [newOptionImage, setNewOptionImage] = useState('')
  const [newOptionImageSize, setNewOptionImageSize] = useState('')
  const [newOptionFetchUrl, setNewOptionFetchUrl] = useState(false)
  const optionsListRef = useRef<HTMLDivElement>(null)
  const scrollRestoreRef = useRef<number | null>(null)
  const parentScrollRestoreRef = useRef<number | null>(null)

  const getScrollParent = (el: HTMLElement | null): HTMLElement | null => {
    if (!el) return null
    const { overflowY } = getComputedStyle(el)
    if (['auto', 'scroll', 'overlay'].includes(overflowY) && el.scrollHeight > el.clientHeight) return el
    return getScrollParent(el.parentElement)
  }

  const saveScrollPositions = () => {
    scrollRestoreRef.current = optionsListRef.current?.scrollTop ?? 0
    const parent = getScrollParent(optionsListRef.current)
    parentScrollRestoreRef.current = parent ? parent.scrollTop : null
  }

  const restoreScrollPositions = () => {
    if (optionsListRef.current && scrollRestoreRef.current !== null) {
      optionsListRef.current.scrollTop = scrollRestoreRef.current
      scrollRestoreRef.current = null
    }
    if (parentScrollRestoreRef.current !== null) {
      const parent = getScrollParent(optionsListRef.current)
      if (parent) {
        parent.scrollTop = parentScrollRestoreRef.current
        parentScrollRestoreRef.current = null
      }
    }
  }

  const addOption = () => {
    if (newOptionType === 'simple') {
      if (newOptionValue.trim()) {
        const value = isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
        onChange([...options, value])
        setNewOptionValue('')
      }
    } else {
      if (newOptionValue.trim()) {
        const optionObj: Record<string, unknown> = {
          value: isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
        }
        if (newOptionLabel.trim()) optionObj.label = newOptionLabel
        if (newOptionImage.trim()) {
          optionObj.image = {
            name: newOptionImage,
            ...(newOptionImageSize.trim() && !isNaN(Number(newOptionImageSize)) ? { size: Number(newOptionImageSize) } : {})
          }
        }
        if (newOptionFetchUrl) optionObj.fetchUrl = true
        onChange([...options, optionObj as SelectOption])
        setNewOptionValue('')
        setNewOptionLabel('')
        setNewOptionImage('')
        setNewOptionImageSize('')
        setNewOptionFetchUrl(false)
      }
    }
  }

  const removeOption = (index: number) => onChange(options.filter((_, i) => i !== index))

  const moveOption = (index: number, direction: 'up' | 'down') => {
    const newOptions = [...options]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex >= 0 && newIndex < newOptions.length) {
      saveScrollPositions()
      ;[newOptions[index], newOptions[newIndex]] = [newOptions[newIndex], newOptions[index]]
      onChange(newOptions)
    }
  }

  const moveOptionToTop = (index: number) => {
    if (index <= 0) return
    saveScrollPositions()
    const newOptions = [...options]
    const [item] = newOptions.splice(index, 1)
    newOptions.unshift(item)
    onChange(newOptions)
  }

  const moveOptionToBottom = (index: number) => {
    if (index >= options.length - 1) return
    saveScrollPositions()
    const newOptions = [...options]
    const [item] = newOptions.splice(index, 1)
    newOptions.push(item)
    onChange(newOptions)
  }

  useEffect(() => {
    if (scrollRestoreRef.current !== null || parentScrollRestoreRef.current !== null) {
      requestAnimationFrame(() => restoreScrollPositions())
    }
  }, [options])

  const updateOption = (index: number, updates: Record<string, unknown>) => {
    const newOptions = [...options]
    const existing = newOptions[index]
    const existingIsObject = typeof existing === 'object' && existing !== null && !Array.isArray(existing) && 'value' in (existing as object)
    const updatesIsFullObject = updates && typeof updates === 'object' && 'value' in updates
    if (existingIsObject) {
      newOptions[index] = { ...(existing as Record<string, unknown>), ...updates } as SelectOption
    } else if (updatesIsFullObject && (updates.label !== undefined || updates.image !== undefined || updates.fetchUrl !== undefined)) {
      newOptions[index] = updates as SelectOption
    } else {
      newOptions[index] = (updates?.value ?? existing) as SelectOption
    }
    onChange(newOptions)
  }

  const isOptionObject = (opt: SelectOption): opt is { value: string | number; label?: string; image?: { name: string; size?: number }; fetchUrl?: string | boolean } =>
    typeof opt === 'object' && opt !== null && !Array.isArray(opt) && 'value' in opt

  return (
    <div className="select-options-editor">
      <div className="config-row">
        <label>Select Options</label>
        <div ref={optionsListRef} className="options-list">
          {options.length === 0 ? (
            <div className="empty-options">
              <p>No options configured. Add options below.</p>
            </div>
          ) : (
            options.map((option, index) => {
              const isObject = isOptionObject(option)
              const displayValue = isObject ? option.value : option
              const displayLabel = isObject ? option.label : undefined
              const hasImage = isObject && option.image
              const hasFetchUrl = isObject && option.fetchUrl

              return (
                <div key={index} className="option-item">
                  <div className="option-content">
                    <div className="option-display">
                      <span className="option-index">{index + 1}</span>
                      <div className="option-details">
                        <div className="option-main">
                          <strong>Value:</strong> <code>{String(displayValue)}</code>
                          {displayLabel && (
                            <><span className="option-separator">→</span><strong>Label:</strong> <span>{displayLabel}</span></>
                          )}
                          {hasImage && (
                            <><span className="option-separator">→</span><ImageIcon size={12} /><span>{option.image?.name}</span>{option.image?.size && <span className="option-meta">({option.image.size}px)</span>}</>
                          )}
                          {hasFetchUrl && (
                            <><span className="option-separator">→</span><Link size={12} /><span className="option-meta" title={typeof option.fetchUrl === 'string' ? option.fetchUrl : 'Dynamic fetch'}>{typeof option.fetchUrl === 'string' ? option.fetchUrl : 'Dynamic fetch'}</span></>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="option-actions">
                      <button onClick={() => moveOptionToTop(index)} disabled={index === 0} className="icon-btn-small" title="Move to top"><ChevronsUp size={12} /></button>
                      <button onClick={() => moveOption(index, 'up')} disabled={index === 0} className="icon-btn-small" title="Move up"><ArrowUp size={12} /></button>
                      <button onClick={() => moveOption(index, 'down')} disabled={index === options.length - 1} className="icon-btn-small" title="Move down"><ArrowDown size={12} /></button>
                      <button onClick={() => moveOptionToBottom(index)} disabled={index === options.length - 1} className="icon-btn-small" title="Move to bottom"><ChevronsDown size={12} /></button>
                      <button
                        onClick={() => {
                          if (editingIndex === index) {
                            setEditingIndex(null)
                          } else {
                            setEditingIndex(index)
                            if (isObject) {
                              setNewOptionValue(String(option.value))
                              setNewOptionLabel(option.label || '')
                              setNewOptionImage(option.image?.name || '')
                              setNewOptionImageSize(option.image?.size ? String(option.image.size) : '')
                              setNewOptionFetchUrl(option.fetchUrl === true)
                            } else {
                              setNewOptionValue(String(option))
                              setNewOptionLabel('')
                              setNewOptionImage('')
                              setNewOptionImageSize('')
                              setNewOptionFetchUrl(false)
                            }
                          }
                        }}
                        className="icon-btn-small"
                        title="Edit option"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button onClick={() => removeOption(index)} className="icon-btn-small" title="Remove option"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  {editingIndex === index && (
                    <div className="option-edit-form">
                      <div className="option-edit-row"><label>Value:</label><input type="text" value={newOptionValue} onChange={(e) => setNewOptionValue(e.target.value)} placeholder="Option value" className="config-input-small" /></div>
                      <div className="option-edit-row"><label>Label (optional):</label><input type="text" value={newOptionLabel} onChange={(e) => setNewOptionLabel(e.target.value)} placeholder="Display label" className="config-input-small" /></div>
                      <div className="option-edit-row">
                        <label>Image name (optional):</label>
                        <input type="text" value={newOptionImage} onChange={(e) => setNewOptionImage(e.target.value)} placeholder="image.png" className="config-input-small" />
                        <input type="number" value={newOptionImageSize} onChange={(e) => setNewOptionImageSize(e.target.value)} placeholder="Size (px)" className="config-input-small" style={{ width: '100px' }} />
                      </div>
                      <div className="option-edit-row checkbox-row">
                        <label>
                          <input type="checkbox" checked={newOptionFetchUrl} onChange={(e) => setNewOptionFetchUrl(e.target.checked)} />
                          Enable dynamic fetch (fetchUrl: true)
                          <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>When enabled, the value above will be treated as a URL and fetched dynamically to populate options</small>
                        </label>
                      </div>
                      <div className="option-edit-actions">
                        <button
                          onClick={() => {
                            if (isObject) {
                              const updated: Record<string, unknown> = { value: isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue) }
                              updated.label = newOptionLabel.trim() || undefined
                              if (newOptionImage.trim()) updated.image = { name: newOptionImage.trim(), ...(newOptionImageSize.trim() && !isNaN(Number(newOptionImageSize)) ? { size: Number(newOptionImageSize) } : {}) }
                              if (newOptionFetchUrl) {
                                updated.fetchUrl = true
                                updateOption(index, updated)
                              } else {
                                const { fetchUrl: _, ...rest } = updated
                                updateOption(index, rest)
                              }
                            } else {
                              const value = isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
                              const hasLabel = !!newOptionLabel.trim()
                              const hasImg = !!newOptionImage.trim()
                              if (hasLabel || hasImg || newOptionFetchUrl) {
                                const optionObj: Record<string, unknown> = { value }
                                if (hasLabel) optionObj.label = newOptionLabel.trim()
                                if (hasImg) optionObj.image = { name: newOptionImage.trim(), ...(newOptionImageSize.trim() && !isNaN(Number(newOptionImageSize)) ? { size: Number(newOptionImageSize) } : {}) }
                                if (newOptionFetchUrl) optionObj.fetchUrl = true
                                updateOption(index, optionObj)
                              } else {
                                updateOption(index, { value })
                              }
                            }
                            setEditingIndex(null)
                          }}
                          className="btn btn-secondary btn-small"
                        >Save</button>
                        <button onClick={() => setEditingIndex(null)} className="btn btn-secondary btn-small">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="config-row">
        <label>Add New Option</label>
        <div className="add-option-controls">
          <select value={newOptionType} onChange={(e) => setNewOptionType(e.target.value as 'simple' | 'object')} className="config-input-small" style={{ width: '120px' }}>
            <option value="simple">Simple</option>
            <option value="object">With Label/Image</option>
          </select>
          {newOptionType === 'simple' ? (
            <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
              <input type="text" value={newOptionValue} onChange={(e) => setNewOptionValue(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && addOption()} placeholder="Option value (string or number)" className="config-input" style={{ flex: 1 }} />
              <button onClick={addOption} className="btn btn-secondary" disabled={!newOptionValue.trim()}><Plus size={14} /> Add</button>
            </div>
          ) : (
            <div className="add-option-form">
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input type="text" value={newOptionValue} onChange={(e) => setNewOptionValue(e.target.value)} placeholder="Value" className="config-input" style={{ flex: 1 }} />
                <input type="text" value={newOptionLabel} onChange={(e) => setNewOptionLabel(e.target.value)} placeholder="Label (optional)" className="config-input" style={{ flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input type="text" value={newOptionImage} onChange={(e) => setNewOptionImage(e.target.value)} placeholder="Image name (optional)" className="config-input" style={{ flex: 1 }} />
                <input type="number" value={newOptionImageSize} onChange={(e) => setNewOptionImageSize(e.target.value)} placeholder="Image size (px)" className="config-input" style={{ width: '120px' }} />
              </div>
              <div className="option-edit-row checkbox-row" style={{ marginBottom: '8px' }}>
                <label>
                  <input type="checkbox" checked={newOptionFetchUrl} onChange={(e) => setNewOptionFetchUrl(e.target.checked)} />
                  Enable dynamic fetch (fetchUrl: true)
                  <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>When enabled, the value above will be treated as a URL and fetched dynamically to populate options</small>
                </label>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={addOption} className="btn btn-secondary" disabled={!newOptionValue.trim()} style={{ marginLeft: 'auto' }}><Plus size={14} /> Add</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {options.length > 0 && (
        <div className="config-row">
          <small style={{ color: 'var(--text-secondary)' }}>
            {options.length} option{options.length !== 1 ? 's' : ''} configured.{' '}
            Options can be simple values (strings/numbers) or objects with value, label, image, and fetchUrl properties.
            {isOptionObject(options[0]) && options[0].fetchUrl === true && (
              <span style={{ display: 'block', marginTop: '4px', color: 'var(--accent)' }}>
                ℹ️ First option has fetchUrl enabled - the value "{String(options[0].value)}" will be fetched dynamically to populate options.
              </span>
            )}
          </small>
        </div>
      )}
    </div>
  )
}
