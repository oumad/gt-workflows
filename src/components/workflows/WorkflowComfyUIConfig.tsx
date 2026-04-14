import { Settings, FileText, Upload, X, Plus, Trash2 } from 'lucide-react'
import type { WorkflowParams, WorkflowJson, ComfyUIConfig, PowerflowConfig, PowerflowInputEntry, PowerflowOutputEntry } from '@/types'
import NodeManager from './NodeManager'
import { SubgraphEditor } from './SubgraphEditor'
import ServerUrlEditor from '@/components/ui/ServerUrlEditor'
import { getPrimaryServerUrl } from '@/utils/serverUrl'

interface WorkflowComfyUIConfigProps {
  params: WorkflowParams
  workflowJson: WorkflowJson | null
  handleParamsUpdate: (p: WorkflowParams) => void
  isFieldChanged: (field: string) => boolean
  workflowDragOver: boolean
  setWorkflowDragOver: (v: boolean) => void
  setLogsServerUrl: (url: string | null) => void
  handleWorkflowFileUpload: (file: File) => Promise<void>
}

export function WorkflowComfyUIConfig({
  params,
  workflowJson,
  handleParamsUpdate,
  isFieldChanged,
  workflowDragOver,
  setWorkflowDragOver,
  setLogsServerUrl,
  handleWorkflowFileUpload,
}: WorkflowComfyUIConfigProps) {
  if (params.parser !== 'comfyui' || !params.comfyui_config) return null

  const cfg = params.comfyui_config

  const updateCfg = (updates: Partial<ComfyUIConfig>) =>
    handleParamsUpdate({ ...params, comfyui_config: { ...cfg, ...updates } })

  return (
    <div className="detail-section">
      <div className="section-header">
        <Settings size={20} />
        <h2>ComfyUI Config</h2>
      </div>
      <div className="info-grid">
        <div className="info-item info-item-full">
          <label>Server URL</label>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <ServerUrlEditor
                value={cfg.serverUrl}
                onChange={(v) => updateCfg({ serverUrl: v })}
                className={isFieldChanged('comfyui_config.serverUrl') ? 'field-changed' : ''}
                onViewLogs={(url) => setLogsServerUrl(url)}
              />
            </div>
            {cfg.serverUrl && (
              <button
                type="button"
                className="workflow-detail-logs-btn"
                onClick={() => setLogsServerUrl(getPrimaryServerUrl(cfg.serverUrl!))}
                title="View server logs"
              >
                <FileText size={16} />
                Logs
              </button>
            )}
          </div>
        </div>
        <div className="info-item info-item-full">
          <label>Workflow File</label>
          <div className="file-upload-area">
            {cfg.workflow ? (
              <div className="file-info">
                <span>{cfg.workflow.replace(/^\.\//, '')}</span>
                <button
                  type="button"
                  onClick={() => updateCfg({ workflow: undefined })}
                  className="btn-icon"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <label
                className={`file-drop-zone ${workflowDragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setWorkflowDragOver(true) }}
                onDragLeave={() => setWorkflowDragOver(false)}
                onDrop={async (e) => {
                  e.preventDefault()
                  setWorkflowDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file && file.name.endsWith('.json')) await handleWorkflowFileUpload(file)
                }}
              >
                <input
                  type="file"
                  accept=".json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (file) await handleWorkflowFileUpload(file)
                  }}
                  style={{ display: 'none' }}
                />
                <Upload size={20} />
                <span>Click or drop JSON file</span>
              </label>
            )}
          </div>
        </div>
        <div className="info-item">
          <label>Save Output Path</label>
          <input
            type="text"
            value={cfg.saveOutputPath || ''}
            onChange={(e) => updateCfg({ saveOutputPath: e.target.value || undefined })}
            placeholder="/path/to/output"
            className="info-input"
          />
        </div>
        <div className="info-item">
          <label>Skip Output History</label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={cfg.skipOutputHistory === true}
              onChange={(e) => updateCfg({ skipOutputHistory: e.target.checked || undefined })}
            />
            <span>Skip saving outputs to item history</span>
          </label>
        </div>
        <div className="info-item">
          <label>Accepted Image Formats</label>
          <input
            type="text"
            value={cfg.placeholders?.ACCEPTED_IMG_FORMATS ? cfg.placeholders.ACCEPTED_IMG_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              const placeholders = { ...(cfg.placeholders || {}), ACCEPTED_IMG_FORMATS: formats.length > 0 ? formats : undefined }
              const hasValues = Object.values(placeholders).some(v => v !== undefined)
              updateCfg({ placeholders: hasValues ? placeholders : undefined })
            }}
            placeholder="png, jpg, jpeg, webp, bmp"
            className="info-input"
          />
          <small>Comma-separated. Referenced as &lt;ACCEPTED_IMG_FORMATS&gt; in input parsers</small>
        </div>
        <div className="info-item">
          <label>Accepted Video Formats</label>
          <input
            type="text"
            value={cfg.placeholders?.ACCEPTED_VIDEO_FORMATS ? cfg.placeholders.ACCEPTED_VIDEO_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              const placeholders = { ...(cfg.placeholders || {}), ACCEPTED_VIDEO_FORMATS: formats.length > 0 ? formats : undefined }
              const hasValues = Object.values(placeholders).some(v => v !== undefined)
              updateCfg({ placeholders: hasValues ? placeholders : undefined })
            }}
            placeholder="mp4, mov, avi, webm"
            className="info-input"
          />
        </div>
        <div className="info-item">
          <label>Accepted Audio Formats</label>
          <input
            type="text"
            value={cfg.placeholders?.ACCEPTED_AUDIO_FORMATS ? cfg.placeholders.ACCEPTED_AUDIO_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              const placeholders = { ...(cfg.placeholders || {}), ACCEPTED_AUDIO_FORMATS: formats.length > 0 ? formats : undefined }
              const hasValues = Object.values(placeholders).some(v => v !== undefined)
              updateCfg({ placeholders: hasValues ? placeholders : undefined })
            }}
            placeholder="mp3, wav, ogg"
            className="info-input"
          />
        </div>
        <div className="info-item">
          <label>Accepted File Formats</label>
          <input
            type="text"
            value={cfg.placeholders?.ACCEPTED_FILE_FORMATS ? cfg.placeholders.ACCEPTED_FILE_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              const placeholders = { ...(cfg.placeholders || {}), ACCEPTED_FILE_FORMATS: formats.length > 0 ? formats : undefined }
              const hasValues = Object.values(placeholders).some(v => v !== undefined)
              updateCfg({ placeholders: hasValues ? placeholders : undefined })
            }}
            placeholder="glb, gltf, obj"
            className="info-input"
          />
        </div>
        <div className="info-item info-item-full">
          <label>Output Comparator</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={cfg.outputComparator?.inputNodeId || ''}
              onChange={(e) => updateCfg({
                outputComparator: e.target.value
                  ? { ...(cfg.outputComparator || {}), inputNodeId: e.target.value, defaultEnabled: cfg.outputComparator?.defaultEnabled || false }
                  : undefined,
              })}
              placeholder="Input node ID for comparison"
              className="info-input"
              style={{ flex: '1', minWidth: '200px' }}
            />
            {cfg.outputComparator && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={cfg.outputComparator?.defaultEnabled || false}
                    onChange={(e) => updateCfg({
                      outputComparator: {
                        ...(cfg.outputComparator || {}),
                        inputNodeId: cfg.outputComparator?.inputNodeId,
                        defaultEnabled: e.target.checked,
                      },
                    })}
                  />
                  <span>Default Enabled</span>
                </label>
                <button type="button" onClick={() => updateCfg({ outputComparator: undefined })} className="btn-icon">
                  <X size={16} />
                </button>
              </>
            )}
          </div>
          <small>Enable wipe comparison feature for output images/videos</small>
        </div>
        <div className="info-item info-item-full">
          <label>Subgraphs Configuration</label>
          <div style={{ marginTop: '8px' }}>
            {cfg.subgraphs && Object.keys(cfg.subgraphs).length > 0 ? (
              <div className="subgraphs-list">
                {Object.entries(cfg.subgraphs).map(([nodeId, config]) => (
                  <SubgraphEditor
                    key={nodeId}
                    nodeId={nodeId}
                    config={config}
                    workflowJson={workflowJson}
                    onUpdate={(updatedConfig) => updateCfg({ subgraphs: { ...(cfg.subgraphs || {}), [nodeId]: updatedConfig } })}
                    onDelete={() => {
                      const newSubgraphs = { ...(cfg.subgraphs || {}) }
                      delete newSubgraphs[nodeId]
                      updateCfg({ subgraphs: Object.keys(newSubgraphs).length > 0 ? newSubgraphs : undefined })
                    }}
                  />
                ))}
              </div>
            ) : (
              <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <small style={{ color: 'var(--text-secondary)' }}>
                  No subgraphs configured. Use the JSON editor below to add subgraph configurations.
                </small>
              </div>
            )}
          </div>
        </div>
        {/* Powerflow Configuration */}
        <div className="info-item info-item-full">
          <label>Powerflow Configuration</label>
          <PowerflowEditor
            config={cfg.powerflowConfig}
            workflowJson={workflowJson}
            onChange={(powerflowConfig) => updateCfg({ powerflowConfig })}
          />
        </div>
      </div>

      {/* Node Manager */}
      {workflowJson ? (
        <NodeManager workflowJson={workflowJson} params={params} onUpdateParams={handleParamsUpdate} />
      ) : (
        <div className="detail-section">
          <div className="section-header">
            <Settings size={20} />
            <h2>Node Manager</h2>
          </div>
          <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
            <p style={{ marginBottom: '8px', color: 'var(--text-secondary)' }}>
              <strong>Node Manager is not available</strong>
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9em' }}>
              To use the Node Manager, you need to upload a workflow.json file first.
              Use the "Workflow File" field above to upload your ComfyUI workflow JSON file.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Powerflow Editor ── */

interface PowerflowEditorProps {
  config?: PowerflowConfig
  workflowJson: WorkflowJson | null
  onChange: (config: PowerflowConfig | undefined) => void
}

// Class types eligible as powerflow inputs (from CLAUDE.md Input Detection Rules)
const INPUT_NODE_CLASS_TYPES = new Set(['LoadImage', 'TextInput_', 'LoadVideo', 'VHS_LoadVideo'])
// Default field name suggestions by class_type
const FIELD_NAME_BY_CLASS: Record<string, string> = {
  LoadImage: 'image',
  TextInput_: 'text',
  LoadVideo: 'video',
  VHS_LoadVideo: 'video',
}
// Class types eligible as powerflow outputs
const OUTPUT_NODE_CLASS_TYPES = new Set(['SaveImage', 'SaveVideo', 'VHS_VideoCombine', 'SaveImageWebsocket'])

function PowerflowEditor({ config, workflowJson, onChange }: PowerflowEditorProps) {
  const updateConfig = (updates: Partial<PowerflowConfig>) => {
    if (!config) return
    onChange({ ...config, ...updates })
  }

  const updateConnections = (
    side: 'inputs' | 'outputs',
    updater: (list: PowerflowInputEntry[] | PowerflowOutputEntry[]) => PowerflowInputEntry[] | PowerflowOutputEntry[],
  ) => {
    if (!config) return
    const connections = config.availableConnections || { inputs: [], outputs: [] }
    onChange({
      ...config,
      availableConnections: {
        ...connections,
        [side]: updater(connections[side] || []),
      },
    })
  }

  const getNode = (nodeId: string): { inputs?: Record<string, unknown>; class_type?: string; _meta?: { title?: string } } | undefined => {
    if (!workflowJson) return undefined
    return workflowJson[nodeId] as { inputs?: Record<string, unknown>; class_type?: string; _meta?: { title?: string } } | undefined
  }

  const getNodeLabel = (nodeId: string) => {
    const node = getNode(nodeId)
    if (!node) return nodeId
    return node._meta?.title || node.class_type || nodeId
  }

  // Filter to nodes that are valid powerflow inputs / outputs
  const eligibleInputNodes: { id: string; classType: string; title: string }[] = []
  const eligibleOutputNodes: { id: string; classType: string; title: string }[] = []
  if (workflowJson) {
    for (const [id, rawNode] of Object.entries(workflowJson)) {
      const node = rawNode as { class_type?: string; _meta?: { title?: string } }
      const classType = node?.class_type
      if (!classType) continue
      const title = node._meta?.title || classType
      if (INPUT_NODE_CLASS_TYPES.has(classType)) eligibleInputNodes.push({ id, classType, title })
      if (OUTPUT_NODE_CLASS_TYPES.has(classType)) eligibleOutputNodes.push({ id, classType, title })
    }
  }

  // Get available field names for a node (from its inputs keys, plus class-type default)
  const getFieldNames = (nodeId: string): string[] => {
    const node = getNode(nodeId)
    if (!node) return []
    const fields = new Set<string>()
    if (node.class_type && FIELD_NAME_BY_CLASS[node.class_type]) fields.add(FIELD_NAME_BY_CLASS[node.class_type])
    if (node.inputs) {
      for (const key of Object.keys(node.inputs)) {
        // Skip connected fields (arrays) — user wants raw input fields
        if (!Array.isArray((node.inputs as Record<string, unknown>)[key])) fields.add(key)
      }
    }
    return Array.from(fields)
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => onChange({ enabled: true, availableConnections: { inputs: [], outputs: [] } })}
          className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Plus size={14} /> Enable Powerflow
        </button>
        <small style={{ color: 'var(--text-secondary)' }}>Chain this workflow with others in Powerflow</small>
      </div>
    )
  }

  const inputs = config.availableConnections?.inputs || []
  const outputs = config.availableConnections?.outputs || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Toggles */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="checkbox-label">
          <input type="checkbox" checked={config.enabled} onChange={(e) => updateConfig({ enabled: e.target.checked })} />
          <span>Enabled</span>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={config.exclusive || false} onChange={(e) => updateConfig({ exclusive: e.target.checked || undefined })} />
          <span>Exclusive</span>
        </label>
        {config.exclusive && (
          <small style={{ color: 'var(--text-secondary)' }}>Only accessible via Powerflow (hidden from gallery)</small>
        )}
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="btn-icon"
          title="Remove powerflow config"
          style={{ marginLeft: 'auto' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Inputs */}
      <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <strong style={{ fontSize: '0.9em' }}>Inputs</strong>
          <button
            type="button"
            onClick={() => updateConnections('inputs', (list) => [...list, { nodeId: '', fields: [{ name: '' }] }])}
            className="btn btn-secondary"
            disabled={eligibleInputNodes.length === 0}
            style={{ padding: '4px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={12} /> Add Input
          </button>
        </div>
        {!workflowJson && <small style={{ color: 'var(--text-secondary)' }}>Upload a workflow.json to configure connections</small>}
        {workflowJson && eligibleInputNodes.length === 0 && (
          <small style={{ color: 'var(--text-secondary)' }}>No eligible input nodes (LoadImage, TextInput_, LoadVideo) found in workflow</small>
        )}
        {workflowJson && eligibleInputNodes.length > 0 && inputs.length === 0 && (
          <small style={{ color: 'var(--text-secondary)' }}>No input connections defined</small>
        )}
        {inputs.map((input, idx) => {
          const availableFields = input.nodeId ? getFieldNames(input.nodeId) : []
          const currentField = input.fields[0]?.name || ''
          return (
            <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={input.nodeId}
                onChange={(e) => {
                  const newNodeId = e.target.value
                  const node = getNode(newNodeId)
                  const defaultField = node?.class_type ? FIELD_NAME_BY_CLASS[node.class_type] || '' : ''
                  updateConnections('inputs', (list) => (list as PowerflowInputEntry[]).map((item, i) =>
                    i === idx ? { ...item, nodeId: newNodeId, fields: [{ ...item.fields[0], name: defaultField }] } : item,
                  ))
                }}
                className="config-input"
                style={{ width: '220px' }}
              >
                <option value="">Select node…</option>
                {eligibleInputNodes.map(n => (
                  <option key={n.id} value={n.id}>{n.id} — {n.title} ({n.classType})</option>
                ))}
              </select>
              <select
                value={currentField}
                onChange={(e) => updateConnections('inputs', (list) => (list as PowerflowInputEntry[]).map((item, i) => i === idx ? { ...item, fields: [{ ...item.fields[0], name: e.target.value }] } : item))}
                disabled={!input.nodeId}
                className="config-input"
                style={{ width: '150px' }}
              >
                <option value="">Select field…</option>
                {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <input
                type="text"
                value={input.fields[0]?.handleLabel || ''}
                onChange={(e) => updateConnections('inputs', (list) => (list as PowerflowInputEntry[]).map((item, i) => i === idx ? { ...item, fields: [{ ...item.fields[0], handleLabel: e.target.value || undefined }] } : item))}
                placeholder="Handle label (optional)"
                className="config-input"
                style={{ width: '170px' }}
              />
              <button type="button" onClick={() => updateConnections('inputs', (list) => list.filter((_, i) => i !== idx))} className="icon-btn-small" title="Remove"><Trash2 size={14} /></button>
            </div>
          )
        })}
      </div>

      {/* Outputs */}
      <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <strong style={{ fontSize: '0.9em' }}>Outputs</strong>
          <button
            type="button"
            onClick={() => updateConnections('outputs', (list) => [...list, { nodeId: '' }])}
            className="btn btn-secondary"
            disabled={eligibleOutputNodes.length === 0}
            style={{ padding: '4px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={12} /> Add Output
          </button>
        </div>
        {!workflowJson && <small style={{ color: 'var(--text-secondary)' }}>Upload a workflow.json to configure connections</small>}
        {workflowJson && eligibleOutputNodes.length === 0 && (
          <small style={{ color: 'var(--text-secondary)' }}>No eligible output nodes (SaveImage, SaveVideo, VHS_VideoCombine) found in workflow</small>
        )}
        {workflowJson && eligibleOutputNodes.length > 0 && outputs.length === 0 && (
          <small style={{ color: 'var(--text-secondary)' }}>No output connections defined</small>
        )}
        {outputs.map((output, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={output.nodeId}
              onChange={(e) => updateConnections('outputs', (list) => (list as PowerflowOutputEntry[]).map((item, i) => i === idx ? { ...item, nodeId: e.target.value } : item))}
              className="config-input"
              style={{ width: '220px' }}
            >
              <option value="">Select node…</option>
              {eligibleOutputNodes.map(n => (
                <option key={n.id} value={n.id}>{n.id} — {n.title} ({n.classType})</option>
              ))}
            </select>
            <input
              type="text"
              value={output.handleLabel || ''}
              onChange={(e) => updateConnections('outputs', (list) => (list as PowerflowOutputEntry[]).map((item, i) => i === idx ? { ...item, handleLabel: e.target.value || undefined } : item))}
              placeholder="Handle label (optional)"
              className="config-input"
              style={{ width: '170px' }}
            />
            {output.nodeId && <small style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>{getNodeLabel(output.nodeId)}</small>}
            <button type="button" onClick={() => updateConnections('outputs', (list) => list.filter((_, i) => i !== idx))} className="icon-btn-small" title="Remove"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
