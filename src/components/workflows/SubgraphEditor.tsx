import { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronUp, Trash2, GripVertical, Plus, X } from 'lucide-react'
import type { SubgraphConfig, WorkflowJson } from '@/types'

interface SubgraphEditorProps {
  nodeId: string
  config: SubgraphConfig
  workflowJson: WorkflowJson | null
  onUpdate: (config: SubgraphConfig) => void
  onDelete: () => void
}

export function SubgraphEditor({ nodeId, config, workflowJson, onUpdate, onDelete }: SubgraphEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [nodesOrder, setNodesOrder] = useState<string[]>(config.nodesOrder || [])
  const [newNodeId, setNewNodeId] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    setNodesOrder(config.nodesOrder || [])
  }, [config.nodesOrder])

  const childNodes = useMemo(() => {
    if (!workflowJson) return []
    const prefix = `${nodeId}:`
    const children: Array<{ id: string; fullId: string; title: string; classType: string }> = []
    Object.keys(workflowJson).forEach(key => {
      if (key.startsWith(prefix)) {
        const childId = key.split(':')[1]
        if (childId && !children.find(c => c.id === childId)) {
          const node = workflowJson[key] as Record<string, unknown> | undefined
          const meta = node?._meta as Record<string, unknown> | undefined
          children.push({ id: childId, fullId: key, title: String(meta?.title || node?.class_type || childId), classType: String(node?.class_type || '') })
        }
      }
    })
    return children.sort((a, b) => a.id.localeCompare(b.id))
  }, [workflowJson, nodeId])

  const getNodeInfo = (childId: string) =>
    childNodes.find(n => n.id === childId) || { id: childId, fullId: `${nodeId}:${childId}`, title: childId, classType: '' }

  const handleUpdateNodesOrder = (newOrder: string[]) => {
    setNodesOrder(newOrder)
    onUpdate({ ...config, nodesOrder: newOrder.length > 0 ? newOrder : undefined })
  }

  const moveNode = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...nodesOrder]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex >= 0 && newIndex < newOrder.length) {
      ;[newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]]
      handleUpdateNodesOrder(newOrder)
    }
  }

  const removeNode = (index: number) => handleUpdateNodesOrder(nodesOrder.filter((_, i) => i !== index))

  const addNode = () => {
    if (newNodeId.trim() && !nodesOrder.includes(newNodeId.trim())) {
      handleUpdateNodesOrder([...nodesOrder, newNodeId.trim()])
      setNewNodeId('')
    }
  }

  const availableNodes = childNodes.filter(n => !nodesOrder.includes(n.id))

  return (
    <div className="subgraph-editor">
      <div className="subgraph-header" onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          <strong>Subgraph {nodeId}</strong>
          {config.label && <span style={{ color: 'var(--text-secondary)', fontSize: '0.9em' }}>— {config.label}</span>}
        </div>
        {confirmingDelete ? (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            <span style={{ fontSize: '0.8em', color: 'var(--error)' }}>Delete?</span>
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="btn-icon-small btn-danger-small" title="Confirm delete">Yes</button>
            <button onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false) }} className="btn-icon-small" title="Cancel">No</button>
          </div>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true) }} className="btn-icon-small" title="Delete subgraph"><Trash2 size={14} /></button>
        )}
      </div>

      {expanded && (
        <div className="subgraph-content">
          <div className="info-grid">
            <div className="info-item">
              <label>Label</label>
              <input type="text" value={config.label || ''} onChange={(e) => onUpdate({ ...config, label: e.target.value || undefined })} placeholder="Subgraph label" className="info-input" />
            </div>
            <div className="info-item">
              <label>Hide Node Labels</label>
              <select
                value={typeof config.hideNodeLabels === 'boolean' ? (config.hideNodeLabels ? 'all' : 'none') : 'array'}
                onChange={(e) => {
                  const v = e.target.value
                  onUpdate({ ...config, hideNodeLabels: v === 'all' ? true : v === 'none' ? false : (config.hideNodeLabels || []) })
                }}
                className="info-input"
              >
                <option value="none">None</option>
                <option value="all">All</option>
                <option value="array">Specific nodes (edit in JSON)</option>
              </select>
            </div>
            <div className="info-item">
              <label>Show Node Labels</label>
              <select
                value={typeof config.showNodeLabels === 'boolean' ? (config.showNodeLabels ? 'all' : 'none') : 'array'}
                onChange={(e) => {
                  const v = e.target.value
                  onUpdate({ ...config, showNodeLabels: v === 'all' ? true : v === 'none' ? false : (config.showNodeLabels || []) })
                }}
                className="info-input"
              >
                <option value="none">None</option>
                <option value="all">All</option>
                <option value="array">Specific nodes (edit in JSON)</option>
              </select>
            </div>
          </div>

          <div className="info-item info-item-full" style={{ marginTop: '16px' }}>
            <label>Nodes Order</label>
            <small style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
              Specify the display order of child nodes. Only use the child node ID (part after the colon).
            </small>
            {nodesOrder.length > 0 ? (
              <div className="nodes-order-list">
                {nodesOrder.map((childId, index) => {
                  const info = getNodeInfo(childId)
                  return (
                    <div key={index} className="nodes-order-item">
                      <GripVertical size={16} className="grip-icon" />
                      <div className="node-info">
                        <div className="node-id-row">
                          <span className="node-id">{childId}</span>
                          <span className="full-node-id">{info.fullId}</span>
                        </div>
                        <div className="node-title">{info.title}</div>
                        {info.classType && <div className="node-class-type">{info.classType}</div>}
                      </div>
                      <div className="nodes-order-actions">
                        <button onClick={() => moveNode(index, 'up')} disabled={index === 0} className="btn-icon-small" title="Move up"><ChevronUp size={14} /></button>
                        <button onClick={() => moveNode(index, 'down')} disabled={index === nodesOrder.length - 1} className="btn-icon-small" title="Move down"><ChevronDown size={14} /></button>
                        <button onClick={() => removeNode(index)} className="btn-icon-small" title="Remove"><X size={14} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px', marginBottom: '8px' }}>
                <small style={{ color: 'var(--text-secondary)' }}>No nodes in order. Nodes will appear in default order.</small>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <select value={newNodeId} onChange={(e) => setNewNodeId(e.target.value)} className="info-input" style={{ flex: 1 }}>
                <option value="">Select a node to add...</option>
                {availableNodes.map(n => <option key={n.id} value={n.id}>{n.id}: {n.title} ({n.classType})</option>)}
              </select>
              <button onClick={addNode} disabled={!newNodeId.trim()} className="btn btn-secondary"><Plus size={16} />Add</button>
            </div>
            {childNodes.length > 0 && (
              <small style={{ display: 'block', marginTop: '8px', color: 'var(--text-secondary)' }}>
                Available child nodes: {childNodes.map(n => `${n.id} (${n.title})`).join(', ')}
              </small>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
