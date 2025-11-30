import { useState, useEffect } from 'react'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import './NodeParserEditor.css'

interface NodeParserEditorProps {
  nodeId: string
  nodeType: string
  nodeInputs: Record<string, any>
  currentParser: any
  onSave: (parserConfig: any) => void
  onClose: () => void
}

interface InputFieldConfig {
  type: string | boolean
  label?: string | boolean
  default?: any
  required?: boolean
  min?: number | string
  max?: number | string
  step?: number | string
  accept?: string[]
  options?: Array<string | number | { value: string | number; label?: string; image?: { name: string; size?: number }; fetchUrl?: string }>
  drawMaskEnable?: boolean
  maskNode?: { nodeId: string }
  fetchUrl?: string
  [key: string]: any
}

const PARSER_TYPES = [
  { value: 'textField', label: 'Text Field' },
  { value: 'textArea', label: 'Text Area' },
  { value: 'slider', label: 'Slider' },
  { value: 'number', label: 'Number Input' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Select Menu' },
  { value: 'uploadImage', label: 'Upload Image' },
  { value: 'uploadVideo', label: 'Upload Video' },
  { value: 'uploadAudio', label: 'Upload Audio' },
  { value: 'file', label: 'File Upload' },
  { value: 'folder', label: 'Folder Picker' },
  { value: false, label: 'Hide Field' },
  { value: true, label: 'Auto-computed (default)' },
]

export default function NodeParserEditor({
  nodeId,
  nodeType,
  nodeInputs,
  currentParser,
  onSave,
  onClose,
}: NodeParserEditorProps) {
  const [inputConfigs, setInputConfigs] = useState<Record<string, InputFieldConfig>>({})
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (currentParser?.inputs) {
      const configs: Record<string, InputFieldConfig> = {}
      const hidden = new Set<string>()
      
      Object.entries(currentParser.inputs).forEach(([fieldName, config]: [string, any]) => {
        if (config === false) {
          hidden.add(fieldName)
        } else if (typeof config === 'object') {
          configs[fieldName] = config
        }
      })
      
      setInputConfigs(configs)
      setHiddenFields(hidden)
    }
  }, [currentParser])

  const updateFieldConfig = (fieldName: string, updates: Partial<InputFieldConfig>) => {
    setInputConfigs(prev => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], ...updates }
    }))
  }

  const toggleFieldHidden = (fieldName: string) => {
    setHiddenFields(prev => {
      const newSet = new Set(prev)
      if (newSet.has(fieldName)) {
        newSet.delete(fieldName)
        // Restore config if it existed
        if (currentParser?.inputs?.[fieldName] && currentParser.inputs[fieldName] !== false) {
          setInputConfigs(prevConfigs => ({
            ...prevConfigs,
            [fieldName]: currentParser.inputs[fieldName]
          }))
        }
      } else {
        newSet.add(fieldName)
        // Remove from configs when hiding
        setInputConfigs(prev => {
          const newConfigs = { ...prev }
          delete newConfigs[fieldName]
          return newConfigs
        })
      }
      return newSet
    })
  }

  const addFieldConfig = (fieldName: string) => {
    setInputConfigs(prev => ({
      ...prev,
      [fieldName]: { type: 'textField' }
    }))
    setHiddenFields(prev => {
      const newSet = new Set(prev)
      newSet.delete(fieldName)
      return newSet
    })
  }

  const removeFieldConfig = (fieldName: string) => {
    setInputConfigs(prev => {
      const newConfigs = { ...prev }
      delete newConfigs[fieldName]
      return newConfigs
    })
  }

  const handleSave = () => {
    const parserConfig: any = {
      inputs: {}
    }

    // Add hidden fields
    hiddenFields.forEach(fieldName => {
      parserConfig.inputs[fieldName] = false
    })

    // Add configured fields
    Object.entries(inputConfigs).forEach(([fieldName, config]) => {
      if (!hiddenFields.has(fieldName)) {
        parserConfig.inputs[fieldName] = config
      }
    })

    onSave(parserConfig)
  }

  const renderFieldEditor = (fieldName: string, config: InputFieldConfig) => {
    return (
      <div key={fieldName} className="field-editor">
        <div className="field-header">
          <h4>{fieldName}</h4>
          <button
            onClick={() => removeFieldConfig(fieldName)}
            className="icon-btn-small"
            title="Remove configuration"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <div className="field-config">
          <div className="config-row">
            <label>Type</label>
            <select
              value={config.type === false ? 'false' : config.type === true ? 'true' : (config.type || 'textField')}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'false') {
                  toggleFieldHidden(fieldName)
                } else if (value === 'true') {
                  updateFieldConfig(fieldName, { type: true })
                } else {
                  updateFieldConfig(fieldName, { type: value })
                }
              }}
              className="config-input"
            >
              {PARSER_TYPES.map(type => (
                <option key={String(type.value)} value={String(type.value)}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {typeof config.type === 'string' && (
            <>
              {config.type !== 'slider' ? (
                <div className="config-row">
                  <label>Label</label>
                  <input
                    type="text"
                    value={typeof config.label === 'string' ? config.label : ''}
                    onChange={(e) => updateFieldConfig(fieldName, { label: e.target.value || undefined })}
                    placeholder="Custom label (optional)"
                    className="config-input"
                  />
                </div>
              ) : (
                <div className="config-row">
                  <label>Label (string or false to hide)</label>
                  <input
                    type="text"
                    value={config.label === false ? 'false' : (typeof config.label === 'string' ? config.label : '')}
                    onChange={(e) => {
                      const value = e.target.value.trim()
                      updateFieldConfig(fieldName, { 
                        label: value === 'false' ? false : (value || undefined)
                      })
                    }}
                    placeholder="Custom label or 'false' to hide"
                    className="config-input"
                  />
                </div>
              )}

              {(config.type === 'slider' || config.type === 'number') && (
                <>
                  <div className="config-row">
                    <label>Min (number or reference like "min_value")</label>
                    <input
                      type="text"
                      value={config.min ?? ''}
                      onChange={(e) => {
                        const value = e.target.value.trim()
                        updateFieldConfig(fieldName, { 
                          min: value ? (isNaN(Number(value)) ? value : Number(value)) : undefined 
                        })
                      }}
                      placeholder='e.g., 0 or "min_value"'
                      className="config-input"
                    />
                  </div>
                  <div className="config-row">
                    <label>Max (number or reference like "max_value")</label>
                    <input
                      type="text"
                      value={config.max ?? ''}
                      onChange={(e) => {
                        const value = e.target.value.trim()
                        updateFieldConfig(fieldName, { 
                          max: value ? (isNaN(Number(value)) ? value : Number(value)) : undefined 
                        })
                      }}
                      placeholder='e.g., 100 or "max_value"'
                      className="config-input"
                    />
                  </div>
                  {(config.type === 'slider' || config.type === 'number') && (
                    <div className="config-row">
                      <label>Step (number or reference like "step")</label>
                      <input
                        type="text"
                        value={config.step ?? ''}
                        onChange={(e) => {
                          const value = e.target.value.trim()
                          updateFieldConfig(fieldName, { 
                            step: value ? (isNaN(Number(value)) ? value : Number(value)) : undefined 
                          })
                        }}
                        placeholder='e.g., 1 or "step"'
                        className="config-input"
                      />
                    </div>
                  )}
                  <div className="config-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.acceptFloat || false}
                        onChange={(e) => updateFieldConfig(fieldName, { acceptFloat: e.target.checked })}
                      />
                      Accept Float (for decimal numbers)
                    </label>
                  </div>
                </>
              )}

              {config.type === 'select' && (
                <>
                  <div className="config-row">
                    <label>Options</label>
                    <textarea
                      value={JSON.stringify(config.options || [], null, 2)}
                      onChange={(e) => {
                        try {
                          const options = JSON.parse(e.target.value)
                          updateFieldConfig(fieldName, { options })
                        } catch {
                          // Invalid JSON, ignore
                        }
                      }}
                      placeholder='["Option 1", "Option 2"] or [{"value": "opt1", "label": "Option 1", "image": {"name": "img.png", "size": 32}}]'
                      className="config-textarea"
                      rows={6}
                    />
                    <small>JSON array: strings, numbers, or objects with value/label/image/fetchUrl</small>
                  </div>
                  <div className="config-row">
                    <label>Fetch URL (for dynamic options)</label>
                    <input
                      type="text"
                      value={config.fetchUrl ? String(config.fetchUrl) : ''}
                      onChange={(e) => {
                        const options = config.options || []
                        if (options.length > 0 && typeof options[0] === 'object' && options[0] !== null && !Array.isArray(options[0])) {
                          // Update first option's fetchUrl
                          const updatedOptions = [...options]
                          const firstOption = updatedOptions[0] as Record<string, any>
                          if (e.target.value) {
                            updatedOptions[0] = { ...firstOption, fetchUrl: e.target.value } as typeof options[0]
                          } else {
                            const { fetchUrl, ...rest } = firstOption
                            updatedOptions[0] = rest as typeof options[0]
                          }
                          updateFieldConfig(fieldName, { options: updatedOptions })
                        }
                      }}
                      placeholder="/services/plugins-backend/api/..."
                      className="config-input"
                    />
                    <small>Set fetchUrl on first option object for dynamic fetching</small>
                  </div>
                </>
              )}

              {(config.type === 'uploadImage' || config.type === 'uploadVideo' || config.type === 'uploadAudio' || config.type === 'file') && (
                <div className="config-row">
                  <label>Accepted Extensions</label>
                  <input
                    type="text"
                    value={Array.isArray(config.accept) ? config.accept.join(', ') : (config.accept || '')}
                    onChange={(e) => updateFieldConfig(fieldName, { 
                      accept: e.target.value.split(',').map(s => s.trim()).filter(s => s) 
                    })}
                    placeholder="png, jpg, jpeg (comma separated)"
                    className="config-input"
                  />
                </div>
              )}

              {config.type === 'uploadImage' && (
                <>
                  <div className="config-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.base64 || false}
                        onChange={(e) => updateFieldConfig(fieldName, { base64: e.target.checked })}
                      />
                      Base64 Encoding
                    </label>
                  </div>
                  <div className="config-row checkbox-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.drawMaskEnable || false}
                        onChange={(e) => updateFieldConfig(fieldName, { drawMaskEnable: e.target.checked })}
                      />
                      Enable Mask Drawing
                    </label>
                  </div>
                  {config.drawMaskEnable && (
                    <>
                      <div className="config-row">
                        <label>Mask Node ID</label>
                        <input
                          type="text"
                          value={config.maskNode?.nodeId || ''}
                          onChange={(e) => updateFieldConfig(fieldName, { 
                            maskNode: { nodeId: e.target.value } 
                          })}
                          placeholder="Node ID for mask"
                          className="config-input"
                        />
                      </div>
                      <div className="config-row">
                        <label>Mask Instructions</label>
                        <input
                          type="text"
                          value={config.instructions || ''}
                          onChange={(e) => updateFieldConfig(fieldName, { instructions: e.target.value })}
                          placeholder="Instructions shown in mask dialog"
                          className="config-input"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {(config.type === 'uploadVideo' || config.type === 'uploadAudio') && (
                <div className="config-row">
                  <label>Save Path (or use &lt;SAVE_INPUT_PATH&gt; placeholder)</label>
                  <input
                    type="text"
                    value={config.path || ''}
                    onChange={(e) => updateFieldConfig(fieldName, { path: e.target.value })}
                    placeholder="<SAVE_INPUT_PATH> or custom path"
                    className="config-input"
                  />
                </div>
              )}

              <div className="config-row">
                <label>
                  <input
                    type="checkbox"
                    checked={config.required || false}
                    onChange={(e) => updateFieldConfig(fieldName, { required: e.target.checked })}
                  />
                  Required
                </label>
              </div>

              {config.type !== 'checkbox' && (
                <div className="config-row">
                  <label>Default Value</label>
                  <input
                    type="text"
                    value={config.default ?? ''}
                    onChange={(e) => updateFieldConfig(fieldName, { default: e.target.value })}
                    placeholder="Default value (optional)"
                    className="config-input"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const availableFields = Object.keys(nodeInputs || {})
  const configuredFields = Object.keys(inputConfigs)
  const unconfiguredFields = availableFields.filter(f => !configuredFields.includes(f) && !hiddenFields.has(f))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content parser-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Configure Node Parser</h2>
            <p className="modal-subtitle">
              Node {nodeId} ({nodeType})
            </p>
          </div>
          <button onClick={onClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body parser-editor-body">
          {availableFields.length === 0 ? (
            <div className="empty-state">
              <p>No input fields found for this node</p>
            </div>
          ) : (
            <>
              {configuredFields.map(fieldName => renderFieldEditor(fieldName, inputConfigs[fieldName]))}
              
              {hiddenFields.size > 0 && (
                <div className="hidden-fields">
                  <h4>Hidden Fields</h4>
                  <div className="hidden-fields-list">
                    {Array.from(hiddenFields).map(fieldName => (
                      <div key={fieldName} className="hidden-field-item">
                        <span>{fieldName}</span>
                        <button
                          onClick={() => toggleFieldHidden(fieldName)}
                          className="icon-btn-small"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unconfiguredFields.length > 0 && (
                <div className="unconfigured-fields">
                  <h4>Available Fields</h4>
                  <div className="fields-list">
                    {unconfiguredFields.map(fieldName => (
                      <button
                        key={fieldName}
                        onClick={() => addFieldConfig(fieldName)}
                        className="add-field-btn"
                      >
                        <Plus size={14} />
                        {fieldName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary">
            <Save size={16} />
            Save Parser Config
          </button>
        </div>
      </div>
    </div>
  )
}

