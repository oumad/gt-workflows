import { useState, useEffect, useMemo } from 'react'
import { X, Save, Plus, Trash2, ArrowUp, ArrowDown, Edit2, Image as ImageIcon, Link, GitBranch } from 'lucide-react'
import './NodeParserEditor.css'

interface NodeParserEditorProps {
  nodeId: string
  nodeType: string
  nodeInputs: Record<string, any>
  currentParser: any
  workflowJson?: any
  params?: any
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
  connectTo?: {
    nodeId: string
    inputField: string
    conditions: Array<{
      whenValue: string | number | boolean
      value: string | number | boolean
    }>
  }
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
  workflowJson,
  params,
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

  const SelectOptionsEditor = ({ options, fetchUrl, onChange }: { 
    options: Array<string | number | { value: string | number; label?: string; image?: { name: string; size?: number }; fetchUrl?: boolean }>
    fetchUrl?: string | boolean
    onChange: (options: typeof options) => void
  }) => {
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [newOptionType, setNewOptionType] = useState<'simple' | 'object'>('simple')
    const [newOptionValue, setNewOptionValue] = useState('')
    const [newOptionLabel, setNewOptionLabel] = useState('')
    const [newOptionImage, setNewOptionImage] = useState('')
    const [newOptionImageSize, setNewOptionImageSize] = useState('')
    const [newOptionFetchUrl, setNewOptionFetchUrl] = useState(false)

    const addOption = () => {
      if (newOptionType === 'simple') {
        if (newOptionValue.trim()) {
          const value = isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
          const newOptions = [...options, value]
          onChange(newOptions)
          setNewOptionValue('')
        }
      } else {
        if (newOptionValue.trim()) {
          const optionObj: any = {
            value: isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
          }
          if (newOptionLabel.trim()) optionObj.label = newOptionLabel
          if (newOptionImage.trim()) {
            optionObj.image = {
              name: newOptionImage,
              ...(newOptionImageSize.trim() && !isNaN(Number(newOptionImageSize)) ? { size: Number(newOptionImageSize) } : {})
            }
          }
          // fetchUrl is a boolean flag
          if (newOptionFetchUrl) {
            optionObj.fetchUrl = true
          }
          
          const newOptions = [...options, optionObj]
          onChange(newOptions)
          setNewOptionValue('')
          setNewOptionLabel('')
          setNewOptionImage('')
          setNewOptionImageSize('')
          setNewOptionFetchUrl(false)
        }
      }
    }

    const removeOption = (index: number) => {
      const newOptions = options.filter((_, i) => i !== index)
      // Extract fetchUrl from first option if it exists
      const firstOption = newOptions.length > 0 && isOptionObject(newOptions[0]) ? newOptions[0] : null
      const extractedFetchUrl = firstOption?.fetchUrl && typeof firstOption.fetchUrl === 'string' ? firstOption.fetchUrl : undefined
      onChange(newOptions, extractedFetchUrl)
    }

    const moveOption = (index: number, direction: 'up' | 'down') => {
      const newOptions = [...options]
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex >= 0 && newIndex < newOptions.length) {
        [newOptions[index], newOptions[newIndex]] = [newOptions[newIndex], newOptions[index]]
        // Extract fetchUrl from first option if it exists
        const firstOption = newOptions.length > 0 && isOptionObject(newOptions[0]) ? newOptions[0] : null
        const extractedFetchUrl = firstOption?.fetchUrl && typeof firstOption.fetchUrl === 'string' ? firstOption.fetchUrl : undefined
        onChange(newOptions, extractedFetchUrl)
      }
    }

    const updateOption = (index: number, updates: any) => {
      const newOptions = [...options]
      if (typeof newOptions[index] === 'object' && newOptions[index] !== null) {
        newOptions[index] = { ...(newOptions[index] as any), ...updates }
      } else {
        newOptions[index] = updates.value || newOptions[index]
      }
      // Extract fetchUrl from first option if it exists
      const firstOption = newOptions.length > 0 && isOptionObject(newOptions[0]) ? newOptions[0] : null
      const extractedFetchUrl = firstOption?.fetchUrl && typeof firstOption.fetchUrl === 'string' ? firstOption.fetchUrl : undefined
      onChange(newOptions, extractedFetchUrl)
    }

    const isOptionObject = (opt: any): opt is { value: string | number; label?: string; image?: { name: string; size?: number }; fetchUrl?: boolean } => {
      return typeof opt === 'object' && opt !== null && !Array.isArray(opt) && 'value' in opt
    }

    return (
      <div className="select-options-editor">
        <div className="config-row">
          <label>Select Options</label>
          <div className="options-list">
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
                              <>
                                <span className="option-separator">→</span>
                                <strong>Label:</strong> <span>{displayLabel}</span>
                              </>
                            )}
                            {hasImage && (
                              <>
                                <span className="option-separator">→</span>
                                <ImageIcon size={12} />
                                <span>{option.image?.name}</span>
                                {option.image?.size && <span className="option-meta">({option.image.size}px)</span>}
                              </>
                            )}
                            {hasFetchUrl && (
                              <>
                                <span className="option-separator">→</span>
                                <Link size={12} />
                                <span className="option-meta" title={typeof option.fetchUrl === 'string' ? option.fetchUrl : 'Dynamic fetch'}>
                                  {typeof option.fetchUrl === 'string' ? option.fetchUrl : 'Dynamic fetch'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="option-actions">
                        <button
                          onClick={() => moveOption(index, 'up')}
                          disabled={index === 0}
                          className="icon-btn-small"
                          title="Move up"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          onClick={() => moveOption(index, 'down')}
                          disabled={index === options.length - 1}
                          className="icon-btn-small"
                          title="Move down"
                        >
                          <ArrowDown size={12} />
                        </button>
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
                        <button
                          onClick={() => removeOption(index)}
                          className="icon-btn-small"
                          title="Remove option"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    {editingIndex === index && (
                      <div className="option-edit-form">
                        <div className="option-edit-row">
                          <label>Value:</label>
                          <input
                            type="text"
                            value={newOptionValue}
                            onChange={(e) => setNewOptionValue(e.target.value)}
                            placeholder="Option value"
                            className="config-input-small"
                          />
                        </div>
                        <div className="option-edit-row">
                          <label>Label (optional):</label>
                          <input
                            type="text"
                            value={newOptionLabel}
                            onChange={(e) => setNewOptionLabel(e.target.value)}
                            placeholder="Display label"
                            className="config-input-small"
                          />
                        </div>
                        <div className="option-edit-row">
                          <label>Image name (optional):</label>
                          <input
                            type="text"
                            value={newOptionImage}
                            onChange={(e) => setNewOptionImage(e.target.value)}
                            placeholder="image.png"
                            className="config-input-small"
                          />
                          <input
                            type="number"
                            value={newOptionImageSize}
                            onChange={(e) => setNewOptionImageSize(e.target.value)}
                            placeholder="Size (px)"
                            className="config-input-small"
                            style={{ width: '100px' }}
                          />
                        </div>
                        <div className="option-edit-row checkbox-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={newOptionFetchUrl}
                              onChange={(e) => setNewOptionFetchUrl(e.target.checked)}
                            />
                            Enable dynamic fetch (fetchUrl: true)
                            <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                              When enabled, the value above will be treated as a URL and fetched dynamically to populate options
                            </small>
                          </label>
                        </div>
                        <div className="option-edit-actions">
                          <button
                            onClick={() => {
                              if (isObject) {
                                const updated: any = {
                                  value: isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
                                }
                                if (newOptionLabel.trim()) updated.label = newOptionLabel.trim()
                                if (newOptionImage.trim()) {
                                  updated.image = {
                                    name: newOptionImage.trim(),
                                    ...(newOptionImageSize.trim() && !isNaN(Number(newOptionImageSize)) ? { size: Number(newOptionImageSize) } : {})
                                  }
                                }
                                if (newOptionFetchUrl) {
                                  updated.fetchUrl = true
                                } else {
                                  // Remove fetchUrl if unchecked
                                  const { fetchUrl, ...rest } = updated
                                  updateOption(index, rest)
                                  setEditingIndex(null)
                                  return
                                }
                                updateOption(index, updated)
                              } else {
                                const value = isNaN(Number(newOptionValue)) ? newOptionValue : Number(newOptionValue)
                                updateOption(index, { value })
                              }
                              setEditingIndex(null)
                            }}
                            className="btn btn-secondary btn-small"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="btn btn-secondary btn-small"
                          >
                            Cancel
                          </button>
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
            <select
              value={newOptionType}
              onChange={(e) => setNewOptionType(e.target.value as 'simple' | 'object')}
              className="config-input-small"
              style={{ width: '120px' }}
            >
              <option value="simple">Simple</option>
              <option value="object">With Label/Image</option>
            </select>
            {newOptionType === 'simple' ? (
              <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
                <input
                  type="text"
                  value={newOptionValue}
                  onChange={(e) => setNewOptionValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addOption()}
                  placeholder="Option value (string or number)"
                  className="config-input"
                  style={{ flex: 1 }}
                />
                <button onClick={addOption} className="btn btn-secondary" disabled={!newOptionValue.trim()}>
                  <Plus size={14} /> Add
                </button>
              </div>
            ) : (
              <div className="add-option-form">
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    type="text"
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                    placeholder="Value"
                    className="config-input"
                    style={{ flex: 1 }}
                  />
                  <input
                    type="text"
                    value={newOptionLabel}
                    onChange={(e) => setNewOptionLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="config-input"
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    type="text"
                    value={newOptionImage}
                    onChange={(e) => setNewOptionImage(e.target.value)}
                    placeholder="Image name (optional)"
                    className="config-input"
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    value={newOptionImageSize}
                    onChange={(e) => setNewOptionImageSize(e.target.value)}
                    placeholder="Image size (px)"
                    className="config-input"
                    style={{ width: '120px' }}
                  />
                </div>
                <div className="option-edit-row checkbox-row" style={{ marginBottom: '8px' }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={newOptionFetchUrl}
                      onChange={(e) => setNewOptionFetchUrl(e.target.checked)}
                    />
                    Enable dynamic fetch (fetchUrl: true)
                    <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      When enabled, the value above will be treated as a URL and fetched dynamically to populate options
                    </small>
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={addOption} className="btn btn-secondary" disabled={!newOptionValue.trim()} style={{ marginLeft: 'auto' }}>
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {options.length > 0 && (
          <div className="config-row">
            <small style={{ color: 'var(--text-secondary)' }}>
              {options.length} option{options.length !== 1 ? 's' : ''} configured. 
              Options can be simple values (strings/numbers) or objects with value, label, image, and fetchUrl properties.
              {options.length > 0 && isOptionObject(options[0]) && options[0].fetchUrl === true && (
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

  const ConnectToEditor = ({ 
    connectTo, 
    currentNodeId, 
    workflowJson, 
    params,
    onChange 
  }: { 
    connectTo?: { nodeId: string; inputField: string; conditions: Array<{ whenValue: string | number | boolean; value: string | number | boolean }> }
    currentNodeId: string
    workflowJson?: any
    params?: any
    onChange: (connectTo?: typeof connectTo) => void
  }) => {
    const [editingConditionIndex, setEditingConditionIndex] = useState<number | null>(null)
    const [newWhenValue, setNewWhenValue] = useState('')
    const [newValue, setNewValue] = useState('')
    const [newValueType, setNewValueType] = useState<'string' | 'number' | 'boolean'>('string')

    // Get all nodes from workflow
    const allNodes = useMemo(() => {
      if (!workflowJson) return []
      const nodeList: Array<{ id: string; title: string; classType: string }> = []
      for (const [id, node] of Object.entries(workflowJson)) {
        if (typeof node === 'object' && node !== null && 'class_type' in node) {
          const nodeObj = node as any
          const title = nodeObj._meta?.title || nodeObj.title || id
          nodeList.push({
            id,
            title,
            classType: nodeObj.class_type || ''
          })
        }
      }
      return nodeList
    }, [workflowJson])

    // Get AppInfo nodes to extract input_ids
    const appInfoNodes = useMemo(() => {
      return allNodes.filter(node => 
        node.classType === 'AppInfo' || 
        node.classType?.includes('AppInfo')
      )
    }, [allNodes])

    // Extract input_ids from AppInfo nodes
    const appInfoInputIds = useMemo(() => {
      if (!workflowJson) return []
      const ids: string[] = []
      appInfoNodes.forEach(node => {
        const nodeData = workflowJson[node.id]
        if (nodeData?.inputs?.input_ids) {
          let inputIds: string[] = []
          if (Array.isArray(nodeData.inputs.input_ids)) {
            inputIds = nodeData.inputs.input_ids.map(String)
          } else {
            const str = String(nodeData.inputs.input_ids)
            inputIds = str
              .split(/[,\s\n]+/)
              .map(id => id.trim())
              .filter(id => id.length > 0)
          }
          ids.push(...inputIds)
        }
      })
      return [...new Set(ids)]
    }, [appInfoNodes, workflowJson])

    // Get configured input IDs from params
    const configuredInputIds = params?.comfyui_config?.input_ids || []

    // Determine which nodes are input nodes (including subgraph nodes with parsers and all nodes in declared subgraphs)
    const inputNodeIds = useMemo(() => {
      const ids = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
      const inputNodeIdSet = new Set(ids)
      
      // Include subgraph nodes (nodes with ":" in ID) that have parsers configured
      const nodeParsers = params?.comfyui_config?.node_parsers?.input_nodes || {}
      Object.keys(nodeParsers).forEach(nodeId => {
        if (nodeId.includes(':')) {
          inputNodeIdSet.add(nodeId)
        }
      })
      
      // Include ALL nodes inside declared subgraphs (subgraphs that have config in params.comfyui_config.subgraphs)
      const declaredSubgraphs = params?.comfyui_config?.subgraphs || {}
      Object.keys(declaredSubgraphs).forEach(subgraphId => {
        // Find all nodes that belong to this subgraph
        allNodes.forEach(node => {
          if (node.id.startsWith(`${subgraphId}:`)) {
            inputNodeIdSet.add(node.id)
          }
        })
      })
      
      // Also include ALL subgraph nodes that exist in the workflow (any node with ":" in ID)
      // This ensures nodes from undeclared subgraphs are also available for connections
      allNodes.forEach(node => {
        if (node.id.includes(':')) {
          inputNodeIdSet.add(node.id)
        }
      })
      
      return inputNodeIdSet
    }, [configuredInputIds, appInfoInputIds, params?.comfyui_config?.node_parsers, params?.comfyui_config?.subgraphs, allNodes])

    // Get available nodes for selection (only input nodes)
    const availableNodes = useMemo(() => {
      return allNodes
        .filter(node => inputNodeIds.has(node.id))
        .sort((a, b) => a.id.localeCompare(b.id))
    }, [allNodes, inputNodeIds])

    // Get available input fields for the selected source node
    const availableInputFields = useMemo(() => {
      if (!connectTo?.nodeId || !workflowJson) return []
      const sourceNode = workflowJson[connectTo.nodeId]
      if (!sourceNode || typeof sourceNode !== 'object' || !sourceNode.inputs) return []
      return Object.keys(sourceNode.inputs)
    }, [connectTo?.nodeId, workflowJson])

    // Get source node's parser configuration to check for select options
    const sourceNodeParser = useMemo(() => {
      if (!connectTo?.nodeId || !params?.comfyui_config?.node_parsers?.input_nodes) return null
      return params.comfyui_config.node_parsers.input_nodes[connectTo.nodeId]
    }, [connectTo?.nodeId, params?.comfyui_config?.node_parsers])

    // Get options for the selected source field if it's a select menu
    const sourceFieldOptions = useMemo(() => {
      if (!connectTo?.inputField || !sourceNodeParser?.inputs) return null
      const fieldConfig = sourceNodeParser.inputs[connectTo.inputField]
      if (fieldConfig?.type === 'select' && fieldConfig?.options) {
        return fieldConfig.options
      }
      return null
    }, [connectTo?.inputField, sourceNodeParser])

    const addCondition = () => {
      if (!connectTo || !newWhenValue.trim() || !newValue.trim()) return
      
      let parsedValue: string | number | boolean = newValue.trim()
      if (newValueType === 'number') {
        parsedValue = Number(newValue.trim())
        if (isNaN(parsedValue)) return
      } else if (newValueType === 'boolean') {
        parsedValue = newValue.trim().toLowerCase() === 'true'
      }

      let parsedWhenValue: string | number | boolean = newWhenValue.trim()
      // Try to infer whenValue type from existing conditions
      if (connectTo.conditions.length > 0) {
        const firstCondition = connectTo.conditions[0]
        if (typeof firstCondition.whenValue === 'number') {
          parsedWhenValue = Number(newWhenValue.trim())
          if (isNaN(parsedWhenValue as number)) parsedWhenValue = newWhenValue.trim()
        } else if (typeof firstCondition.whenValue === 'boolean') {
          parsedWhenValue = newWhenValue.trim().toLowerCase() === 'true'
        }
      }

      onChange({
        ...connectTo,
        conditions: [...connectTo.conditions, { whenValue: parsedWhenValue, value: parsedValue }]
      })
      setNewWhenValue('')
      setNewValue('')
      setNewValueType('string')
    }

    const removeCondition = (index: number) => {
      if (!connectTo) return
      const newConditions = connectTo.conditions.filter((_, i) => i !== index)
      if (newConditions.length === 0) {
        onChange(undefined)
      } else {
        onChange({ ...connectTo, conditions: newConditions })
      }
    }

    const updateCondition = (index: number, updates: Partial<{ whenValue: string | number | boolean; value: string | number | boolean }>) => {
      if (!connectTo) return
      const newConditions = [...connectTo.conditions]
      newConditions[index] = { ...newConditions[index], ...updates }
      onChange({ ...connectTo, conditions: newConditions })
    }

    return (
      <div className="connect-to-editor">
        <div className="config-row">
          <label>
            <input
              type="checkbox"
              checked={!!connectTo}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange({
                    nodeId: '',
                    inputField: '',
                    conditions: []
                  })
                } else {
                  onChange(undefined)
                }
              }}
            />
            Enable Node Connection (connectTo)
            <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
              Automatically update this field when another node's field changes
            </small>
          </label>
        </div>

        {connectTo && (
          <>
            <div className="config-row">
              <label>Source Node ID</label>
              <select
                value={connectTo.nodeId}
                onChange={(e) => onChange({ ...connectTo, nodeId: e.target.value, inputField: '' })}
                className="config-input"
              >
                <option value="">Select a node...</option>
                {availableNodes
                  .filter(node => node.id !== currentNodeId)
                  .map(node => (
                    <option key={node.id} value={node.id}>
                      {node.id}: {node.title} ({node.classType})
                    </option>
                  ))}
              </select>
            </div>

            {connectTo.nodeId && (
              <>
                <div className="config-row">
                  <label>Source Input Field</label>
                  <select
                    value={connectTo.inputField}
                    onChange={(e) => onChange({ ...connectTo, inputField: e.target.value })}
                    className="config-input"
                  >
                    <option value="">Select a field...</option>
                    {availableInputFields.map(field => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </div>

                {connectTo.inputField && (
                  <>
                    <div className="config-row">
                      <label>Conditions</label>
                      <div className="conditions-list">
                        {connectTo.conditions.length === 0 ? (
                          <div className="empty-conditions">
                            <p>No conditions configured. Add conditions below.</p>
                          </div>
                        ) : (
                          connectTo.conditions.map((condition, index) => (
                            <div key={index} className="condition-item">
                              <div className="condition-content">
                                <div className="condition-display">
                                  <span className="condition-index">{index + 1}</span>
                                  <div className="condition-details">
                                    <div className="condition-main">
                                      <strong>When:</strong> <code>{String(condition.whenValue)}</code>
                                      <span className="condition-separator">→</span>
                                      <strong>Set to:</strong> <code>{String(condition.value)}</code>
                                    </div>
                                  </div>
                                </div>
                                <div className="condition-actions">
                                  <button
                                    onClick={() => {
                                      if (editingConditionIndex === index) {
                                        setEditingConditionIndex(null)
                                      } else {
                                        setEditingConditionIndex(index)
                                        setNewWhenValue(String(condition.whenValue))
                                        setNewValue(String(condition.value))
                                        if (typeof condition.value === 'number') {
                                          setNewValueType('number')
                                        } else if (typeof condition.value === 'boolean') {
                                          setNewValueType('boolean')
                                        } else {
                                          setNewValueType('string')
                                        }
                                      }
                                    }}
                                    className="icon-btn-small"
                                    title="Edit condition"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    onClick={() => removeCondition(index)}
                                    className="icon-btn-small"
                                    title="Remove condition"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                              {editingConditionIndex === index && (
                                <div className="condition-edit-form">
                                  <div className="condition-edit-row">
                                    <label>When value:</label>
                                    {sourceFieldOptions ? (
                                      <select
                                        value={newWhenValue}
                                        onChange={(e) => setNewWhenValue(e.target.value)}
                                        className="config-input-small"
                                        style={{ flex: 1 }}
                                      >
                                        <option value="">Select a value...</option>
                                        {sourceFieldOptions.map((option, idx) => {
                                          const optionValue = typeof option === 'object' ? option.value : option
                                          const optionLabel = typeof option === 'object' ? (option.label || String(optionValue)) : String(option)
                                          return (
                                            <option key={idx} value={String(optionValue)}>
                                              {optionLabel}
                                            </option>
                                          )
                                        })}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        value={newWhenValue}
                                        onChange={(e) => setNewWhenValue(e.target.value)}
                                        placeholder="Value that triggers this condition"
                                        className="config-input-small"
                                        style={{ flex: 1 }}
                                      />
                                    )}
                                  </div>
                                  <div className="condition-edit-row">
                                    <label>Set to:</label>
                                    <select
                                      value={newValueType}
                                      onChange={(e) => setNewValueType(e.target.value as 'string' | 'number' | 'boolean')}
                                      className="config-input-small"
                                      style={{ width: '100px' }}
                                    >
                                      <option value="string">String</option>
                                      <option value="number">Number</option>
                                      <option value="boolean">Boolean</option>
                                    </select>
                                    <input
                                      type={newValueType === 'number' ? 'number' : 'text'}
                                      value={newValue}
                                      onChange={(e) => setNewValue(e.target.value)}
                                      placeholder={newValueType === 'boolean' ? 'true or false' : `Value to set (${newValueType})`}
                                      className="config-input-small"
                                      style={{ flex: 1 }}
                                    />
                                  </div>
                                  <div className="condition-edit-actions">
                                    <button
                                      onClick={() => {
                                        let parsedValue: string | number | boolean = newValue.trim()
                                        if (newValueType === 'number') {
                                          parsedValue = Number(newValue.trim())
                                          if (isNaN(parsedValue)) return
                                        } else if (newValueType === 'boolean') {
                                          parsedValue = newValue.trim().toLowerCase() === 'true'
                                        }

                                        let parsedWhenValue: string | number | boolean = newWhenValue.trim()
                                        if (connectTo.conditions.length > 0) {
                                          const firstCondition = connectTo.conditions[0]
                                          if (typeof firstCondition.whenValue === 'number') {
                                            parsedWhenValue = Number(newWhenValue.trim())
                                            if (isNaN(parsedWhenValue as number)) parsedWhenValue = newWhenValue.trim()
                                          } else if (typeof firstCondition.whenValue === 'boolean') {
                                            parsedWhenValue = newWhenValue.trim().toLowerCase() === 'true'
                                          }
                                        }

                                        updateCondition(index, {
                                          whenValue: parsedWhenValue,
                                          value: parsedValue
                                        })
                                        setEditingConditionIndex(null)
                                      }}
                                      className="btn btn-secondary btn-small"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => setEditingConditionIndex(null)}
                                      className="btn btn-secondary btn-small"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="config-row">
                      <label>Add New Condition</label>
                      <div className="add-condition-controls">
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          {sourceFieldOptions ? (
                            <select
                              value={newWhenValue}
                              onChange={(e) => setNewWhenValue(e.target.value)}
                              className="config-input"
                              style={{ flex: 1 }}
                            >
                              <option value="">Select a value...</option>
                              {sourceFieldOptions.map((option, idx) => {
                                const optionValue = typeof option === 'object' ? option.value : option
                                const optionLabel = typeof option === 'object' ? (option.label || String(optionValue)) : String(option)
                                return (
                                  <option key={idx} value={String(optionValue)}>
                                    {optionLabel}
                                  </option>
                                )
                              })}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={newWhenValue}
                              onChange={(e) => setNewWhenValue(e.target.value)}
                              placeholder="When value (from source node)"
                              className="config-input"
                              style={{ flex: 1 }}
                            />
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <select
                            value={newValueType}
                            onChange={(e) => setNewValueType(e.target.value as 'string' | 'number' | 'boolean')}
                            className="config-input"
                            style={{ width: '120px' }}
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                          </select>
                          <input
                            type={newValueType === 'number' ? 'number' : 'text'}
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && addCondition()}
                            placeholder={newValueType === 'boolean' ? 'true or false' : `Value to set (${newValueType})`}
                            className="config-input"
                            style={{ flex: 1 }}
                          />
                          <button onClick={addCondition} className="btn btn-secondary" disabled={!newWhenValue.trim() || !newValue.trim()}>
                            <Plus size={14} /> Add
                          </button>
                        </div>
                      </div>
                    </div>

                    {connectTo.conditions.length > 0 && (
                      <div className="config-row">
                        <small style={{ color: 'var(--text-secondary)' }}>
                          {connectTo.conditions.length} condition{connectTo.conditions.length !== 1 ? 's' : ''} configured. 
                          When node <code>{connectTo.nodeId}</code>'s field <code>{connectTo.inputField}</code> changes, 
                          this field will be automatically updated based on the conditions above.
                        </small>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    )
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
                <SelectOptionsEditor
                  options={config.options || []}
                  fetchUrl={config.fetchUrl}
                  onChange={(newOptions) => {
                    updateFieldConfig(fieldName, { 
                      options: newOptions
                    })
                  }}
                />
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
                  <div className="config-row">
                    <label>Image Size (e.g., "200px", "300px")</label>
                    <input
                      type="text"
                      value={config.imageSize || ''}
                      onChange={(e) => updateFieldConfig(fieldName, { imageSize: e.target.value.trim() || undefined })}
                      placeholder="e.g., 200px, 300px"
                      className="config-input"
                    />
                    <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      Size of the image in the image picker (in pixels)
                    </small>
                  </div>
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

              <ConnectToEditor
                connectTo={config.connectTo}
                currentNodeId={nodeId}
                workflowJson={workflowJson}
                params={params}
                onChange={(connectTo) => {
                  if (connectTo) {
                    updateFieldConfig(fieldName, { connectTo })
                  } else {
                    const { connectTo: _, ...rest } = config
                    updateFieldConfig(fieldName, rest)
                  }
                }}
              />
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

