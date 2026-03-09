import type { WorkflowParams } from '@/types'
import { Search, Settings, ArrowRight, ArrowDown, Info, Package, Edit2, X, Check } from 'lucide-react'
import NodeParserEditor from './NodeParserEditor'
import { NodeRow } from './NodeRow'
import { useNodeManager } from './useNodeManager'
import './NodeManager.css'

interface NodeManagerProps {
  workflowJson: Record<string, unknown>
  params: WorkflowParams
  onUpdateParams: (updatedParams: WorkflowParams) => void
}

export default function NodeManager({ workflowJson, params, onUpdateParams }: NodeManagerProps) {
  const nm = useNodeManager(workflowJson, params, onUpdateParams)

  if (!workflowJson || params.parser !== 'comfyui') return null

  return (
    <div className="node-manager">
      <div className="node-manager-header">
        <h3><Settings size={20} /> Node Manager</h3>
        <div className="node-manager-controls">
          <div className="search-box">
            <Search size={16} />
            <input type="text" placeholder="Search nodes..." value={nm.searchTerm} onChange={(e) => nm.setSearchTerm(e.target.value)} className="search-input" />
          </div>
          <div className="category-tabs">
            <button className={nm.selectedCategory === 'input' ? 'active' : ''} onClick={() => nm.setSelectedCategory('input')}>Input ({nm.inputNodes.length})</button>
            <button className={nm.selectedCategory === 'output' ? 'active' : ''} onClick={() => nm.setSelectedCategory('output')}>Output ({nm.outputNodes.length})</button>
            <button className={nm.selectedCategory === 'appinfo' ? 'active' : ''} onClick={() => nm.setSelectedCategory('appinfo')}>AppInfo ({nm.appInfoNodes.length})</button>
            <button className={nm.selectedCategory === 'all' ? 'active' : ''} onClick={() => nm.setSelectedCategory('all')}>All ({nm.nodes.length})</button>
            <button className={`group-toggle ${nm.groupBySubgraph ? 'active' : ''}`} onClick={() => nm.setGroupBySubgraph(!nm.groupBySubgraph)} title={nm.groupBySubgraph ? 'Show flat list' : 'Group by subgraph'}>
              <Package size={14} /> {nm.groupBySubgraph ? 'Grouped' : 'Flat'}
            </button>
          </div>
        </div>
      </div>

      {nm.appInfoNodes.length > 0 && (
        <div className="appinfo-banner">
          <Info size={16} />
          <span>
            Found {nm.appInfoNodes.length} AppInfo node(s).
            {nm.appInfoInputIds.length > 0 && ` ${nm.appInfoInputIds.length} input node(s) exposed.`}
            {nm.appInfoOutputIds.length > 0 && ` ${nm.appInfoOutputIds.length} output node(s) exposed.`}
          </span>
        </div>
      )}

      {(nm.hasExplicitInputIds || nm.hasExplicitOutputIds) && (
        <div className="explicit-config-banner">
          <Info size={16} />
          <span>
            {nm.hasExplicitInputIds && 'Input IDs are explicitly set in params.json (overriding AppInfo). '}
            {nm.hasExplicitOutputIds && 'Output IDs are explicitly set in params.json (overriding AppInfo).'}
          </span>
        </div>
      )}

      <div className="nodes-list">
        {nm.filteredNodes.length > 0 && (
          <>
            <div className="nodes-list-header">
              <div></div><div>ID</div><div>Title</div><div>Type</div><div>Status</div><div>Value</div><div></div>
            </div>
            {nm.groupBySubgraph ? (
              <>
                {nm.groupedNodes.topLevel.length > 0 && (
                  <div className="node-group">
                    <div className="node-group-header">
                      <span className="group-label">Top-Level Nodes</span>
                      <span className="group-count">({nm.groupedNodes.topLevel.length})</span>
                    </div>
                    <div className="node-group-content">
                      {nm.groupedNodes.topLevel.map((node, i) => (
                        <NodeRow key={node.id} node={node} nodeIndex={i} totalNodes={nm.groupedNodes.topLevel.length} expandedNodes={nm.expandedNodes} moreMenuOpen={nm.moreMenuOpen} inputNodes={nm.inputNodes} outputNodes={nm.outputNodes} hiddenNodeIds={nm.hiddenNodeIds} wrappedNodeIds={nm.wrappedNodeIds} cb={nm.callbacks} />
                      ))}
                    </div>
                  </div>
                )}
                {Object.entries(nm.groupedNodes.subgraphGroups).sort(([a], [b]) => a.localeCompare(b)).map(([sgId, sgNodes]) => {
                  const isExpanded = nm.expandedSubgraphs.has(sgId)
                  const sgLabel = nm.getSubgraphLabel(sgId)
                  const isWrapped = nm.wrappedNodeIds.includes(sgId)
                  return (
                    <div key={sgId} className="node-group subgraph-group">
                      <div className="node-group-header subgraph-header" onClick={(e) => {
                        if ((e.target as HTMLElement).closest('.subgraph-label-edit') || (e.target as HTMLElement).closest('.subgraph-header-actions')) return
                        nm.toggleSubgraph(sgId)
                      }}>
                        <div className="subgraph-expand-icon">{isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}</div>
                        {nm.editingSubgraphLabel === sgId ? (
                          <div className="subgraph-label-edit" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text" value={nm.subgraphLabelValue}
                              onChange={(e) => nm.setSubgraphLabelValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') nm.updateSubgraphLabel(sgId, nm.subgraphLabelValue); else if (e.key === 'Escape') nm.cancelEditingSubgraphLabel() }}
                              onBlur={() => nm.updateSubgraphLabel(sgId, nm.subgraphLabelValue)}
                              autoFocus className="subgraph-label-input" placeholder={`Subgraph ${sgId}`}
                            />
                            <button onClick={() => nm.updateSubgraphLabel(sgId, nm.subgraphLabelValue)} className="subgraph-label-save-btn" title="Save"><Check size={14} /></button>
                            <button onClick={nm.cancelEditingSubgraphLabel} className="subgraph-label-cancel-btn" title="Cancel"><X size={14} /></button>
                          </div>
                        ) : (
                          <span className="group-label subgraph-label-clickable" onClick={(e) => { e.stopPropagation(); nm.startEditingSubgraphLabel(sgId) }} title="Click to edit label">
                            {sgLabel}
                          </span>
                        )}
                        <span className="group-count">({sgNodes.length})</span>
                        <span className="subgraph-id">ID: {sgId}</span>
                        {isWrapped && <span className="node-badge wrapped-badge" style={{ marginLeft: '8px' }}>Wrapped</span>}
                        <div className="subgraph-header-actions" onClick={(e) => e.stopPropagation()}>
                          {!isWrapped ? (
                            <button onClick={() => nm.callbacks.onAddToArray('wrappedNodeIds', sgId)} className="subgraph-action-btn" title="Wrap subgraph"><Package size={14} /></button>
                          ) : (
                            <button onClick={() => nm.callbacks.onRemoveFromArray('wrappedNodeIds', sgId)} className="subgraph-action-btn subgraph-action-btn-active" title="Unwrap subgraph"><Package size={14} /></button>
                          )}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="node-group-content subgraph-content">
                          {sgNodes.map((node, i) => (
                            <NodeRow key={node.id} node={node} subgraphId={sgId} nodeIndex={i} totalNodes={sgNodes.length} expandedNodes={nm.expandedNodes} moreMenuOpen={nm.moreMenuOpen} inputNodes={nm.inputNodes} outputNodes={nm.outputNodes} hiddenNodeIds={nm.hiddenNodeIds} wrappedNodeIds={nm.wrappedNodeIds} cb={nm.callbacks} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            ) : (
              nm.filteredNodes.map((node, i) => (
                <NodeRow key={node.id} node={node} nodeIndex={i} totalNodes={nm.filteredNodes.length} expandedNodes={nm.expandedNodes} moreMenuOpen={nm.moreMenuOpen} inputNodes={nm.inputNodes} outputNodes={nm.outputNodes} hiddenNodeIds={nm.hiddenNodeIds} wrappedNodeIds={nm.wrappedNodeIds} cb={nm.callbacks} />
              ))
            )}
          </>
        )}
        {nm.filteredNodes.length === 0 && <div className="empty-nodes"><p>No nodes found</p></div>}
      </div>

      {nm.editingParser && (
        <NodeParserEditor
          nodeId={nm.editingParser.nodeId}
          nodeType={nm.editingParser.nodeType}
          nodeInputs={nm.editingParser.nodeInputs}
          currentParser={nm.getNodeParser(nm.editingParser.nodeId)}
          workflowJson={workflowJson}
          params={params}
          onSave={(parserConfig) => nm.handleSaveParser(nm.editingParser!.nodeId, parserConfig)}
          onClose={() => nm.setEditingParser(null)}
        />
      )}
    </div>
  )
}
