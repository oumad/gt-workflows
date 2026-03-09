import { useState, useMemo } from 'react'
import { Edit2, Trash2, Plus } from 'lucide-react'
import { SearchableNodeSelect } from './SearchableNodeSelect'

export type NodeVisibilityConnectToConfig = {
  nodeId: string
  inputField: string
  conditions: Array<{
    displayedWhen?: string | number | boolean
    hiddenWhen?: string | number | boolean
  }>
}

interface NodeVisibilityEditorProps {
  connectTo?: NodeVisibilityConnectToConfig
  currentNodeId: string
  workflowJson?: Record<string, unknown>
  params?: Record<string, unknown>
  onChange: (connectTo?: NodeVisibilityConnectToConfig) => void
}

export function NodeVisibilityEditor({ connectTo, currentNodeId, workflowJson, params, onChange }: NodeVisibilityEditorProps) {
  const [editingConditionIndex, setEditingConditionIndex] = useState<number | null>(null)
  const [newConditionValue, setNewConditionValue] = useState('')
  const [newConditionType, setNewConditionType] = useState<'displayedWhen' | 'hiddenWhen'>('hiddenWhen')

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

  const inputNodeIds = useMemo(() => {
    const ids = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    const set = new Set(ids)
    const nodeParsers = (comfyConfig?.node_parsers as Record<string, unknown> | undefined)?.input_nodes as Record<string, unknown> | undefined
    Object.keys(nodeParsers || {}).forEach(id => { if (id.includes(':')) set.add(id) })
    const subgraphs = (comfyConfig?.subgraphs as Record<string, unknown>) || {}
    Object.keys(subgraphs).forEach(sgId => allNodes.forEach(n => { if (n.id.startsWith(`${sgId}:`)) set.add(n.id) }))
    allNodes.forEach(n => { if (n.id.includes(':')) set.add(n.id) })
    return set
  }, [configuredInputIds, appInfoInputIds, comfyConfig, allNodes])

  const availableNodes = useMemo(() => allNodes.filter(n => inputNodeIds.has(n.id)).sort((a, b) => a.id.localeCompare(b.id)), [allNodes, inputNodeIds])

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

  const parseConditionValue = (raw: string): string | number | boolean => {
    if (!connectTo) return raw.trim()
    const lower = raw.trim().toLowerCase()
    const srcParser = (comfyConfig?.node_parsers as Record<string, unknown> | undefined)?.input_nodes as Record<string, unknown> | undefined
    const fieldCfg = (srcParser?.[connectTo.nodeId] as Record<string, unknown> | undefined)?.inputs as Record<string, unknown> | undefined
    const isBoolean = (fieldCfg?.[connectTo.inputField] as Record<string, unknown> | undefined)?.type === 'checkbox'
    if (isBoolean) return lower === 'true' || lower === '1'
    if (connectTo.conditions.length > 0) {
      const first = connectTo.conditions[0]
      const firstVal = first.displayedWhen ?? first.hiddenWhen
      if (typeof firstVal === 'number') { const n = Number(raw.trim()); return isNaN(n) ? raw.trim() : n }
      if (typeof firstVal === 'boolean') return lower === 'true' || lower === '1'
    }
    if (lower === 'true' || lower === 'false') return lower === 'true'
    if (!isNaN(Number(raw.trim()))) return Number(raw.trim())
    return raw.trim()
  }

  const addCondition = () => {
    if (!connectTo || !newConditionValue.trim()) return
    const parsed = parseConditionValue(newConditionValue)
    const newCond = newConditionType === 'displayedWhen' ? { displayedWhen: parsed } : { hiddenWhen: parsed }
    onChange({ ...connectTo, conditions: [...connectTo.conditions, newCond] })
    setNewConditionValue('')
  }

  const removeCondition = (index: number) => {
    if (!connectTo) return
    const next = connectTo.conditions.filter((_, i) => i !== index)
    onChange(next.length === 0 ? undefined : { ...connectTo, conditions: next })
  }

  const updateCondition = (index: number, updates: Partial<{ displayedWhen?: string | number | boolean; hiddenWhen?: string | number | boolean }>) => {
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
          Enable Node Visibility Control (connectTo)
          <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>Control this node's visibility based on another node's field value</small>
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
                    <label>Visibility Conditions</label>
                    <div className="conditions-list">
                      {connectTo.conditions.length === 0 ? (
                        <div className="empty-conditions"><p>No conditions configured. Add conditions below.</p></div>
                      ) : (
                        connectTo.conditions.map((condition, index) => {
                          const condVal = condition.displayedWhen ?? condition.hiddenWhen
                          const condType = condition.displayedWhen !== undefined ? 'displayedWhen' : 'hiddenWhen'
                          return (
                            <div key={index} className="condition-item">
                              <div className="condition-content">
                                <div className="condition-display">
                                  <span className="condition-index">{index + 1}</span>
                                  <div className="condition-details">
                                    <div className="condition-main">
                                      <strong>{condType === 'displayedWhen' ? 'Displayed when:' : 'Hidden when:'}</strong> <code>{String(condVal)}</code>
                                    </div>
                                  </div>
                                </div>
                                <div className="condition-actions">
                                  <button onClick={() => { if (editingConditionIndex === index) { setEditingConditionIndex(null) } else { setEditingConditionIndex(index); setNewConditionValue(String(condVal)); setNewConditionType(condType) } }} className="icon-btn-small" title="Edit condition"><Edit2 size={12} /></button>
                                  <button onClick={() => removeCondition(index)} className="icon-btn-small" title="Remove condition"><Trash2 size={12} /></button>
                                </div>
                              </div>
                              {editingConditionIndex === index && (
                                <div className="condition-edit-form">
                                  <div className="condition-edit-row">
                                    <label>Condition Type:</label>
                                    <select value={newConditionType} onChange={(e) => setNewConditionType(e.target.value as 'displayedWhen' | 'hiddenWhen')} className="config-input-small" style={{ flex: 1 }}>
                                      <option value="hiddenWhen">Hidden When</option>
                                      <option value="displayedWhen">Displayed When</option>
                                    </select>
                                  </div>
                                  <div className="condition-edit-row">
                                    <label>Value:</label>
                                    {sourceFieldOptions ? (
                                      <select value={newConditionValue} onChange={(e) => setNewConditionValue(e.target.value)} className="config-input-small" style={{ flex: 1 }}>
                                        <option value="">Select a value...</option>
                                        {renderOptions(sourceFieldOptions)}
                                      </select>
                                    ) : (
                                      <input type="text" value={newConditionValue} onChange={(e) => setNewConditionValue(e.target.value)} placeholder="Value that triggers this condition" className="config-input-small" style={{ flex: 1 }} />
                                    )}
                                  </div>
                                  <div className="condition-edit-actions">
                                    <button onClick={() => { const updated = newConditionType === 'displayedWhen' ? { displayedWhen: parseConditionValue(newConditionValue) } : { hiddenWhen: parseConditionValue(newConditionValue) }; updateCondition(index, updated); setEditingConditionIndex(null) }} className="btn btn-secondary btn-small">Save</button>
                                    <button onClick={() => setEditingConditionIndex(null)} className="btn btn-secondary btn-small">Cancel</button>
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
                    <label>Add New Condition</label>
                    <div className="add-condition-controls">
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <select value={newConditionType} onChange={(e) => setNewConditionType(e.target.value as 'displayedWhen' | 'hiddenWhen')} className="config-input" style={{ width: '150px' }}>
                          <option value="hiddenWhen">Hidden When</option>
                          <option value="displayedWhen">Displayed When</option>
                        </select>
                        {sourceFieldOptions ? (
                          <select value={newConditionValue} onChange={(e) => setNewConditionValue(e.target.value)} className="config-input" style={{ flex: 1 }}>
                            <option value="">Select a value...</option>
                            {renderOptions(sourceFieldOptions)}
                          </select>
                        ) : (
                          <input type="text" value={newConditionValue} onChange={(e) => setNewConditionValue(e.target.value)} placeholder="Value that triggers this condition" className="config-input" style={{ flex: 1 }} />
                        )}
                      </div>
                      <button onClick={addCondition} className="btn btn-secondary" disabled={!newConditionValue.trim()}><Plus size={14} /> Add</button>
                    </div>
                  </div>

                  {connectTo.conditions.length > 0 && (
                    <div className="config-row">
                      <small style={{ color: 'var(--text-secondary)' }}>
                        {connectTo.conditions.length} condition{connectTo.conditions.length !== 1 ? 's' : ''} configured.
                        This node will be {connectTo.conditions.some(c => c.displayedWhen !== undefined) ? 'shown' : 'hidden'} based on node <code>{connectTo.nodeId}</code>'s field <code>{connectTo.inputField}</code> value.
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
