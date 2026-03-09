import { Link } from 'react-router-dom'
import type { Workflow } from '@/types'
import { FileJson, Settings, Server, Clock, Code, CheckSquare, GripVertical, Copy, FileText, Download, Play, ShieldCheck } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AuthImage from '@/components/ui/AuthImage'
import ServerUrlEditor from '@/components/ui/ServerUrlEditor'
import { getPrimaryServerUrl, serverUrlDisplayLabel } from '@/utils/serverUrl'
import type { WorkflowDetailUIState } from '@/services/api/preferences'

export interface SortableWorkflowCardProps {
  workflow: Workflow
  isSelected: boolean
  selectionMode: boolean
  editMode: boolean
  editedParams: Partial<Workflow['params']>
  onToggleSelection: (name: string) => void
  onDownload: (name: string, e: React.MouseEvent) => void
  onDuplicate: (name: string, e: React.MouseEvent) => void
  onViewLogs?: (serverUrl: string) => void
  onFieldChange: (workflowName: string, field: string, value: string | string[] | number | boolean | undefined) => void
  uiState?: WorkflowDetailUIState
}

export function SortableWorkflowCard({
  workflow, isSelected, selectionMode, editMode, editedParams,
  onToggleSelection, onDownload, onDuplicate, onViewLogs, onFieldChange, uiState,
}: SortableWorkflowCardProps) {
  const comfyServerUrl = workflow.params?.parser === 'comfyui'
    ? getPrimaryServerUrl(workflow.params?.comfyui_config?.serverUrl) || undefined
    : undefined
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: workflow.name })
  const style = { transform: CSS.Transform.toString(transform), transition: isDragging ? 'none' : transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`workflow-card-wrapper ${isSelected ? 'selected' : ''} ${selectionMode ? 'selection-mode' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={() => { if (selectionMode) onToggleSelection(workflow.name) }}
    >
      {selectionMode && isSelected && <div className="selection-indicator"><CheckSquare size={20} /></div>}
      {editMode && (
        <div className="workflow-drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </div>
      )}
      <Link
        to={editMode ? '#' : `/workflows/workflow/${encodeURIComponent(workflow.name)}`}
        className={`workflow-card${editMode ? ' workflow-card-no-link' : ''}`}
        onClick={(e) => {
          if (selectionMode) { e.preventDefault(); onToggleSelection(workflow.name) }
          else if (editMode) { const el = e.target as HTMLElement; if (!(el instanceof HTMLInputElement)) e.preventDefault() }
        }}
      >
        <div className="workflow-card-header">
          {workflow.params.icon && (
            <div className="workflow-icon">
              <AuthImage workflowName={workflow.name} iconPath={workflow.params.icon} alt={workflow.name} />
            </div>
          )}
          <div className="workflow-title-section">
            <div className="workflow-title-row">
              <h3>{workflow.params.label || workflow.name}</h3>
              {workflow.params.iconBadge && (
                <span
                  className="workflow-badge"
                  style={{
                    backgroundColor: workflow.params.iconBadge.colorVariant === 'error' ? 'var(--error)'
                      : workflow.params.iconBadge.colorVariant === 'warning' ? 'var(--warning)'
                      : workflow.params.iconBadge.colorVariant === 'success' ? 'var(--success)'
                      : 'var(--accent)',
                    ...(Object.fromEntries(
                      Object.entries(workflow.params.iconBadge)
                        .filter(([key]) => key !== 'content' && key !== 'colorVariant')
                        .map(([key, val]) => [key, typeof val === 'string' ? val.replace(/;+$/, '') : val])
                    ) as React.CSSProperties),
                  }}
                >
                  {workflow.params.iconBadge.content}
                </span>
              )}
            </div>
            {workflow.params.description && (
              <p className="workflow-description" title={workflow.params.description}>{workflow.params.description}</p>
            )}
          </div>
        </div>

        <div className="workflow-quick-info">
          {workflow.params.parser === 'comfyui' && workflow.params.comfyui_config?.serverUrl && (() => {
            const rawServerUrl = editedParams.comfyui_config?.serverUrl ?? workflow.params.comfyui_config!.serverUrl!
            const serverUrl = getPrimaryServerUrl(rawServerUrl)
            if (!serverUrl) return null
            return (
              <div className="quick-info-item">
                <Server size={14} />
                <span className="quick-info-label">Server:</span>
                {editMode ? (
                  <ServerUrlEditor compact value={rawServerUrl} onChange={(v) => onFieldChange(workflow.name, 'comfyui_config.serverUrl', v)} />
                ) : (
                  <span className="quick-info-value" title={serverUrl}>{serverUrlDisplayLabel(rawServerUrl)}</span>
                )}
              </div>
            )
          })()}
          <div className="quick-info-item">
            <Clock size={14} />
            <span className="quick-info-label">Timeout:</span>
            {editMode ? (
              <input type="number" value={editedParams.timeout ?? workflow.params.timeout ?? ''} onChange={(e) => onFieldChange(workflow.name, 'timeout', e.target.value ? Number(e.target.value) : undefined)} className="quick-info-edit-input" placeholder="Not set" />
            ) : (
              workflow.params.timeout
                ? <span className="quick-info-value">{workflow.params.timeout}s</span>
                : <span className="quick-info-value" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>
            )}
          </div>
          <div className="quick-info-item">
            {editMode ? (
              <div className="dev-mode-switch-wrap" onClick={(e) => e.stopPropagation()}>
                <Code size={14} />
                <span className="dev-mode-label">Dev Mode</span>
                <label className="dev-mode-switch" htmlFor={`dev-mode-${workflow.name}`} aria-label="Dev Mode">
                  <input id={`dev-mode-${workflow.name}`} type="checkbox" role="switch" checked={editedParams.devMode ?? workflow.params.devMode ?? false} onChange={(e) => onFieldChange(workflow.name, 'devMode', e.target.checked)} />
                  <span className="dev-mode-slider" />
                </label>
              </div>
            ) : (
              <>
                <Code size={14} />
                {workflow.params.devMode
                  ? <span className="quick-info-value dev-mode-badge">Dev Mode</span>
                  : <span className="quick-info-value" style={{ color: 'var(--text-muted)' }}>Dev Mode: Off</span>}
              </>
            )}
          </div>
        </div>

        <div className="workflow-meta">
          <div className="meta-item">
            <Settings size={14} />
            <span>{workflow.params.parser === 'comfyui' ? 'ComfyUI' : 'Default'}</span>
          </div>
          {workflow.hasWorkflowFile && <div className="meta-item"><FileJson size={14} /><span>Workflow File</span></div>}
          {workflow.params.scope && <div className="meta-item"><span className="scope-badge">{workflow.params.scope}</span></div>}
          {workflow.params.tags && workflow.params.tags.length > 0 && (
            <div className="workflow-tags">
              {workflow.params.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
            </div>
          )}
          {!editMode && (uiState?.lastTestRun || uiState?.lastAuditRun) && (
            <div className="workflow-run-badges">
              {uiState?.lastTestRun && (
                <span className={`run-badge run-badge--${uiState.lastTestRunStatus ?? 'ok'}`} title={`Last tested: ${new Date(uiState.lastTestRun).toLocaleString()}`}>
                  <Play size={10} /> Tested
                </span>
              )}
              {uiState?.lastAuditRun && (
                <span className={`run-badge run-badge--${uiState.lastAuditRunStatus ?? 'ok'}`} title={`Last audited: ${new Date(uiState.lastAuditRun).toLocaleString()}`}>
                  <ShieldCheck size={10} /> Audited
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
      {!selectionMode && (
        <div className="workflow-card-actions">
          <button className="quick-duplicate-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(workflow.name, e) }} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }} title="Duplicate workflow" type="button">
            <Copy size={16} />
          </button>
          {comfyServerUrl && onViewLogs && (
            <button className="quick-logs-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewLogs(comfyServerUrl) }} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }} title="View ComfyUI server logs" type="button">
              <FileText size={16} />
            </button>
          )}
          <button className="quick-download-btn" onClick={(e) => onDownload(workflow.name, e)} title="Download workflow" type="button">
            <Download size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
