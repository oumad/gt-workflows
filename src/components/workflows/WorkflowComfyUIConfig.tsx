import { Settings, FileText, Upload, X } from 'lucide-react'
import type { WorkflowParams, WorkflowJson, ComfyUIConfig } from '@/types'
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
        <div className="info-item">
          <label>Server URL</label>
          <div className="info-input-with-action">
            <ServerUrlEditor
              value={cfg.serverUrl}
              onChange={(v) => updateCfg({ serverUrl: v })}
              className={isFieldChanged('comfyui_config.serverUrl') ? 'field-changed' : ''}
              onViewLogs={(url) => setLogsServerUrl(url)}
            />
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
          <label>Save Input Path</label>
          <input
            type="text"
            value={cfg.SAVE_INPUT_PATH || ''}
            onChange={(e) => updateCfg({ SAVE_INPUT_PATH: e.target.value || undefined })}
            placeholder="/path/to/input"
            className="info-input"
          />
        </div>
        <div className="info-item">
          <label>Accepted Image Formats</label>
          <input
            type="text"
            value={cfg.ACCEPTED_IMG_FORMATS ? cfg.ACCEPTED_IMG_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              updateCfg({ ACCEPTED_IMG_FORMATS: formats.length > 0 ? formats : undefined })
            }}
            placeholder="png, jpg, jpeg"
            className="info-input"
          />
        </div>
        <div className="info-item">
          <label>Accepted Video Formats</label>
          <input
            type="text"
            value={cfg.ACCEPTED_VIDEO_FORMATS ? cfg.ACCEPTED_VIDEO_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              updateCfg({ ACCEPTED_VIDEO_FORMATS: formats.length > 0 ? formats : undefined })
            }}
            placeholder="mp4, mov"
            className="info-input"
          />
        </div>
        <div className="info-item">
          <label>Accepted File Formats</label>
          <input
            type="text"
            value={cfg.ACCEPTED_FILE_FORMATS ? cfg.ACCEPTED_FILE_FORMATS.join(', ') : ''}
            onChange={(e) => {
              const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f)
              updateCfg({ ACCEPTED_FILE_FORMATS: formats.length > 0 ? formats : undefined })
            }}
            placeholder="txt, json"
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
