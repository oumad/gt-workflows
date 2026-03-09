import { Info, Image as ImageIcon, Upload, X } from 'lucide-react'
import type { WorkflowParams, IconBadge } from '@/types'
import AuthImage from '@/components/ui/AuthImage'
import { formatDateTimeShort } from '@/utils/dateFormat'

interface WorkflowGeneralInfoProps {
  name: string
  params: WorkflowParams
  handleParamsUpdate: (p: WorkflowParams) => void
  isFieldChanged: (field: string) => boolean
  iconError: boolean
  setIconError: (v: boolean) => void
  iconDragOver: boolean
  setIconDragOver: (v: boolean) => void
  iconVersion: number
  handleIconDelete: () => Promise<void>
  handleIconUpload: (file: File) => Promise<void>
  lastTestRun: string | null
  lastTestRunStatus: 'ok' | 'nok' | null
  lastAuditRun: string | null
  lastAuditRunStatus: 'ok' | 'nok' | null
}

export function WorkflowGeneralInfo({
  name,
  params,
  handleParamsUpdate,
  isFieldChanged,
  iconError,
  setIconError,
  iconDragOver,
  setIconDragOver,
  iconVersion,
  handleIconDelete,
  handleIconUpload,
  lastTestRun,
  lastTestRunStatus,
  lastAuditRun,
  lastAuditRunStatus,
}: WorkflowGeneralInfoProps) {
  return (
    <div className="detail-section">
      <div className="section-header section-header-with-badges">
        <div className="section-header-title">
          <Info size={20} />
          <h2>General Info</h2>
        </div>
        <div className="general-info-badges">
          <span
            className={`general-info-badge general-info-badge-test status-${lastTestRun != null && lastTestRunStatus != null ? lastTestRunStatus : 'unknown'}`}
            title={lastTestRun ? `Last run (test): ${formatDateTimeShort(lastTestRun)}` : 'Not run yet'}
          >
            {lastTestRun != null && lastTestRunStatus != null
              ? (lastTestRunStatus === 'ok' ? 'TEST PASSING' : 'TEST NOK')
              : 'TEST UNKNOWN'}
          </span>
          <span
            className={`general-info-badge general-info-badge-audit status-${lastAuditRun != null && lastAuditRunStatus != null ? lastAuditRunStatus : 'unknown'}`}
            title={lastAuditRun ? `Last run (audit): ${formatDateTimeShort(lastAuditRun)}` : 'Not run yet'}
          >
            {lastAuditRun != null && lastAuditRunStatus != null
              ? (lastAuditRunStatus === 'ok' ? 'AUDIT OK' : 'AUDIT NOK')
              : 'AUDIT UNKNOWN'}
          </span>
        </div>
      </div>
      <div className="general-info-content">
        {(params.icon || !iconError) && (
          <div className="workflow-icon-large">
            {params.icon && !iconError ? (
              <AuthImage
                workflowName={name}
                iconPath={params.icon}
                alt={`${name} icon`}
                className="workflow-icon-image"
                version={iconVersion}
                onError={() => setIconError(true)}
              />
            ) : (
              <div className="workflow-icon-placeholder-large">
                <ImageIcon size={48} />
              </div>
            )}
          </div>
        )}
        <div className="info-grid">
          <div className="info-item">
            <label>Parser Type</label>
            <span>{params.parser === 'comfyui' ? 'ComfyUI' : 'Default'}</span>
          </div>
          <div className="info-item">
            <label>Label</label>
            <input
              type="text"
              value={params.label || ''}
              onChange={(e) => handleParamsUpdate({ ...params, label: e.target.value || undefined })}
              placeholder="Display name (optional)"
              className={`info-input ${isFieldChanged('label') ? 'field-changed' : ''}`}
            />
            <small>Used as workflow name instead of folder name</small>
          </div>
          <div className="info-item">
            <label>Category</label>
            <input
              type="text"
              value={params.category || ''}
              onChange={(e) => handleParamsUpdate({ ...params, category: e.target.value || undefined })}
              placeholder="Workflow category"
              className="info-input"
            />
          </div>
          <div className="info-item">
            <label>Description</label>
            <input
              type="text"
              value={params.description || ''}
              onChange={(e) => handleParamsUpdate({ ...params, description: e.target.value || undefined })}
              placeholder="Workflow description"
              className={`info-input ${isFieldChanged('description') ? 'field-changed' : ''}`}
            />
          </div>
          <div className="info-item">
            <label>Scope</label>
            <select
              value={params.scope || ''}
              onChange={(e) => handleParamsUpdate({ ...params, scope: e.target.value || undefined })}
              className={`info-input ${isFieldChanged('scope') ? 'field-changed' : ''}`}
            >
              <option value="">None</option>
              <option value="item">Item</option>
            </select>
          </div>
          <div className="info-item">
            <label>Execution Name</label>
            <input
              type="text"
              value={params.executionName || ''}
              onChange={(e) => handleParamsUpdate({ ...params, executionName: e.target.value || undefined })}
              placeholder="Execute button label"
              className="info-input"
            />
          </div>
          <div className="info-item">
            <label>Timeout (seconds)</label>
            <input
              type="number"
              value={params.timeout || ''}
              onChange={(e) => handleParamsUpdate({ ...params, timeout: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Not set"
              className="info-input"
              min="0"
            />
          </div>
          <div className="info-item info-item-full">
            <label>Tags</label>
            <div className="tags-input-wrap">
              <div className="tags-list tags-input-list">
                {(params.tags || []).map((tag: string) => (
                  <span key={tag} className="tag-badge tag-badge-removable">
                    {tag}
                    <button
                      type="button"
                      className="tag-remove"
                      onClick={() => {
                        const next = (params.tags || []).filter((t: string) => t !== tag)
                        handleParamsUpdate({ ...params, tags: next.length > 0 ? next : undefined })
                      }}
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  className="tags-input"
                  placeholder={(params.tags || []).length === 0 ? 'Type a tag and press Enter or comma' : 'Add tag…'}
                  onKeyDown={(e) => {
                    const input = e.target as HTMLInputElement
                    const value = input.value.trim()
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      if (value) {
                        const current = params.tags || []
                        if (!current.includes(value)) {
                          handleParamsUpdate({ ...params, tags: [...current, value] })
                          input.value = ''
                        }
                      }
                    } else if (e.key === 'Backspace' && !value && (params.tags || []).length > 0) {
                      e.preventDefault()
                      handleParamsUpdate({ ...params, tags: (params.tags || []).slice(0, -1) })
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim()
                    if (!pasted) return
                    const newTags = pasted.split(/[\s,]+/).map((t: string) => t.trim()).filter((t: string) => t)
                    if (newTags.length <= 1) return
                    e.preventDefault()
                    const current = params.tags || []
                    const merged = [...current]
                    newTags.forEach((t: string) => { if (!merged.includes(t)) merged.push(t) })
                    handleParamsUpdate({ ...params, tags: merged.length > 0 ? merged : undefined })
                    ;(e.target as HTMLInputElement).value = ''
                  }}
                  onBlur={(e) => {
                    const value = e.target.value.trim()
                    if (value) {
                      const current = params.tags || []
                      if (!current.includes(value)) {
                        handleParamsUpdate({ ...params, tags: [...current, value] })
                        e.target.value = ''
                      }
                    }
                  }}
                />
              </div>
              <small className="tags-hint">Add tags with Enter or comma; remove with × or Backspace</small>
            </div>
          </div>
          <div className="info-item">
            <label>Order</label>
            <input
              type="number"
              value={params.order || ''}
              onChange={(e) => handleParamsUpdate({ ...params, order: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Display order"
              className="info-input"
            />
          </div>
          <div className="info-item">
            <label>Dev Mode</label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={params.devMode || false}
                onChange={(e) => handleParamsUpdate({ ...params, devMode: e.target.checked || undefined })}
              />
              <span>Enabled</span>
            </label>
          </div>
          <div className="info-item">
            <label>Force Local</label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={params.forceLocal || false}
                onChange={(e) => handleParamsUpdate({ ...params, forceLocal: e.target.checked || undefined })}
              />
              <span>Enabled</span>
            </label>
            <small>Force execution locally even in HTTP mode</small>
          </div>
          <div className="info-item info-item-full">
            <label>Documentation</label>
            <input
              type="text"
              value={params.documentation || ''}
              onChange={(e) => handleParamsUpdate({ ...params, documentation: e.target.value || undefined })}
              placeholder="Path to .md documentation file (absolute path)"
              className="info-input"
            />
            <small>Path to markdown file for workflow documentation</small>
          </div>
          <div className="info-item info-item-full">
            <label>Icon Badge</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={params.iconBadge?.content || ''}
                onChange={(e) => handleParamsUpdate({
                  ...params,
                  iconBadge: e.target.value ? { ...params.iconBadge, content: e.target.value } : undefined,
                })}
                placeholder="Badge content"
                className="info-input"
                style={{ flex: '1', minWidth: '150px' }}
              />
              <select
                value={params.iconBadge?.colorVariant || ''}
                onChange={(e) => {
                  const colorVariant = e.target.value as IconBadge['colorVariant'] | ''
                  handleParamsUpdate({
                    ...params,
                    iconBadge: params.iconBadge
                      ? { ...params.iconBadge, colorVariant: colorVariant || undefined }
                      : { content: '', colorVariant: colorVariant || undefined },
                  })
                }}
                className="info-input"
                style={{ width: '150px' }}
              >
                <option value="">Default</option>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
              </select>
              {params.iconBadge && (
                <button type="button" onClick={() => handleParamsUpdate({ ...params, iconBadge: undefined })} className="btn-icon">
                  <X size={16} />
                </button>
              )}
            </div>
            <small>Badge displayed on workflow card</small>
          </div>
          <div className="info-item info-item-full">
            <label>Icon</label>
            <div className="file-upload-area">
              {params.icon ? (
                <div className="file-info">
                  <span>{params.icon.replace(/^\.\//, '')}</span>
                  <button type="button" onClick={handleIconDelete} className="btn-icon">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label
                  className={`file-drop-zone ${iconDragOver ? 'drag-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIconDragOver(true) }}
                  onDragLeave={() => setIconDragOver(false)}
                  onDrop={async (e) => {
                    e.preventDefault()
                    setIconDragOver(false)
                    const file = e.dataTransfer.files[0]
                    if (file && file.type.startsWith('image/')) await handleIconUpload(file)
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (file) await handleIconUpload(file)
                    }}
                    style={{ display: 'none' }}
                  />
                  <Upload size={20} />
                  <span>Click or drop image</span>
                </label>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
