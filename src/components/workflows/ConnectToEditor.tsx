import { useState, useMemo } from 'react'
import { Edit2, Trash2, Plus } from 'lucide-react'
import { SearchableNodeSelect } from './SearchableNodeSelect'

export type ConnectToConfig = {
  nodeId: string
  inputField: string
  conditions: Array<{ whenValue: string | number | boolean; value: string | number | boolean }>
}

interface ConnectToEditorProps {
  connectTo?: ConnectToConfig
  currentNodeId: string
  workflowJson?: Record<string, unknown>
  params?: Record<string, unknown>
  onChange: (connectTo?: ConnectToConfig) => void
}

export function ConnectToEditor({ connectTo, currentNodeId, workflowJson, params, onChange }: ConnectToEditorProps) {
  const [editingConditionIndex, setEditingConditionIndex] = useState<number | null>(null)
  const [newWhenValue, setNewWhenValue] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newValueType, setNewValueType] = useState<'string' | 'number' | 'boolean'>('string')

  const allNodes = useMemo(() => {
    if (!workflowJson) return []
    return Object.entries(workflowJson)
      .filter(([, node]) => typeof node === 'object' && node !== null && 'class_type' in (node as object))
      .map(([id, node]) => {
        const n = node as Record<string, unknown>
        const meta = n._meta as Record<string, unknown> | undefined
        return { id, title: String(meta?.title || n.title || id), classType: String(n.class_type || '') }
      })
  }, [workflowJson])

  const appInfoNodes = useMemo(() => allNodes.filter(n => n.classType === 'AppInfo' || n.classType?.includes('AppInfo')), [allNodes])

  const appInfoInputIds = useMemo(() => {
    if (!workflowJson) return []
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      const nodeData = workflowJson[node.id] as Record<string, unknown> | undefined
      const inputs = nodeData?.inputs as Record<string, unknown> | undefined
      if (inputs?.input_ids) {
        const raw = inputs.input_ids
        const parsed = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean)
        ids.push(...parsed)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes, workflowJson])

  const comfyConfig = (params as Record<string, Record<string, unknown>> | undefined)?.comfyui_config
  const configuredInputIds = (comfyConfig?.input_ids as string[]) || []

  const availableNodes = useMemo(() => {
    const declared = new Set<string>()
    const src = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    src.forEach(id => declared.add(id))
    const nodeParsers = (comfyConfig?.node_parsers as Record<string, unknown> | undefined)?.input_nodes as Record<string, unknown> | undefined
    Object.keys(nodeParsers || {}).forEach(id => declared.add(id))
    return allNodes.filter(n => declared.has(n.id)).sort((a, b) => a.id.localeCompare(b.id))
  }, [allNodes, configuredInputIds, appInfoInputIds, comfyConfig])

  const availableInputFields = useMemo(() => {
    if (!connectTo?.nodeId || !workflowJson) return []
    const src = workflowJson[connectTo.nodeId] as Record<string, unknown> | undefined
    return Object.keys((src?.inputs as Record<string, unknown>) || {})
  }, [connectTo?.nodeId, workflowJson])

  const sourceNodeParser = useMemo(() => {
    if (!connectTo?.nodeId) return null
    const inputNodes = (comfyConfig?.node_parsers as Record<string, unknown> | undefined)?.input_nodes as Record<string, unknown> | undefined
    return inputNodes?.[connectTo.nodeId] as Record<string, unknown> | null
  }, [connectTo?.nodeId, comfyConfig])

  const sourceFieldOptions = useMemo(() => {
    if (!connectTo?.inputField || !sourceNodeParser) return null
    const inputs = sourceNodeParser.inputs as Record<string, Record<string, unknown>> | undefined
    const fieldConfig = inputs?.[connectTo.inputField]
    return fieldConfig?.type === 'select' ? fieldConfig.options : null
  }, [connectTo?.inputField, sourceNodeParser])

  const parseWhenValue = (raw: string): string | number | boolean => {
    if (!connectTo || connectTo.conditions.length === 0) return raw.trim()
    const first = connectTo.conditions[0]
    if (typeof first.whenValue === 'number') { const n = Number(raw.trim()); return isNaN(n) ? raw.trim() : n }
    if (typeof first.whenValue === 'boolean') return raw.trim().toLowerCase() === 'true'
    return raw.trim()
  }

  const parseValue = (raw: string, type: 'string' | 'number' | 'boolean'): string | number | boolean => {
    if (type === 'number') return Number(raw.trim())
    if (type === 'boolean') return raw.trim().toLowerCase() === 'true'
    return raw.trim()
  }

  const addCondition = () => {
    if (!connectTo || !newWhenValue.trim() || !newValue.trim()) return
    const parsedValue = parseValue(newValue, newValueType)
    if (newValueType === 'number' && isNaN(parsedValue as number)) return
    onChange({ ...connectTo, conditions: [...connectTo.conditions, { whenValue: parseWhenValue(newWhenValue), value: parsedValue }] })
    setNewWhenValue('')
    setNewValue('')
    setNewValueType('string')
  }

  const removeCondition = (index: number) => {
    if (!connectTo) return
    const next = connectTo.conditions.filter((_, i) => i !== index)
    onChange(next.length === 0 ? undefined : { ...connectTo, conditions: next })
  }

  const updateCondition = (index: number, updates: Partial<{ whenValue: string | number | boolean; value: string | number | boolean }>) => {
    if (!connectTo) return
    const next = [...connectTo.conditions]
    next[index] = { ...next[index], ...updates }
    onChange({ ...connectTo, conditions: next })
  }

  const renderOptions = (opts: unknown) =>
    Array.isArray(opts) ? opts.map((opt, idx) => {
      const val = typeof opt === 'object' && opt !== null ? (opt as Record<string, unknown>).value : opt
      const label = typeof opt === 'object' && opt !== null ? ((opt as Record<string, unknown>).label || String(val)) : String(opt)
      return <option key={idx} value={String(val)}>{String(label)}</option>
    }) : null

  return (
    <div className="connect-to-editor">
      <div className="config-row">
        <label>
          <input
            type="checkbox"
            checked={!!connectTo}
            onChange={(e) => onChange(e.target.checked ? { nodeId: '', inputField: '', conditions: [] } : undefined)}
          />
          Enable Node Connection (connectTo)
          <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>Automatically update this field when another node's field changes</small>
        </label>
      </div>

      {connectTo && (
        <>
          <div className="config-row">
            <label>Source Node ID</label>
            <SearchableNodeSelect value={connectTo.nodeId} onChange={(nodeId) => onChange({ ...connectTo, nodeId, inputField: '' })} availableNodes={availableNodes} currentNodeId={currentNodeId} placeholder="Search and select a node..." />
          </div>

          {connectTo.nodeId && (
            <>
              <div className="config-row">
                <label>Source Input Field</label>
                <select value={connectTo.inputField} onChange={(e) => onChange({ ...connectTo, inputField: e.target.value })} className="config-input">
                  <option value="">Select a field...</option>
                  {availableInputFields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              {connectTo.inputField && (
                <>
                  <div className="config-row">
                    <label>Conditions</label>
                    <div className="conditions-list">
                      {connectTo.conditions.length === 0 ? (
                        <div className="empty-conditions"><p>No conditions configured. Add conditions below.</p></div>
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
                                      setNewValueType(typeof condition.value === 'number' ? 'number' : typeof condition.value === 'boolean' ? 'boolean' : 'string')
                                    }
                                  }}
                                  className="icon-btn-small" title="Edit condition"
                                ><Edit2 size={12} /></button>
                                <button onClick={() => removeCondition(index)} className="icon-btn-small" title="Remove condition"><Trash2 size={12} /></button>
                              </div>
                            </div>
                            {editingConditionIndex === index && (
                              <div className="condition-edit-form">
                                <div className="condition-edit-row">
                                  <label>When value:</label>
                                  {sourceFieldOptions ? (
                                    <select value={newWhenValue} onChange={(e) => setNewWhenValue(e.target.value)} className="config-input-small" style={{ flex: 1 }}>
                                      <option value="">Select a value...</option>
                                      {renderOptions(sourceFieldOptions)}
                                    </select>
                                  ) : (
                                    <input type="text" value={newWhenValue} onChange={(e) => setNewWhenValue(e.target.value)} placeholder="Value that triggers this condition" className="config-input-small" style={{ flex: 1 }} />
                                  )}
                                </div>
                                <div className="condition-edit-row">
                                  <label>Set to:</label>
                                  <select value={newValueType} onChange={(e) => setNewValueType(e.target.value as 'string' | 'number' | 'boolean')} className="config-input-small" style={{ width: '100px' }}>
                                    <option value="string">String</option>
                                    <option value="number">Number</option>
                                    <option value="boolean">Boolean</option>
                                  </select>
                                  <input type={newValueType === 'number' ? 'number' : 'text'} value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={newValueType === 'boolean' ? 'true or false' : `Value to set (${newValueType})`} className="config-input-small" style={{ flex: 1 }} />
                                </div>
                                <div className="condition-edit-actions">
                                  <button
                                    onClick={() => {
                                      const pv = parseValue(newValue, newValueType)
                                      if (newValueType === 'number' && isNaN(pv as number)) return
                                      updateCondition(index, { whenValue: parseWhenValue(newWhenValue), value: pv })
                                      setEditingConditionIndex(null)
                                    }}
                                    className="btn btn-secondary btn-small"
                                  >Save</button>
                                  <button onClick={() => setEditingConditionIndex(null)} className="btn btn-secondary btn-small">Cancel</button>
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
                          <select value={newWhenValue} onChange={(e) => setNewWhenValue(e.target.value)} className="config-input" style={{ flex: 1 }}>
                            <option value="">Select a value...</option>
                            {renderOptions(sourceFieldOptions)}
                          </select>
                        ) : (
                          <input type="text" value={newWhenValue} onChange={(e) => setNewWhenValue(e.target.value)} placeholder="When value (from source node)" className="config-input" style={{ flex: 1 }} />
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select value={newValueType} onChange={(e) => setNewValueType(e.target.value as 'string' | 'number' | 'boolean')} className="config-input" style={{ width: '120px' }}>
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                        </select>
                        <input type={newValueType === 'number' ? 'number' : 'text'} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && addCondition()} placeholder={newValueType === 'boolean' ? 'true or false' : `Value to set (${newValueType})`} className="config-input" style={{ flex: 1 }} />
                        <button onClick={addCondition} className="btn btn-secondary" disabled={!newWhenValue.trim() || !newValue.trim()}><Plus size={14} /> Add</button>
                      </div>
                    </div>
                  </div>

                  {connectTo.conditions.length > 0 && (
                    <div className="config-row">
                      <small style={{ color: 'var(--text-secondary)' }}>
                        {connectTo.conditions.length} condition{connectTo.conditions.length !== 1 ? 's' : ''} configured.
                        When node <code>{connectTo.nodeId}</code>'s field <code>{connectTo.inputField}</code> changes, this field will be automatically updated based on the conditions above.
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
