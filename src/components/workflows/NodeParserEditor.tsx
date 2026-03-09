import { X, Save, Plus, Copy, ClipboardPaste } from 'lucide-react'
import { NodeVisibilityEditor } from './NodeVisibilityEditor'
import { FieldEditor } from './FieldEditor'
import { useNodeParserEditor } from './useNodeParserEditor'
import './NodeParserEditor.css'

interface NodeParserEditorProps {
  nodeId: string
  nodeType: string
  nodeInputs: Record<string, unknown>
  currentParser: Record<string, unknown>
  workflowJson?: Record<string, unknown>
  params?: Record<string, unknown>
  onSave: (parserConfig: Record<string, unknown>) => void
  onClose: () => void
}

export interface InputFieldConfig {
  type: string | boolean
  label?: string | boolean
  default?: unknown
  required?: boolean
  min?: number | string
  max?: number | string
  step?: number | string
  accept?: string[]
  options?: unknown[]
  drawMaskEnable?: boolean
  maskNode?: { nodeId: string }
  fetchUrl?: string
  connectTo?: unknown
  [key: string]: unknown
}

export default function NodeParserEditor({ nodeId, nodeType, nodeInputs, currentParser, workflowJson, params, onSave, onClose }: NodeParserEditorProps) {
  const ed = useNodeParserEditor(currentParser, onSave)

  const availableFields = Object.keys(nodeInputs || {})
  const configuredFields = Object.keys(ed.inputConfigs)
  const unconfiguredFields = availableFields.filter(f => !configuredFields.includes(f) && !ed.hiddenFields.has(f))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content parser-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Configure Node Parser</h2>
            <p className="modal-subtitle">Node {nodeId} ({nodeType})</p>
          </div>
          <button onClick={onClose} className="modal-close"><X size={20} /></button>
        </div>

        <div className="modal-body parser-editor-body">
          <div className="node-visibility-section" style={{ marginBottom: '24px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div>
                <h3 style={{ marginTop: 0, marginBottom: '4px' }}>Node Visibility Control</h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9em' }}>Control this node's visibility based on another node's field value.</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                <button type="button" onClick={ed.copyFullParser} disabled={Object.keys(ed.inputConfigs).length === 0 && ed.hiddenFields.size === 0 && !(ed.nodeConnectTo?.nodeId && ed.nodeConnectTo?.inputField && ed.nodeConnectTo?.conditions?.length)} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '0.85rem' }} title="Copy full parser (inputs + visibility) to reuse on another node">
                  <Copy size={14} />{ed.copiedFeedback ? 'Copied!' : 'Copy parser'}
                </button>
                {ed.hasCopiedNodeParser() && (
                  <button type="button" onClick={ed.pasteFullParser} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '0.85rem' }} title="Paste parser (inputs + visibility) from another node">
                    <ClipboardPaste size={14} />Paste parser
                  </button>
                )}
                <button type="button" onClick={ed.copyVisibilityConditions} disabled={!ed.nodeConnectTo?.nodeId || !ed.nodeConnectTo?.inputField || !ed.nodeConnectTo?.conditions?.length} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '0.85rem' }} title="Copy visibility conditions only to reuse on another node">
                  <Copy size={14} />Copy conditions
                </button>
                {ed.hasCopiedConnectTo() && (
                  <button type="button" onClick={ed.pasteVisibilityConditions} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '0.85rem' }} title="Paste visibility conditions only from another node">
                    <ClipboardPaste size={14} />Paste conditions
                  </button>
                )}
              </div>
            </div>
            <NodeVisibilityEditor connectTo={ed.nodeConnectTo} currentNodeId={nodeId} workflowJson={workflowJson} params={params} onChange={ed.setNodeConnectTo} />
          </div>

          {availableFields.length === 0 ? (
            <div className="empty-state"><p>No input fields found for this node</p></div>
          ) : (
            <>
              <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Input Field Configuration</h3>
              {configuredFields.map(f => (
                <FieldEditor
                  key={f}
                  fieldName={f}
                  config={ed.inputConfigs[f]}
                  nodeId={nodeId}
                  workflowJson={workflowJson}
                  params={params}
                  onUpdate={ed.updateFieldConfig}
                  onRemove={ed.removeFieldConfig}
                  onToggleHidden={ed.toggleFieldHidden}
                />
              ))}

              {ed.hiddenFields.size > 0 && (
                <div className="hidden-fields">
                  <h4>Hidden Fields</h4>
                  <div className="hidden-fields-list">
                    {Array.from(ed.hiddenFields).map(f => (
                      <div key={f} className="hidden-field-item">
                        <span>{f}</span>
                        <button onClick={() => ed.toggleFieldHidden(f)} className="icon-btn-small"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unconfiguredFields.length > 0 && (
                <div className="unconfigured-fields">
                  <h4>Available Fields</h4>
                  <div className="fields-list">
                    {unconfiguredFields.map(f => (
                      <button key={f} onClick={() => ed.addFieldConfig(f)} className="add-field-btn"><Plus size={14} />{f}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={ed.handleSave} className="btn btn-primary"><Save size={16} />Save Parser Config</button>
        </div>
      </div>
    </div>
  )
}
