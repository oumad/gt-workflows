import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Workflow } from '@/types'
import { Server, Clock, Code, CheckSquare, GripVertical, Copy, FileText, Download, Play, ShieldCheck, MoreHorizontal, FileCode } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AuthImage from '@/components/ui/AuthImage'
import ServerUrlEditor from '@/components/ui/ServerUrlEditor'
import { getPrimaryServerUrl } from '@/utils/serverUrl'
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
  onFieldChange: (workflowName: string, field: string, value: string | number | boolean | undefined) => void
  onComfyServerChange: (workflowName: string, serverUrl: string | string[] | undefined) => void
  uiState?: WorkflowDetailUIState
}

export function SortableWorkflowCard({
  workflow, isSelected, selectionMode, editMode, editedParams,
  onToggleSelection, onDownload, onDuplicate, onViewLogs, onFieldChange, onComfyServerChange, uiState,
}: SortableWorkflowCardProps) {
  const comfyServerUrl = workflow.params?.parser === 'comfyui'
    ? getPrimaryServerUrl(workflow.params?.comfyui_config?.serverUrl) || undefined
    : undefined
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: workflow.name })
  const style = { transform: CSS.Transform.toString(transform), transition: isDragging ? 'none' : transition, opacity: isDragging ? 0.5 : 1 }

  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  const [menuUp, setMenuUp] = useState(false)
  useEffect(() => {
    if (!showMenu || !menuBtnRef.current) return
    const rect = menuBtnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setMenuUp(spaceBelow < 160)
  }, [showMenu])

  const badgeColor = workflow.params.iconBadge?.colorVariant === 'error' ? '#d16b6b'
    : workflow.params.iconBadge?.colorVariant === 'warning' ? '#d4a335'
    : workflow.params.iconBadge?.colorVariant === 'success' ? '#4db896'
    : '#7a4db0'

  const isComfyUI = workflow.params.parser === 'comfyui'
  const serverUrl = comfyServerUrl
  const timeout = workflow.params.timeout
  const devMode = workflow.params.devMode
  const hasWorkflowFile = workflow.hasWorkflowFile

  // Card inner content — shared between edit mode (div) and normal mode (Link)
  const cardContent = (
    <>
      {/* Card Header: Icon + Title + Description */}
      <div className="flex items-start gap-3">
        {editMode && (
          <div className="flex-shrink-0 text-[#697784] hover:text-[#b8c4d0] cursor-grab self-center" {...attributes} {...listeners}>
            <GripVertical size={16} />
          </div>
        )}
        {workflow.params.icon && (
          <div className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-[#0f1419]">
            <AuthImage workflowName={workflow.name} iconPath={workflow.params.icon} alt={workflow.name} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#e8ecf1] truncate">
              {workflow.params.label || workflow.name}
            </h3>
            {workflow.params.iconBadge && (
              <span
                className="text-xs font-bold uppercase px-1.5 py-0.5 rounded text-white flex-shrink-0"
                style={{ backgroundColor: badgeColor }}
              >
                {workflow.params.iconBadge.content}
              </span>
            )}
          </div>
          {workflow.params.description && (
            <p className="text-xs text-[#8b9aab] mt-1 line-clamp-2 leading-relaxed">{workflow.params.description}</p>
          )}
        </div>
      </div>

      {/* Metadata section */}
      {editMode ? (
        /* Edit Mode Fields — always show server, timeout, devmode */
        <div className="mt-3 pt-3 border-t border-[#2d3a4a]/50 space-y-2.5 text-xs">
          {/* Server — editable for all workflows */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#697784] text-xs font-medium uppercase tracking-wide">
              <Server size={12} className="flex-shrink-0" />
              Server
            </div>
            <ServerUrlEditor
              compact
              value={isComfyUI
                ? (editedParams.comfyui_config?.serverUrl ?? workflow.params.comfyui_config?.serverUrl)
                : (editedParams.comfyui_config?.serverUrl ?? undefined)
              }
              onChange={(v) => onComfyServerChange(workflow.name, v)}
              placeholder={isComfyUI ? 'http://127.0.0.1:8188' : 'No server configured'}
            />
          </div>
          {/* Timeout */}
          <div className="flex items-center gap-2">
            <Clock size={12} className="flex-shrink-0 text-[#697784]" />
            <span className="text-xs font-medium uppercase tracking-wide text-[#697784]">Timeout</span>
            <input
              type="number"
              value={editedParams.timeout ?? workflow.params.timeout ?? ''}
              onChange={(e) => onFieldChange(workflow.name, 'timeout', e.target.value ? Number(e.target.value) : undefined)}
              className="ml-auto w-20 px-2 py-1 bg-[#0f1419] border border-[#2d3a4a] rounded text-[#e8ecf1] text-xs focus:outline-none focus:border-purple-500/60"
              placeholder="—"
            />
          </div>
          {/* Dev Mode */}
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Code size={12} className="flex-shrink-0 text-[#697784]" />
            <span className="text-xs font-medium uppercase tracking-wide text-[#697784]">Dev Mode</span>
            <label className="relative inline-flex items-center cursor-pointer ml-auto" htmlFor={`dev-mode-${workflow.name}`}>
              <input
                id={`dev-mode-${workflow.name}`}
                type="checkbox"
                role="switch"
                checked={editedParams.devMode ?? workflow.params.devMode ?? false}
                onChange={(e) => onFieldChange(workflow.name, 'devMode', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-[#354556] peer-checked:bg-purple-700 rounded-full transition-colors duration-150 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>
        </div>
      ) : (
        /* Normal View: structured metadata */
        <div className="mt-3 pt-3 border-t border-[#2d3a4a]/50 space-y-1.5 text-xs text-[#8b9aab] flex-1">
          {/* Server row */}
          {isComfyUI && serverUrl && (
            <div className="flex items-center gap-2">
              <Server size={12} className="flex-shrink-0 text-[#697784]" />
              <span className="text-[#697784]">Server</span>
              <span className="ml-auto truncate max-w-[60%] text-right text-[#b8c4d0]">{serverUrl.replace(/^https?:\/\//, '')}</span>
            </div>
          )}
          {/* Timeout row */}
          {timeout != null && (
            <div className="flex items-center gap-2">
              <Clock size={12} className="flex-shrink-0 text-[#697784]" />
              <span className="text-[#697784]">Timeout</span>
              <span className="ml-auto text-[#b8c4d0]">{timeout}s</span>
            </div>
          )}
          {/* Parser type row — always shown */}
          <div className="flex items-center gap-2">
            <FileCode size={12} className="flex-shrink-0 text-[#697784]" />
            <span className="text-[#697784]">Parser</span>
            <span className={`ml-auto ${isComfyUI ? 'text-purple-400/90' : 'text-[#b8c4d0]'}`}>
              {isComfyUI ? 'ComfyUI' : 'Default'}
            </span>
          </div>
          {/* Workflow file */}
          {hasWorkflowFile && (
            <div className="flex items-center gap-2">
              <FileText size={12} className="flex-shrink-0 text-[#697784]" />
              <span className="text-[#697784]">Workflow</span>
              <span className="ml-auto text-[#b8c4d0]">workflow.json</span>
            </div>
          )}
          {/* Dev mode */}
          {devMode && (
            <div className="flex items-center gap-2">
              <Code size={12} className="flex-shrink-0 text-amber-500/70" />
              <span className="text-amber-500/80">Dev Mode</span>
            </div>
          )}
          {/* Tags */}
          {workflow.params.tags && workflow.params.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {workflow.params.tags.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-purple-700/10 text-purple-400/80 border border-purple-700/15">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {/* Test / Audit badges */}
          {(uiState?.lastTestRun || uiState?.lastAuditRun) && (
            <div className="flex items-center gap-2 pt-1">
              {uiState?.lastTestRun && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
                    uiState.lastTestRunStatus === 'failed' ? 'bg-red-900/15 text-red-400/80' : 'bg-green-900/15 text-green-400/80'
                  }`}
                  title={`Last tested: ${new Date(uiState.lastTestRun).toLocaleString()}`}
                >
                  <Play size={9} /> test
                </span>
              )}
              {uiState?.lastAuditRun && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
                    uiState.lastAuditRunStatus === 'failed' ? 'bg-red-900/15 text-red-400/80' : 'bg-green-900/15 text-green-400/80'
                  }`}
                  title={`Last audited: ${new Date(uiState.lastAuditRun).toLocaleString()}`}
                >
                  <ShieldCheck size={9} /> audit
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        group relative rounded-lg border transition-all duration-200 flex flex-col
        ${isSelected ? 'border-purple-500/60 bg-purple-700/8' : 'border-[#2d3a4a] bg-[#161b22]'}
        ${selectionMode ? 'cursor-pointer' : ''}
        ${isDragging ? 'opacity-50 shadow-lg' : ''}
        ${isOver && !isDragging ? 'border-purple-500/40' : ''}
        hover:border-[#3d4d5e] hover:bg-[#1a2230] hover:shadow-[0_4px_24px_rgba(122,77,176,0.08)]
      `}
      onClick={() => { if (selectionMode) onToggleSelection(workflow.name) }}
    >
      {/* Selection Indicator */}
      {selectionMode && isSelected && (
        <div className="absolute top-3 right-3 text-purple-400 z-10">
          <CheckSquare size={20} />
        </div>
      )}

      {/* Card body — div in edit mode (no navigation), Link in normal mode */}
      {editMode ? (
        <div className="p-4 flex-1 flex flex-col">
          {cardContent}
        </div>
      ) : (
        <Link
          to={`/workflows/workflow/${encodeURIComponent(workflow.name)}`}
          className="block p-4 no-underline text-inherit flex-1 flex flex-col"
          onClick={(e) => { if (selectionMode) e.preventDefault() }}
        >
          {cardContent}
        </Link>
      )}

      {/* Card Actions — context menu (three-dot) */}
      {!selectionMode && !editMode && (
        <div ref={menuRef} className="absolute top-3 right-3">
          <button
            ref={menuBtnRef}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(!showMenu) }}
            className="p-1.5 rounded text-[#697784] opacity-0 group-hover:opacity-100 hover:text-[#e8ecf1] hover:bg-[#243044] transition-all duration-150"
            title="Actions"
            type="button"
          >
            <MoreHorizontal size={16} />
          </button>

          {showMenu && (
            <div className={`absolute right-0 bg-[#1a2332] border border-[#2d3a4a] rounded-md shadow-lg z-30 min-w-[140px] py-1 ${menuUp ? 'bottom-full mb-1' : 'mt-1'}`}>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(workflow.name, e); setShowMenu(false) }}
                className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors flex items-center gap-2.5 whitespace-nowrap"
                type="button"
              >
                <Copy size={13} /> Duplicate
              </button>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDownload(workflow.name, e); setShowMenu(false) }}
                className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors flex items-center gap-2.5 whitespace-nowrap"
                type="button"
              >
                <Download size={13} /> Download
              </button>
              {comfyServerUrl && onViewLogs && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewLogs(comfyServerUrl); setShowMenu(false) }}
                  className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors flex items-center gap-2.5 whitespace-nowrap"
                  type="button"
                >
                  <FileText size={13} /> Server Logs
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
