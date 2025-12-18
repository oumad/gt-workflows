import { useState, useMemo, useCallback } from 'react'
import { WorkflowParams } from '../types'
import { 
  Search, Plus, X, Eye, EyeOff, Package, Settings, 
  ArrowRight, ArrowDown, Info, Edit2
} from 'lucide-react'
import NodeParserEditor from './NodeParserEditor'
import './NodeManager.css'

interface NodeManagerProps {
  workflowJson: any
  params: WorkflowParams
  onUpdateParams: (updatedParams: WorkflowParams) => void
}

interface NodeInfo {
  id: string
  class_type: string
  title?: string
  inputs?: Record<string, any>
  _meta?: { title?: string }
}

export default function NodeManager({ workflowJson, params, onUpdateParams }: NodeManagerProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'input' | 'output' | 'all' | 'appinfo'>('input')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [expandedSubgraphs, setExpandedSubgraphs] = useState<Set<string>>(new Set())
  const [groupBySubgraph, setGroupBySubgraph] = useState(true)
  const [editingParser, setEditingParser] = useState<{ nodeId: string; nodeType: string; nodeInputs: Record<string, any> } | null>(null)

  // Extract nodes from workflow JSON
  const nodes = useMemo(() => {
    if (!workflowJson) return []
    const nodeList: NodeInfo[] = []
    for (const [id, node] of Object.entries(workflowJson)) {
      if (typeof node === 'object' && node !== null && 'class_type' in node) {
        nodeList.push({ id, ...(node as any) })
      }
    }
    return nodeList
  }, [workflowJson])

  // Find AppInfo nodes
  const appInfoNodes = useMemo(() => {
    return nodes.filter(node => 
      node.class_type === 'AppInfo' || 
      node.class_type?.includes('AppInfo')
    )
  }, [nodes])

  // Extract input_ids and output_ids from AppInfo nodes
  const appInfoInputIds = useMemo(() => {
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      if (node.inputs?.input_ids) {
        let inputIds: string[] = []
        
        if (Array.isArray(node.inputs.input_ids)) {
          // Already an array
          inputIds = node.inputs.input_ids.map(String)
        } else {
          // String - parse comma, space, or newline separated values
          const str = String(node.inputs.input_ids)
          inputIds = str
            .split(/[,\s\n]+/)
            .map(id => id.trim())
            .filter(id => id.length > 0)
        }
        
        ids.push(...inputIds)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes])

  const appInfoOutputIds = useMemo(() => {
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      if (node.inputs?.output_ids) {
        let outputIds: string[] = []
        
        if (Array.isArray(node.inputs.output_ids)) {
          // Already an array
          outputIds = node.inputs.output_ids.map(String)
        } else {
          // String - parse comma, space, or newline separated values
          const str = String(node.inputs.output_ids)
          outputIds = str
            .split(/[,\s\n]+/)
            .map(id => id.trim())
            .filter(id => id.length > 0)
        }
        
        ids.push(...outputIds)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes])

  // Get configured input/output IDs from params
  const configuredInputIds = params.comfyui_config?.input_ids || []
  const configuredOutputIds = params.comfyui_config?.output_ids || []
  const hiddenNodeIds = params.comfyui_config?.hiddenNodeIds || []
  const wrappedNodeIds = params.comfyui_config?.wrappedNodeIds || []
  
  // Check if input_ids/output_ids are explicitly set (overriding AppInfo)
  const hasExplicitInputIds = params.comfyui_config?.input_ids !== undefined
  const hasExplicitOutputIds = params.comfyui_config?.output_ids !== undefined

  // Helper function to get node parser
  const getNodeParser = useCallback((nodeId: string) => {
    return params.comfyui_config?.node_parsers?.input_nodes?.[nodeId]
  }, [params.comfyui_config?.node_parsers])

  // Determine which nodes are inputs/outputs
  // Include subgraph nodes if they have parsers configured (they are parsed)
  const inputNodes = useMemo(() => {
    const ids = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    const explicitInputNodes = nodes.filter(node => ids.includes(node.id))
    
    // Also include subgraph nodes (nodes with ":" in ID) that have parsers configured
    const nodeParsers = params.comfyui_config?.node_parsers?.input_nodes || {}
    const subgraphNodesWithParsers = nodes.filter(node => {
      // Check if it's a subgraph node (contains ":")
      if (!node.id.includes(':')) return false
      // Check if it has a parser configured
      return !!nodeParsers[node.id]
    })
    
    // Combine and deduplicate
    const allInputNodes = [...explicitInputNodes, ...subgraphNodesWithParsers]
    const uniqueNodes = Array.from(new Map(allInputNodes.map(node => [node.id, node])).values())
    return uniqueNodes
  }, [nodes, configuredInputIds, appInfoInputIds, params.comfyui_config?.node_parsers])

  const outputNodes = useMemo(() => {
    const ids = configuredOutputIds.length > 0 ? configuredOutputIds : appInfoOutputIds
    return nodes.filter(node => ids.includes(node.id))
  }, [nodes, configuredOutputIds, appInfoOutputIds])

  // Group nodes by subgraph
  const groupedNodes = useMemo(() => {
    const topLevel: NodeInfo[] = []
    const subgraphGroups: Record<string, NodeInfo[]> = {}
    
    let nodesToGroup = nodes
    if (selectedCategory === 'input') nodesToGroup = inputNodes
    else if (selectedCategory === 'output') nodesToGroup = outputNodes
    else if (selectedCategory === 'appinfo') nodesToGroup = appInfoNodes

    // Filter by search term if provided
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      nodesToGroup = nodesToGroup.filter(node => 
        node.id.toLowerCase().includes(term) ||
        node.class_type?.toLowerCase().includes(term) ||
        node._meta?.title?.toLowerCase().includes(term) ||
        node.title?.toLowerCase().includes(term)
      )
    }

    // Group nodes
    nodesToGroup.forEach(node => {
      if (node.id.includes(':')) {
        const subgraphId = node.id.split(':')[0]
        if (!subgraphGroups[subgraphId]) {
          subgraphGroups[subgraphId] = []
        }
        subgraphGroups[subgraphId].push(node)
      } else {
        topLevel.push(node)
      }
    })

    // Sort subgraph groups and their nodes
    Object.keys(subgraphGroups).forEach(key => {
      subgraphGroups[key].sort((a, b) => {
        const aChild = a.id.split(':')[1]
        const bChild = b.id.split(':')[1]
        return aChild.localeCompare(bChild)
      })
    })

    return { topLevel, subgraphGroups }
  }, [nodes, inputNodes, outputNodes, appInfoNodes, selectedCategory, searchTerm])

  // Get subgraph labels from params
  const getSubgraphLabel = (subgraphId: string) => {
    return params.comfyui_config?.subgraphs?.[subgraphId]?.label || `Subgraph ${subgraphId}`
  }

  // Filter nodes based on search and category (for backward compatibility)
  const filteredNodes = useMemo(() => {
    let filtered = nodes
    if (selectedCategory === 'input') filtered = inputNodes
    else if (selectedCategory === 'output') filtered = outputNodes
    else if (selectedCategory === 'appinfo') filtered = appInfoNodes

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(node => 
        node.id.toLowerCase().includes(term) ||
        node.class_type?.toLowerCase().includes(term) ||
        node._meta?.title?.toLowerCase().includes(term) ||
        node.title?.toLowerCase().includes(term)
      )
    }
    return filtered
  }, [nodes, inputNodes, outputNodes, appInfoNodes, selectedCategory, searchTerm])

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  const toggleSubgraph = (subgraphId: string) => {
    const newExpanded = new Set(expandedSubgraphs)
    if (newExpanded.has(subgraphId)) {
      newExpanded.delete(subgraphId)
    } else {
      newExpanded.add(subgraphId)
    }
    setExpandedSubgraphs(newExpanded)
  }

  const addToArray = (arrayName: 'input_ids' | 'output_ids' | 'hiddenNodeIds' | 'wrappedNodeIds', nodeId: string) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: '',
      }
    }
    
    const currentArray = updatedParams.comfyui_config[arrayName] || []
    if (!currentArray.includes(nodeId)) {
      updatedParams.comfyui_config[arrayName] = [...currentArray, nodeId]
      onUpdateParams(updatedParams)
    }
  }

  const removeFromArray = (arrayName: 'input_ids' | 'output_ids' | 'hiddenNodeIds' | 'wrappedNodeIds', nodeId: string) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) return
    
    let currentArray = updatedParams.comfyui_config[arrayName] || []
    
    // If array is empty and we're removing from input_ids/output_ids, 
    // we need to initialize it from AppInfo to exclude the node
    if (currentArray.length === 0 && (arrayName === 'input_ids' || arrayName === 'output_ids')) {
      if (arrayName === 'input_ids') {
        currentArray = [...appInfoInputIds]
      } else if (arrayName === 'output_ids') {
        currentArray = [...appInfoOutputIds]
      }
    }
    
    updatedParams.comfyui_config[arrayName] = currentArray.filter(id => id !== nodeId)
    onUpdateParams(updatedParams)
  }

  const handleSaveParser = (nodeId: string, parserConfig: any) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: '',
      }
    }
    
    if (!updatedParams.comfyui_config.node_parsers) {
      updatedParams.comfyui_config.node_parsers = {}
    }
    
    if (!updatedParams.comfyui_config.node_parsers.input_nodes) {
      updatedParams.comfyui_config.node_parsers.input_nodes = {}
    }
    
    updatedParams.comfyui_config.node_parsers.input_nodes[nodeId] = parserConfig
    onUpdateParams(updatedParams)
    setEditingParser(null)
  }

  const formatNodeValue = (value: any): string => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') {
      // Truncate long strings
      if (value.length > 50) return value.substring(0, 47) + '...'
      return value
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      if (value.length === 1) return `[${formatNodeValue(value[0])}]`
      return `[${value.length} items]`
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 0) return '{}'
      if (keys.length === 1) {
        return `{${keys[0]}: ${formatNodeValue(value[keys[0]])}}`
      }
      return `{${keys.length} fields}`
    }
    return String(value)
  }

  const getNodeValuePreview = (node: NodeInfo): string | null => {
    if (!node.inputs || Object.keys(node.inputs).length === 0) return null
    
    const inputKeys = Object.keys(node.inputs)
    
    // Single input: show the value
    if (inputKeys.length === 1) {
      const key = inputKeys[0]
      const value = node.inputs[key]
      // Skip if it's a node reference (array with node ID)
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return null
      }
      return `${key}: ${formatNodeValue(value)}`
    }
    
    // Multiple inputs: show summary
    // Try to find a "text" or "value" field first (common in ComfyUI)
    const priorityFields = ['text', 'value', 'prompt', 'seed', 'steps', 'width', 'height']
    for (const field of priorityFields) {
      if (node.inputs[field] !== undefined) {
        const value = node.inputs[field]
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
          continue // Skip node references
        }
        return `${field}: ${formatNodeValue(value)}`
      }
    }
    
    // Otherwise show count
    return `${inputKeys.length} inputs`
  }

  const renderNode = (node: NodeInfo) => {
    const isExpanded = expandedNodes.has(node.id)
    const isInput = inputNodes.some(n => n.id === node.id)
    const isOutput = outputNodes.some(n => n.id === node.id)
    const isHidden = hiddenNodeIds.includes(node.id)
    const isWrapped = wrappedNodeIds.includes(node.id)
    const nodeParser = getNodeParser(node.id)
    const hasParser = !!nodeParser
    const valuePreview = !isExpanded ? getNodeValuePreview(node) : null

    return (
      <div key={node.id} className="node-item">
        <div className="node-header">
          <div className="node-header-left" onClick={() => toggleNode(node.id)}>
            <div className="node-expand-icon">
              {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
            </div>
            <div className="node-id-section">
              <span className="node-id">{node.id}</span>
            </div>
            <div className="node-type-section">
              <span className="node-type">{node.class_type}</span>
            </div>
            <div className="node-title-section">
              {(node._meta?.title || node.title) && (
                <span className="node-title">{node._meta?.title || node.title}</span>
              )}
            </div>
            <div className="node-badges-section">
              {isInput && <span className="node-badge input-badge">Input</span>}
              {isOutput && <span className="node-badge output-badge">Output</span>}
              {isHidden && <span className="node-badge hidden-badge">Hidden</span>}
              {isWrapped && <span className="node-badge wrapped-badge">Wrapped</span>}
              {hasParser && <span className="node-badge parser-badge">Parsed</span>}
            </div>
            <div className="node-value-section">
              {valuePreview && (
                <span 
                  className="node-value-preview" 
                  title={valuePreview}
                >
                  {valuePreview}
                </span>
              )}
            </div>
          </div>
          <div className="node-header-actions" onClick={(e) => e.stopPropagation()}>
            {!isHidden ? (
              <button
                onClick={() => addToArray('hiddenNodeIds', node.id)}
                className="node-quick-action-btn"
                title="Hide this node from UI"
              >
                <EyeOff size={14} />
              </button>
            ) : (
              <button
                onClick={() => removeFromArray('hiddenNodeIds', node.id)}
                className="node-quick-action-btn node-quick-action-btn-active"
                title="Show this node in UI"
              >
                <Eye size={14} />
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="node-details">
            <div className="node-actions">
              {!isInput && (
                <button
                  onClick={() => addToArray('input_ids', node.id)}
                  className="action-btn"
                >
                  <Plus size={12} /> Add to Input IDs
                </button>
              )}
              {isInput && (
                <button
                  onClick={() => removeFromArray('input_ids', node.id)}
                  className="action-btn remove"
                >
                  <X size={12} /> Remove from Input IDs
                </button>
              )}
              {!isOutput && (
                <button
                  onClick={() => addToArray('output_ids', node.id)}
                  className="action-btn"
                >
                  <Plus size={12} /> Add to Output IDs
                </button>
              )}
              {isOutput && (
                <button
                  onClick={() => removeFromArray('output_ids', node.id)}
                  className="action-btn remove"
                >
                  <X size={12} /> Remove from Output IDs
                </button>
              )}
              {!isHidden && (
                <button
                  onClick={() => addToArray('hiddenNodeIds', node.id)}
                  className="action-btn"
                >
                  <EyeOff size={12} /> Hide Node
                </button>
              )}
              {isHidden && (
                <button
                  onClick={() => removeFromArray('hiddenNodeIds', node.id)}
                  className="action-btn remove"
                >
                  <Eye size={12} /> Show Node
                </button>
              )}
              {!isWrapped && (
                <button
                  onClick={() => addToArray('wrappedNodeIds', node.id)}
                  className="action-btn"
                >
                  <Package size={12} /> Wrap Node
                </button>
              )}
              {isWrapped && (
                <button
                  onClick={() => removeFromArray('wrappedNodeIds', node.id)}
                  className="action-btn remove"
                >
                  <Package size={12} /> Unwrap Node
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const currentNode = nodes.find(n => n.id === node.id)
                  if (currentNode) {
                    setEditingParser({
                      nodeId: currentNode.id,
                      nodeType: currentNode.class_type,
                      nodeInputs: currentNode.inputs || {}
                    })
                  }
                }}
                className={`action-btn ${hasParser ? 'parser' : ''}`}
                title={hasParser ? 'Edit parser config' : 'Configure parser'}
              >
                <Edit2 size={12} /> {hasParser ? 'Edit Parser' : 'Configure Parser'}
              </button>
            </div>

            {hasParser && (
              <div className="node-parser-config">
                <strong>Parser Configuration:</strong>
                <pre className="parser-config-preview">
                  {JSON.stringify(nodeParser, null, 2)}
                </pre>
              </div>
            )}

            {node.inputs && Object.keys(node.inputs).length > 0 && (
              <div className="node-inputs">
                <strong>Inputs:</strong>
                <div className="inputs-list">
                  {Object.entries(node.inputs).map(([key, value]) => {
                    const fieldParser = nodeParser?.inputs?.[key]
                    return (
                      <div key={key} className="input-item">
                        <span className="input-key">
                          {key}
                          {fieldParser === false && <span className="field-hidden-badge">Hidden</span>}
                          {fieldParser && typeof fieldParser === 'object' && (
                            <span className="field-parsed-badge">{fieldParser.type || 'Parsed'}</span>
                          )}
                          :
                        </span>
                        <span className="input-value">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
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

  if (!workflowJson || params.parser !== 'comfyui') {
    return null
  }

  return (
    <div className="node-manager">
      <div className="node-manager-header">
        <h3>
          <Settings size={20} />
          Node Manager
        </h3>
        <div className="node-manager-controls">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="category-tabs">
            <button
              className={selectedCategory === 'input' ? 'active' : ''}
              onClick={() => setSelectedCategory('input')}
            >
              Input ({inputNodes.length})
            </button>
            <button
              className={selectedCategory === 'output' ? 'active' : ''}
              onClick={() => setSelectedCategory('output')}
            >
              Output ({outputNodes.length})
            </button>
            <button
              className={selectedCategory === 'appinfo' ? 'active' : ''}
              onClick={() => setSelectedCategory('appinfo')}
            >
              AppInfo ({appInfoNodes.length})
            </button>
            <button
              className={selectedCategory === 'all' ? 'active' : ''}
              onClick={() => setSelectedCategory('all')}
            >
              All ({nodes.length})
            </button>
            <button
              className={`group-toggle ${groupBySubgraph ? 'active' : ''}`}
              onClick={() => setGroupBySubgraph(!groupBySubgraph)}
              title={groupBySubgraph ? 'Show flat list' : 'Group by subgraph'}
            >
              <Package size={14} />
              {groupBySubgraph ? 'Grouped' : 'Flat'}
            </button>
          </div>
        </div>
      </div>

      {appInfoNodes.length > 0 && (
        <div className="appinfo-banner">
          <Info size={16} />
          <span>
            Found {appInfoNodes.length} AppInfo node(s). 
            {appInfoInputIds.length > 0 && ` ${appInfoInputIds.length} input node(s) exposed.`}
            {appInfoOutputIds.length > 0 && ` ${appInfoOutputIds.length} output node(s) exposed.`}
          </span>
        </div>
      )}

      {(hasExplicitInputIds || hasExplicitOutputIds) && (
        <div className="explicit-config-banner">
          <Info size={16} />
          <span>
            {hasExplicitInputIds && "Input IDs are explicitly set in params.json (overriding AppInfo). "}
            {hasExplicitOutputIds && "Output IDs are explicitly set in params.json (overriding AppInfo)."}
          </span>
        </div>
      )}

      <div className="nodes-list">
        {filteredNodes.length > 0 && (
          <>
            <div className="nodes-list-header">
              <div></div>
              <div>ID</div>
              <div>Type</div>
              <div>Title</div>
              <div>Status</div>
              <div>Value</div>
              <div></div>
            </div>
            {groupBySubgraph ? (
              <>
                {/* Top-level nodes */}
                {groupedNodes.topLevel.length > 0 && (
                  <div className="node-group">
                    <div className="node-group-header">
                      <span className="group-label">Top-Level Nodes</span>
                      <span className="group-count">({groupedNodes.topLevel.length})</span>
                    </div>
                    <div className="node-group-content">
                      {groupedNodes.topLevel.map(renderNode)}
                    </div>
                  </div>
                )}
                {/* Subgraph groups */}
                {Object.entries(groupedNodes.subgraphGroups)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([subgraphId, subgraphNodes]) => {
                    const isExpanded = expandedSubgraphs.has(subgraphId)
                    const subgraphLabel = getSubgraphLabel(subgraphId)
                    return (
                      <div key={subgraphId} className="node-group subgraph-group">
                        <div 
                          className="node-group-header subgraph-header" 
                          onClick={() => toggleSubgraph(subgraphId)}
                        >
                          <div className="subgraph-expand-icon">
                            {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
                          </div>
                          <span className="group-label">{subgraphLabel}</span>
                          <span className="group-count">({subgraphNodes.length})</span>
                          <span className="subgraph-id">ID: {subgraphId}</span>
                        </div>
                        {isExpanded && (
                          <div className="node-group-content subgraph-content">
                            {subgraphNodes.map(renderNode)}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </>
            ) : (
              filteredNodes.map(renderNode)
            )}
          </>
        )}
        {filteredNodes.length === 0 && (
          <div className="empty-nodes">
            <p>No nodes found</p>
          </div>
        )}
      </div>

      {editingParser && (
        <NodeParserEditor
          nodeId={editingParser.nodeId}
          nodeType={editingParser.nodeType}
          nodeInputs={editingParser.nodeInputs}
          currentParser={getNodeParser(editingParser.nodeId)}
          onSave={(parserConfig) => handleSaveParser(editingParser.nodeId, parserConfig)}
          onClose={() => setEditingParser(null)}
        />
      )}
    </div>
  )
}

