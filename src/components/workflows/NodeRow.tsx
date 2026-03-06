import { ArrowUp, ArrowDown, ArrowRight, Eye, EyeOff, Edit2, Package, MoreVertical, Plus, X, Tag } from 'lucide-react'

export type ArrayName = 'input_ids' | 'output_ids' | 'hiddenNodeIds' | 'wrappedNodeIds'

export interface NodeInfo {
  id: string
  class_type: string
  title?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs?: Record<string, any>
  _meta?: { title?: string }
}

export interface NodeRowCallbacks {
  onToggle: (id: string) => void
  onSetMoreMenu: (id: string | null) => void
  onAddToArray: (arr: ArrayName, id: string) => void
  onRemoveFromArray: (arr: ArrayName, id: string) => void
  onToggleLabelHidden: (id: string) => void
  onReorder: (subgraphId: string, nodeId: string, dir: 'up' | 'down') => void
  onEditParser: (nodeId: string, nodeType: string, nodeInputs: Record<string, unknown>) => void
  getNodeParser: (nodeId: string) => unknown
  isNodeLabelHidden: (nodeId: string) => boolean
}

interface NodeRowProps {
  node: NodeInfo
  subgraphId?: string
  nodeIndex?: number
  totalNodes?: number
  expandedNodes: Set<string>
  moreMenuOpen: string | null
  inputNodes: NodeInfo[]
  outputNodes: NodeInfo[]
  hiddenNodeIds: string[]
  wrappedNodeIds: string[]
  cb: NodeRowCallbacks
}

function formatNodeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 50 ? value.substring(0, 47) + '...' : value
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.length === 1) return `[${formatNodeValue(value[0])}]`
    return `[${value.length} items]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    if (keys.length === 0) return '{}'
    if (keys.length === 1) return `{${keys[0]}: ${formatNodeValue((value as Record<string, unknown>)[keys[0]])}}`
    return `{${keys.length} fields}`
  }
  return String(value)
}

function getNodeValuePreview(node: NodeInfo): string | null {
  if (!node.inputs || Object.keys(node.inputs).length === 0) return null
  const inputKeys = Object.keys(node.inputs)
  if (inputKeys.length === 1) {
    const key = inputKeys[0]
    const value = node.inputs[key]
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return null
    return `${key}: ${formatNodeValue(value)}`
  }
  const priorityFields = ['text', 'value', 'prompt', 'seed', 'steps', 'width', 'height']
  for (const field of priorityFields) {
    if (node.inputs[field] !== undefined) {
      const value = node.inputs[field]
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') continue
      return `${field}: ${formatNodeValue(value)}`
    }
  }
  return `${inputKeys.length} inputs`
}

export function NodeRow({ node, subgraphId, nodeIndex, totalNodes, expandedNodes, moreMenuOpen, inputNodes, outputNodes, hiddenNodeIds, wrappedNodeIds, cb }: NodeRowProps) {
  const isExpanded = expandedNodes.has(node.id)
  const isInput = inputNodes.some(n => n.id === node.id)
  const isOutput = outputNodes.some(n => n.id === node.id)
  const isHidden = hiddenNodeIds.includes(node.id)
  const isWrapped = wrappedNodeIds.includes(node.id)
  const isSubgraphNode = node.id.includes(':')
  const nodeParser = cb.getNodeParser(node.id)
  const isLabelHidden = isSubgraphNode ? cb.isNodeLabelHidden(node.id) : false
  const hasLabelToToggle = isSubgraphNode && !!(node._meta?.title || node.title)
  const hasParser = !!nodeParser
  const valuePreview = !isExpanded ? getNodeValuePreview(node) : null
  const showReorderButtons = isSubgraphNode && subgraphId !== undefined && nodeIndex !== undefined && totalNodes !== undefined
  const canMoveUp = showReorderButtons && nodeIndex > 0
  const canMoveDown = showReorderButtons && nodeIndex < (totalNodes ?? 0) - 1

  return (
    <div key={node.id} className="node-item">
      <div className="node-header">
        {showReorderButtons ? (
          <div className="node-header-controls">
            <div className="node-reorder-buttons" onClick={(e) => e.stopPropagation()}>
              <button onClick={(e) => { e.stopPropagation(); if (canMoveUp && subgraphId) cb.onReorder(subgraphId, node.id, 'up') }} className={`node-reorder-btn ${canMoveUp ? '' : 'disabled'}`} title="Move up" disabled={!canMoveUp}>
                <ArrowUp size={12} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); if (canMoveDown && subgraphId) cb.onReorder(subgraphId, node.id, 'down') }} className={`node-reorder-btn ${canMoveDown ? '' : 'disabled'}`} title="Move down" disabled={!canMoveDown}>
                <ArrowDown size={12} />
              </button>
            </div>
            <div className="node-expand-icon" onClick={() => cb.onToggle(node.id)}>
              {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
            </div>
          </div>
        ) : (
          <div className="node-expand-icon" onClick={() => cb.onToggle(node.id)}>
            {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
          </div>
        )}
        <div className="node-header-left" onClick={() => cb.onToggle(node.id)}>
          <div className="node-id-section"><span className="node-id">{node.id}</span></div>
          <div className="node-title-section">
            {(node._meta?.title || node.title) && (
              <span className={`node-title ${isLabelHidden ? 'node-title-hidden' : ''}`} title={isLabelHidden ? 'Label is hidden in workflow UI' : undefined}>
                {node._meta?.title || node.title}
              </span>
            )}
          </div>
          <div className="node-type-section"><span className="node-type">{node.class_type}</span></div>
          <div className="node-badges-section">
            {isInput && <span className="node-badge input-badge">Input</span>}
            {isOutput && <span className="node-badge output-badge">Output</span>}
            {isHidden && <span className="node-badge hidden-badge">Hidden</span>}
            {isWrapped && <span className="node-badge wrapped-badge">Wrapped</span>}
            {hasParser && <span className="node-badge parser-badge">Parsed</span>}
          </div>
          <div className="node-value-section">
            {valuePreview && <span className="node-value-preview" title={valuePreview}>{valuePreview}</span>}
          </div>
        </div>
        <div className="node-header-actions" onClick={(e) => e.stopPropagation()}>
          {!isHidden ? (
            <button onClick={() => cb.onAddToArray('hiddenNodeIds', node.id)} className="node-quick-action-btn" title="Hide this node from UI"><Eye size={14} /></button>
          ) : (
            <button onClick={() => cb.onRemoveFromArray('hiddenNodeIds', node.id)} className="node-quick-action-btn node-quick-action-btn-active" title="Show this node in UI"><EyeOff size={14} /></button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="node-details">
          <div className="node-actions">
            <button
              onClick={(e) => { e.stopPropagation(); cb.onEditParser(node.id, node.class_type, node.inputs || {}) }}
              className={`action-btn ${hasParser ? 'parser' : ''}`}
              title={hasParser ? 'Edit parser config' : 'Configure parser'}
            >
              <Edit2 size={12} /> {hasParser ? 'Edit Parser' : 'Configure Parser'}
            </button>
            {!isWrapped ? (
              <button onClick={() => cb.onAddToArray('wrappedNodeIds', node.id)} className="action-btn"><Package size={12} /> Wrap Node</button>
            ) : (
              <button onClick={() => cb.onRemoveFromArray('wrappedNodeIds', node.id)} className="action-btn remove"><Package size={12} /> Unwrap Node</button>
            )}
            {!isHidden ? (
              <button onClick={() => cb.onAddToArray('hiddenNodeIds', node.id)} className="action-btn"><EyeOff size={12} /> Hide Node</button>
            ) : (
              <button onClick={() => cb.onRemoveFromArray('hiddenNodeIds', node.id)} className="action-btn remove"><Eye size={12} /> Show Node</button>
            )}
            {hasLabelToToggle && (
              isLabelHidden ? (
                <button onClick={() => cb.onToggleLabelHidden(node.id)} className="action-btn remove" title="Show node label"><Tag size={12} /> Show Label</button>
              ) : (
                <button onClick={() => cb.onToggleLabelHidden(node.id)} className="action-btn" title="Hide node label"><Tag size={12} /> Hide Label</button>
              )
            )}
            <div className="more-menu-wrapper">
              <button onClick={(e) => { e.stopPropagation(); cb.onSetMoreMenu(moreMenuOpen === node.id ? null : node.id) }} className={`action-btn more-menu-btn ${moreMenuOpen === node.id ? 'active' : ''}`} title="More options">
                <MoreVertical size={12} /> More
              </button>
              {moreMenuOpen === node.id && (
                <div className="more-menu-dropdown">
                  {!isInput ? (
                    <button onClick={() => { cb.onAddToArray('input_ids', node.id); cb.onSetMoreMenu(null) }} className="more-menu-item"><Plus size={12} /> Add to Input IDs</button>
                  ) : (
                    <button onClick={() => { cb.onRemoveFromArray('input_ids', node.id); cb.onSetMoreMenu(null) }} className="more-menu-item remove"><X size={12} /> Remove from Input IDs</button>
                  )}
                  {!isOutput ? (
                    <button onClick={() => { cb.onAddToArray('output_ids', node.id); cb.onSetMoreMenu(null) }} className="more-menu-item"><Plus size={12} /> Add to Output IDs</button>
                  ) : (
                    <button onClick={() => { cb.onRemoveFromArray('output_ids', node.id); cb.onSetMoreMenu(null) }} className="more-menu-item remove"><X size={12} /> Remove from Output IDs</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {hasParser && (
            <div className="node-parser-config">
              <strong>Parser Configuration:</strong>
              <pre className="parser-config-preview">{JSON.stringify(nodeParser, null, 2)}</pre>
            </div>
          )}

          {node.inputs && Object.keys(node.inputs).length > 0 && (
            <div className="node-inputs">
              <strong>Inputs:</strong>
              <div className="inputs-list">
                {Object.entries(node.inputs).map(([key, value]) => {
                  const fieldParser = (nodeParser as Record<string, Record<string, unknown>> | null)?.inputs?.[key]
                  return (
                    <div key={key} className="input-item">
                      <span className="input-key">
                        {key}
                        {fieldParser === false && <span className="field-hidden-badge">Hidden</span>}
                        {fieldParser && typeof fieldParser === 'object' && (
                          <span className="field-parsed-badge">{(fieldParser as Record<string, unknown>).type as string || 'Parsed'}</span>
                        )}
                        :
                      </span>
                      <span className="input-value">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
