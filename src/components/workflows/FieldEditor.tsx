import { Trash2 } from 'lucide-react'
import { SelectOptionsEditor } from './SelectOptionsEditor'
import { ConnectToEditor } from './ConnectToEditor'
import type { ConnectToConfig } from './ConnectToEditor'
import type { InputFieldConfig } from './NodeParserEditor'

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

interface FieldEditorProps {
  fieldName: string
  config: InputFieldConfig
  nodeId: string
  workflowJson?: Record<string, unknown>
  params?: Record<string, unknown>
  onUpdate: (fieldName: string, updates: Partial<InputFieldConfig>) => void
  onRemove: (fieldName: string) => void
  onToggleHidden: (fieldName: string) => void
}

export function FieldEditor({ fieldName, config, nodeId, workflowJson, params, onUpdate, onRemove, onToggleHidden }: FieldEditorProps) {
  return (
    <div className="field-editor">
      <div className="field-header">
        <h4>{fieldName}</h4>
        <button onClick={() => onRemove(fieldName)} className="icon-btn-small" title="Remove configuration"><Trash2 size={14} /></button>
      </div>
      <div className="field-config">
        <div className="config-row">
          <label>Type</label>
          <select
            value={config.type === false ? 'false' : config.type === true ? 'true' : (config.type as string || 'textField')}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'false') onToggleHidden(fieldName)
              else if (v === 'true') onUpdate(fieldName, { type: true })
              else onUpdate(fieldName, { type: v })
            }}
            className="config-input"
          >
            {PARSER_TYPES.map(t => <option key={String(t.value)} value={String(t.value)}>{t.label}</option>)}
          </select>
        </div>

        {typeof config.type === 'string' && (
          <>
            {config.type !== 'slider' ? (
              <div className="config-row">
                <label>Label</label>
                <input type="text" value={typeof config.label === 'string' ? config.label : ''} onChange={(e) => onUpdate(fieldName, { label: e.target.value || undefined })} placeholder="Custom label (optional)" className="config-input" />
              </div>
            ) : (
              <div className="config-row">
                <label>Label (string or false to hide)</label>
                <input type="text" value={config.label === false ? 'false' : (typeof config.label === 'string' ? config.label : '')} onChange={(e) => { const v = e.target.value.trim(); onUpdate(fieldName, { label: v === 'false' ? false : (v || undefined) }) }} placeholder="Custom label or 'false' to hide" className="config-input" />
              </div>
            )}

            {(config.type === 'slider' || config.type === 'number') && (
              <>
                <div className="config-row">
                  <label>Min (number or reference like "min_value")</label>
                  <input type="text" value={config.min ?? ''} onChange={(e) => { const v = e.target.value.trim(); onUpdate(fieldName, { min: v ? (isNaN(Number(v)) ? v : Number(v)) : undefined }) }} placeholder='e.g., 0 or "min_value"' className="config-input" />
                </div>
                <div className="config-row">
                  <label>Max (number or reference like "max_value")</label>
                  <input type="text" value={config.max ?? ''} onChange={(e) => { const v = e.target.value.trim(); onUpdate(fieldName, { max: v ? (isNaN(Number(v)) ? v : Number(v)) : undefined }) }} placeholder='e.g., 100 or "max_value"' className="config-input" />
                </div>
                <div className="config-row">
                  <label>Step (number or reference like "step")</label>
                  <input type="text" value={config.step ?? ''} onChange={(e) => { const v = e.target.value.trim(); onUpdate(fieldName, { step: v ? (isNaN(Number(v)) ? v : Number(v)) : undefined }) }} placeholder='e.g., 1 or "step"' className="config-input" />
                </div>
                <div className="config-row checkbox-row">
                  <label><input type="checkbox" checked={(config.acceptFloat as boolean) || false} onChange={(e) => onUpdate(fieldName, { acceptFloat: e.target.checked })} /> Accept Float (for decimal numbers)</label>
                </div>
              </>
            )}

            {config.type === 'select' && (
              <SelectOptionsEditor
                options={(config.options || []) as Parameters<typeof SelectOptionsEditor>[0]['options']}
                onChange={(newOptions) => onUpdate(fieldName, { options: newOptions })}
              />
            )}

            {(config.type === 'uploadImage' || config.type === 'uploadVideo' || config.type === 'uploadAudio' || config.type === 'file') && (
              <div className="config-row">
                <label>Accepted Extensions</label>
                <input type="text" value={Array.isArray(config.accept) ? config.accept.join(', ') : (config.accept || '')} onChange={(e) => onUpdate(fieldName, { accept: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="png, jpg, jpeg (comma separated)" className="config-input" />
              </div>
            )}

            {config.type === 'uploadImage' && (
              <>
                <div className="config-row">
                  <label>Image Size (e.g., "200px", "300px")</label>
                  <input type="text" value={(config.imageSize as string) || ''} onChange={(e) => onUpdate(fieldName, { imageSize: e.target.value.trim() || undefined })} placeholder="e.g., 200px, 300px" className="config-input" />
                  <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontWeight: 'normal' }}>Size of the image in the image picker (in pixels)</small>
                </div>
                <div className="config-row checkbox-row">
                  <label><input type="checkbox" checked={(config.base64 as boolean) || false} onChange={(e) => onUpdate(fieldName, { base64: e.target.checked })} /> Base64 Encoding</label>
                </div>
                <div className="config-row checkbox-row">
                  <label><input type="checkbox" checked={config.drawMaskEnable || false} onChange={(e) => onUpdate(fieldName, { drawMaskEnable: e.target.checked })} /> Enable Mask Drawing</label>
                </div>
                {config.drawMaskEnable && (
                  <>
                    <div className="config-row">
                      <label>Mask Node ID</label>
                      <input type="text" value={config.maskNode?.nodeId || ''} onChange={(e) => onUpdate(fieldName, { maskNode: { nodeId: e.target.value } })} placeholder="Node ID for mask" className="config-input" />
                    </div>
                    <div className="config-row">
                      <label>Mask Instructions</label>
                      <input type="text" value={(config.instructions as string) || ''} onChange={(e) => onUpdate(fieldName, { instructions: e.target.value })} placeholder="Instructions shown in mask dialog" className="config-input" />
                    </div>
                  </>
                )}
              </>
            )}

            {(config.type === 'uploadVideo' || config.type === 'uploadAudio') && (
              <div className="config-row">
                <label>Save Path (or use &lt;SAVE_INPUT_PATH&gt; placeholder)</label>
                <input type="text" value={(config.path as string) || ''} onChange={(e) => onUpdate(fieldName, { path: e.target.value })} placeholder="<SAVE_INPUT_PATH> or custom path" className="config-input" />
              </div>
            )}

            <div className="config-row">
              <label><input type="checkbox" checked={config.required || false} onChange={(e) => onUpdate(fieldName, { required: e.target.checked })} /> Required</label>
            </div>

            {config.type !== 'checkbox' && (
              <div className="config-row">
                <label>Default Value</label>
                <input
                  type="text"
                  value={config.default !== undefined && config.default !== null ? String(config.default) : ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    let value: string | number | undefined = raw === '' ? undefined : raw
                    if (config.type === 'select' && Array.isArray(config.options) && config.options.length > 0 && raw !== '') {
                      const getVal = (opt: unknown) => typeof opt === 'object' && opt !== null && 'value' in opt ? (opt as Record<string, unknown>).value : opt
                      const matchByString = config.options.find((opt) => getVal(opt) === raw)
                      const matchByNumber = !Number.isNaN(Number(raw)) ? config.options.find((opt) => getVal(opt) === Number(raw)) : undefined
                      const match = matchByString ?? matchByNumber
                      if (match !== undefined && match !== false) {
                        const matched = getVal(match)
                        if (typeof matched !== 'boolean') value = matched as string | number
                      }
                    }
                    onUpdate(fieldName, { default: value })
                  }}
                  placeholder="Default value (optional)"
                  className="config-input"
                />
              </div>
            )}

            <ConnectToEditor
              connectTo={config.connectTo as ConnectToConfig | undefined}
              currentNodeId={nodeId}
              workflowJson={workflowJson}
              params={params}
              onChange={(connectTo) => {
                if (connectTo) onUpdate(fieldName, { connectTo })
                else { const { connectTo: _, ...rest } = config; onUpdate(fieldName, rest) }
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}
