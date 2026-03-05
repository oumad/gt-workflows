import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { Workflow } from '@/types'
import { RefreshCw, FileJson, Settings, Server, Clock, Code, Edit2, CheckSquare, X, Search, Download, ChevronDown, ChevronUp, Folder, GripVertical, Save, Copy, FileText, LayoutGrid, Play, ShieldCheck } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import AuthImage from '@/components/ui/AuthImage'
import ServerUrlEditor from '@/components/ui/ServerUrlEditor'
import QuickEditModal from '@/components/modals/QuickEditModal'
import BulkEditModal from '@/components/modals/BulkEditModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import DuplicateModal from '@/components/modals/DuplicateModal'
import DownloadModal from '@/components/modals/DownloadModal'
import { getPrimaryServerUrl, serverUrlDisplayLabel } from '@/utils/serverUrl'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import type { WorkflowDetailUIState } from '@/services/api/preferences'
import { getWorkflowParams, saveWorkflowParams } from '@/services/api/workflows'
import './WorkflowList.css'

interface WorkflowListProps {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

interface SortableWorkflowCardProps {
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

function SortableWorkflowCard({
  workflow,
  isSelected,
  selectionMode,
  editMode,
  editedParams,
  onToggleSelection,
  onDownload,
  onDuplicate,
  onViewLogs,
  onFieldChange,
  uiState,
}: SortableWorkflowCardProps) {
  const comfyServerUrl = workflow.params?.parser === 'comfyui' ? getPrimaryServerUrl(workflow.params?.comfyui_config?.serverUrl) || undefined : undefined
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workflow.name })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition, // Disable transition while dragging to prevent flashing
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`workflow-card-wrapper ${
        isSelected ? 'selected' : ''
      } ${selectionMode ? 'selection-mode' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={() => {
        if (selectionMode) {
          onToggleSelection(workflow.name)
        }
      }}
    >
      {selectionMode && isSelected && (
        <div className="selection-indicator">
          <CheckSquare size={20} />
        </div>
      )}
      {editMode && (
        <div className="workflow-drag-handle" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </div>
      )}
      <Link
        to={editMode ? '#' : `/workflows/workflow/${encodeURIComponent(workflow.name)}`}
        className={`workflow-card${editMode ? ' workflow-card-no-link' : ''}`}
        onClick={(e) => {
          if (selectionMode) {
            e.preventDefault()
            onToggleSelection(workflow.name)
          } else if (editMode) {
            // Let checkbox/input clicks through so they toggle and fire onChange
            const el = e.target as HTMLElement
            if (!(el instanceof HTMLInputElement)) e.preventDefault()
          }
        }}
      >
        <div className="workflow-card-header">
          {workflow.params.icon && (
            <div className="workflow-icon">
              <AuthImage
                workflowName={workflow.name}
                iconPath={workflow.params.icon}
                alt={workflow.name}
              />
            </div>
          )}
          <div className="workflow-title-section">
            <div className="workflow-title-row">
              <h3>{workflow.params.label || workflow.name}</h3>
              {workflow.params.iconBadge && (
                <span
                  className="workflow-badge"
                  style={{
                    backgroundColor:
                      workflow.params.iconBadge.colorVariant === 'error'
                        ? 'var(--error)'
                        : workflow.params.iconBadge.colorVariant === 'warning'
                        ? 'var(--warning)'
                        : workflow.params.iconBadge.colorVariant === 'success'
                        ? 'var(--success)'
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
              <p 
                className="workflow-description" 
                title={workflow.params.description}
              >
                {workflow.params.description}
              </p>
            )}
          </div>
        </div>

        <div className="workflow-quick-info">
          {workflow.params.parser === 'comfyui' &&
            workflow.params.comfyui_config?.serverUrl && (() => {
              const rawServerUrl = editedParams.comfyui_config?.serverUrl ?? workflow.params.comfyui_config!.serverUrl!
              const serverUrl = getPrimaryServerUrl(rawServerUrl)
              if (!serverUrl) return null
              return (
                <div className="quick-info-item">
                  <Server size={14} />
                  <span className="quick-info-label">Server:</span>
                  {editMode ? (
                    <ServerUrlEditor
                      compact
                      value={rawServerUrl}
                      onChange={(v) => onFieldChange(workflow.name, 'comfyui_config.serverUrl', v)}
                    />
                  ) : (
                    <span className="quick-info-value" title={serverUrl}>
                      {serverUrlDisplayLabel(rawServerUrl)}
                    </span>
                  )}
                </div>
              )
            })()}
          <div className="quick-info-item">
            <Clock size={14} />
            <span className="quick-info-label">Timeout:</span>
            {editMode ? (
              <input
                type="number"
                value={editedParams.timeout ?? workflow.params.timeout ?? ''}
                onChange={(e) => onFieldChange(workflow.name, 'timeout', e.target.value ? Number(e.target.value) : undefined)}
                className="quick-info-edit-input"
                placeholder="Not set"
              />
            ) : (
              workflow.params.timeout ? (
                <span className="quick-info-value">{workflow.params.timeout}s</span>
              ) : (
                <span className="quick-info-value" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>
              )
            )}
          </div>
          <div className="quick-info-item">
            {editMode ? (
              <div className="dev-mode-switch-wrap" onClick={(e) => e.stopPropagation()}>
                <Code size={14} />
                <span className="dev-mode-label">Dev Mode</span>
                <label className="dev-mode-switch" htmlFor={`dev-mode-${workflow.name}`} aria-label="Dev Mode">
                  <input
                    id={`dev-mode-${workflow.name}`}
                    type="checkbox"
                    role="switch"
                    checked={editedParams.devMode ?? workflow.params.devMode ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked
                      onFieldChange(workflow.name, 'devMode', checked)
                    }}
                  />
                  <span className="dev-mode-slider" />
                </label>
              </div>
            ) : (
              <>
                <Code size={14} />
                {workflow.params.devMode ? (
                  <span className="quick-info-value dev-mode-badge">Dev Mode</span>
                ) : (
                  <span className="quick-info-value" style={{ color: 'var(--text-muted)' }}>Dev Mode: Off</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="workflow-meta">
          <div className="meta-item">
            <Settings size={14} />
            <span>
              {workflow.params.parser === 'comfyui' ? 'ComfyUI' : 'Default'}
            </span>
          </div>
          {workflow.hasWorkflowFile && (
            <div className="meta-item">
              <FileJson size={14} />
              <span>Workflow File</span>
            </div>
          )}
          {workflow.params.scope && (
            <div className="meta-item">
              <span className="scope-badge">{workflow.params.scope}</span>
            </div>
          )}
          {workflow.params.tags && workflow.params.tags.length > 0 && (
            <div className="workflow-tags">
              {workflow.params.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {!editMode && (uiState?.lastTestRun || uiState?.lastAuditRun) && (
            <div className="workflow-run-badges">
              {uiState?.lastTestRun && (
                <span
                  className={`run-badge run-badge--${uiState.lastTestRunStatus ?? 'ok'}`}
                  title={`Last tested: ${new Date(uiState.lastTestRun).toLocaleString()}`}
                >
                  <Play size={10} />
                  Tested
                </span>
              )}
              {uiState?.lastAuditRun && (
                <span
                  className={`run-badge run-badge--${uiState.lastAuditRunStatus ?? 'ok'}`}
                  title={`Last audited: ${new Date(uiState.lastAuditRun).toLocaleString()}`}
                >
                  <ShieldCheck size={10} />
                  Audited
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
      {!selectionMode && (
        <div className="workflow-card-actions">
          <button
            className="quick-duplicate-btn"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onDuplicate(workflow.name, e)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            title="Duplicate workflow"
            type="button"
          >
            <Copy size={16} />
          </button>
          {comfyServerUrl && onViewLogs && (
            <button
              className="quick-logs-btn"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onViewLogs(comfyServerUrl)
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              title="View ComfyUI server logs"
              type="button"
            >
              <FileText size={16} />
            </button>
          )}
          <button
            className="quick-download-btn"
            onClick={(e) => onDownload(workflow.name, e)}
            title="Download workflow"
            type="button"
          >
            <Download size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

export function WorkflowList({ workflows, loading, error, onRefresh }: WorkflowListProps) {
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [serverAliasesFromPrefs, setServerAliasesFromPrefs] = useState<Record<string, string>>({})
  const [workflowDetailUI, setWorkflowDetailUI] = useState<Record<string, WorkflowDetailUIState>>({})
  const [duplicatingWorkflow, setDuplicatingWorkflow] = useState<Workflow | null>(null)
  const [downloadingWorkflow, setDownloadingWorkflow] = useState<Workflow | null>(null)
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [prefsLoadedForCategories, setPrefsLoadedForCategories] = useState(false)
  const expandedCategoriesRestoredFromPrefs = useRef(false)
  const [localWorkflows, setLocalWorkflows] = useState<Workflow[]>(workflows)
  const expandSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isReordering] = useState(false) // Reserved for future drag-and-drop reordering
  const [editMode, setEditMode] = useState(false)
  const [editedWorkflows, setEditedWorkflows] = useState<Map<string, Partial<Workflow['params']>>>(new Map())

  // Update local workflows when workflows prop changes
  useEffect(() => {
    setLocalWorkflows(workflows)
  }, [workflows])

  // Persist workflows info (names + all params) to preferences when list is loaded
  useEffect(() => {
    if (workflows.length > 0) {
      updatePreferences({ workflowsInfo: workflows }).catch(() => {})
    }
  }, [workflows])

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Load preferences (monitored servers + expanded categories) and listen for settings updates
  useEffect(() => {
    const load = () => {
      getPreferences()
        .then((prefs) => {
          setServerAliasesFromPrefs(prefs.serverAliases ?? {})
          setWorkflowDetailUI(prefs.workflowDetailUI ?? {})
          if (prefs.expandedCategories?.length > 0) {
            setExpandedCategories(new Set(prefs.expandedCategories))
            expandedCategoriesRestoredFromPrefs.current = true
          }
          setPrefsLoadedForCategories(true)
        })
        .catch(() => setPrefsLoadedForCategories(true))
    }
    load()
    window.addEventListener('settingsUpdated', load)
    return () => window.removeEventListener('settingsUpdated', load)
  }, [])

  // Filter workflows based on search term
  const filteredWorkflows = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return workflows
    return workflows.filter((workflow) => {
      const name = workflow.name.toLowerCase()
      const label = workflow.params.label?.toLowerCase() || ''
      const description = workflow.params.description?.toLowerCase() || ''
      const category = workflow.params.category?.toLowerCase() || ''
      const tags = workflow.params.tags?.map(t => t.toLowerCase()).join(' ') || ''
      return (
        name.includes(term) ||
        label.includes(term) ||
        description.includes(term) ||
        category.includes(term) ||
        tags.includes(term)
      )
    })
  }, [workflows, searchTerm])

  // Group workflows by category and sort them
  const categorizedWorkflows = useMemo(() => {
    const categories = new Map<string, Workflow[]>()
    
    // Use localWorkflows instead of filteredWorkflows for drag-and-drop
    const workflowsToUse = isReordering ? localWorkflows : filteredWorkflows
    
    // Group workflows by category
    workflowsToUse.forEach(workflow => {
      const category = workflow.params.category || 'Uncategorized'
      if (!categories.has(category)) {
        categories.set(category, [])
      }
      categories.get(category)!.push(workflow)
    })
    
    // Sort workflows within each category
    categories.forEach((workflows) => {
      workflows.sort((a, b) => {
        // First sort by order if provided
        const orderA = a.params.order
        const orderB = b.params.order
        
        if (orderA !== undefined && orderB !== undefined) {
          return orderA - orderB
        }
        if (orderA !== undefined) return -1
        if (orderB !== undefined) return 1
        
        // If no order, sort alphabetically by label or name
        const nameA = (a.params.label || a.name).toLowerCase()
        const nameB = (b.params.label || b.name).toLowerCase()
        return nameA.localeCompare(nameB)
      })
    })
    
    // Sort categories alphabetically
    const sortedCategories = Array.from(categories.entries()).sort((a, b) => {
      return a[0].localeCompare(b[0])
    })
    
    return sortedCategories
  }, [filteredWorkflows, localWorkflows, isReordering])

  // Expand all categories on first load only when we didn't restore from preferences
  useEffect(() => {
    if (
      categorizedWorkflows.length > 0 &&
      prefsLoadedForCategories &&
      !expandedCategoriesRestoredFromPrefs.current
    ) {
      expandedCategoriesRestoredFromPrefs.current = true
      setExpandedCategories(new Set(categorizedWorkflows.map(([category]) => category)))
    }
  }, [categorizedWorkflows, prefsLoadedForCategories])

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      if (expandSaveTimeoutRef.current) clearTimeout(expandSaveTimeoutRef.current)
      expandSaveTimeoutRef.current = setTimeout(() => {
        updatePreferences({ expandedCategories: Array.from(next) as string[] }).catch(() => {})
        expandSaveTimeoutRef.current = null
      }, 500)
      return next
    })
  }, [])

  if (loading) {
    return (
      <div className="loading-container">
        <RefreshCw className="spinner" size={32} />
        <p>Loading workflows...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={onRefresh} className="btn btn-primary">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    )
  }

  const toggleSelection = (workflowName: string) => {
    const newSelection = new Set(selectedWorkflows)
    if (newSelection.has(workflowName)) {
      newSelection.delete(workflowName)
    } else {
      newSelection.add(workflowName)
    }
    setSelectedWorkflows(newSelection)
  }

  const toggleSelectAll = () => {
    if (selectedWorkflows.size === filteredWorkflows.length) {
      setSelectedWorkflows(new Set())
    } else {
      setSelectedWorkflows(new Set(filteredWorkflows.map((w) => w.name)))
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedWorkflows(new Set())
  }

  const enterSelectionMode = () => {
    setSelectionMode(true)
  }

  const selectedWorkflowsList = filteredWorkflows.filter((w) =>
    selectedWorkflows.has(w.name)
  )

  const handleDownload = async (workflowName: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const workflow = workflows.find(w => w.name === workflowName)
    if (!workflow) {
      return
    }
    
    // Open download modal
    setDownloadingWorkflow(workflow)
  }

  const handleDuplicate = async (workflowName: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const workflow = workflows.find(w => w.name === workflowName)
    if (!workflow) {
      return
    }
    
    // Open duplicate modal
    setDuplicatingWorkflow(workflow)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!editMode) return // Only allow dragging in edit mode

    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    // Find the category and workflows for this drag
    const activeWorkflow = localWorkflows.find(w => w.name === active.id)
    const overWorkflow = localWorkflows.find(w => w.name === over.id)

    if (!activeWorkflow || !overWorkflow) {
      return
    }

    // Check if they're in the same category
    const activeCategory = activeWorkflow.params.category || 'Uncategorized'
    const overCategory = overWorkflow.params.category || 'Uncategorized'

    if (activeCategory !== overCategory) {
      return // Don't allow dragging between categories
    }

    // Get all workflows in this category
    const categoryWorkflows = localWorkflows
      .filter(w => (w.params.category || 'Uncategorized') === activeCategory)
      .sort((a, b) => {
        const orderA = a.params.order ?? 999
        const orderB = b.params.order ?? 999
        return orderA - orderB
      })

    const oldIndex = categoryWorkflows.findIndex(w => w.name === active.id)
    const newIndex = categoryWorkflows.findIndex(w => w.name === over.id)

    if (oldIndex === -1 || newIndex === -1) {
      return
    }

    // Reorder the workflows
    const reordered = arrayMove(categoryWorkflows, oldIndex, newIndex)

    // Update order values in local state
    const updatedWorkflows = [...localWorkflows]
    reordered.forEach((workflow, index) => {
      const workflowIndex = updatedWorkflows.findIndex(w => w.name === workflow.name)
      if (workflowIndex !== -1) {
        const newOrder = index + 1
        updatedWorkflows[workflowIndex] = {
          ...updatedWorkflows[workflowIndex],
          params: {
            ...updatedWorkflows[workflowIndex].params,
            order: newOrder,
          },
        }
        // Also update in editedWorkflows map
        setEditedWorkflows(prev => {
          const next = new Map(prev)
          const existing = next.get(workflow.name) || {}
          next.set(workflow.name, { ...existing, order: newOrder })
          return next
        })
      }
    })

    setLocalWorkflows(updatedWorkflows)
  }

  const handleFieldChange = (workflowName: string, field: string, value: string | string[] | number | boolean | undefined) => {
    setEditedWorkflows(prev => {
      const next = new Map(prev)
      const existing = next.get(workflowName) || {}
      if (field.includes('.')) {
        // Handle nested fields like comfyui_config.serverUrl
        const [parent, child] = field.split('.')
        next.set(workflowName, {
          ...existing,
          [parent]: {
            ...(existing[parent] || {}),
            [child]: value,
          },
        })
      } else {
        next.set(workflowName, { ...existing, [field]: value })
      }
      return next
    })
  }

  const handleSaveEdits = async () => {
    try {
      setSaveError(null)
      await Promise.all(
        Array.from(editedWorkflows.entries()).map(async ([workflowName, changes]) => {
          // Load full params from server to preserve all fields
          const fullParams = await getWorkflowParams(workflowName)

          // Merge changes into full params
          const updatedParams = { ...fullParams, ...changes }

          // Handle nested fields like comfyui_config.serverUrl
          if (changes.comfyui_config) {
            updatedParams.comfyui_config = {
              ...fullParams.comfyui_config,
              ...changes.comfyui_config,
            }
          }

          await saveWorkflowParams(workflowName, updatedParams)
        })
      )
      setEditedWorkflows(new Map())
      setEditMode(false)
      onRefresh()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes. Please try again.')
    }
  }

  const handleCancelEdit = () => {
    setEditedWorkflows(new Map())
    setEditMode(false)
    setLocalWorkflows(workflows) // Revert to original
  }

  return (
    <div className="workflow-list">
      <header className="list-header page-toolbar">
        <div className="header-left">
          <h1 className="page-title">
            <LayoutGrid size={24} />
            Workflows ({filteredWorkflows.length}
            {searchTerm && filteredWorkflows.length !== workflows.length && ` of ${workflows.length}`})
          </h1>
          {selectionMode && (
            <span className="selection-mode-badge">
              {selectedWorkflows.size > 0
                ? `${selectedWorkflows.size} selected`
                : 'Select workflows to edit'}
            </span>
          )}
        </div>
        <div className="search-container">
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              aria-label="Search workflows"
              placeholder="Search workflows..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="search-clear"
                title="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="header-actions">
          {!selectionMode ? (
            <>
              <button
                onClick={() => setEditMode(!editMode)}
                className={`btn ${editMode ? 'btn-primary' : 'btn-secondary'}`}
                title={editMode ? 'Exit edit mode' : 'Enter edit mode to reorder and edit workflows'}
              >
                <Edit2 size={16} />
                {editMode ? 'Done Editing' : 'Edit Mode'}
              </button>
              <button
                onClick={enterSelectionMode}
                className="btn btn-secondary"
              >
                <CheckSquare size={16} />
                Bulk Edit
              </button>
              <button onClick={onRefresh} className="btn btn-secondary">
                <RefreshCw size={16} /> Refresh
              </button>
            </>
          ) : (
            <>
              {filteredWorkflows.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className="btn btn-secondary"
                  title={
                    selectedWorkflows.size === filteredWorkflows.length
                      ? 'Deselect all'
                      : 'Select all'
                  }
                >
                  <CheckSquare size={16} />
                  {selectedWorkflows.size === filteredWorkflows.length
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
              )}
              {selectedWorkflows.size > 0 && (
                <button
                  onClick={() => setShowBulkEdit(true)}
                  className="btn btn-primary"
                >
                  <CheckSquare size={16} />
                  Edit {selectedWorkflows.size}
                </button>
              )}
              <button
                onClick={exitSelectionMode}
                className="btn btn-secondary"
              >
                <X size={16} />
                Cancel
              </button>
            </>
          )}
        </div>
      </header>

      {workflows.length === 0 ? (
        <div className="empty-state">
          <p>No workflows found</p>
          <Link to="/workflows/new" className="btn btn-primary">
            Create Your First Workflow
          </Link>
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="empty-state">
          <p>No workflows match your search &ldquo;{searchTerm}&rdquo;</p>
          <button
            onClick={() => { setSearchTerm(''); setDebouncedSearchTerm('') }}
            className="btn btn-secondary"
          >
            Clear Search
          </button>
        </div>
      ) : (
        <>
          <div className={`workflow-categories ${editMode ? 'edit-mode' : ''}`}>
            {categorizedWorkflows.map(([category, categoryWorkflows], categoryIndex) => {
              const isExpanded = expandedCategories.has(category)
              const categoryCount = categoryWorkflows.length
              
              return (
                <div key={category} className="workflow-category">
                  <button
                    className="workflow-category-header"
                    onClick={() => toggleCategory(category)}
                    aria-expanded={isExpanded}
                    aria-controls={`category-${category}`}
                  >
                    <div className="workflow-category-title">
                      <Folder size={18} />
                      <span className="category-name">{category}</span>
                      <span className="category-count">({categoryCount})</span>
                    </div>
                    <div className="workflow-category-toggle">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div id={`category-${category}`} className="workflow-category-content">
                      {editMode ? (
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleDragEnd}
                        >
                          <SortableContext
                            items={categoryWorkflows.map(w => w.name)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="workflow-grid">
                              {categoryWorkflows.map((workflow) => {
                                const isSelected = selectedWorkflows.has(workflow.name)
                                const editedParams = editedWorkflows.get(workflow.name) || {}
                                return (
                                  <SortableWorkflowCard
                                    key={workflow.name}
                                    workflow={workflow}
                                    isSelected={isSelected}
                                    selectionMode={selectionMode}
                                    editMode={editMode}
                                    editedParams={editedParams}
                                    onToggleSelection={toggleSelection}
                                    onDownload={handleDownload}
                                    onDuplicate={handleDuplicate}
                                    onViewLogs={setLogsServerUrl}
                                    onFieldChange={handleFieldChange}
                                    uiState={workflowDetailUI[workflow.name]}
                                  />
                                )
                              })}
                            </div>
                          </SortableContext>
                        </DndContext>
                      ) : (
                        <div className="workflow-grid">
                          {categoryWorkflows.map((workflow) => {
                            const isSelected = selectedWorkflows.has(workflow.name)
                            return (
                              <SortableWorkflowCard
                                key={workflow.name}
                                workflow={workflow}
                                isSelected={isSelected}
                                selectionMode={selectionMode}
                                editMode={editMode}
                                editedParams={{}}
                                onToggleSelection={toggleSelection}
                                onDownload={handleDownload}
                                onDuplicate={handleDuplicate}
                                onViewLogs={setLogsServerUrl}
                                onFieldChange={handleFieldChange}
                                uiState={workflowDetailUI[workflow.name]}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {categoryIndex < categorizedWorkflows.length - 1 && (
                    <div className="category-separator" />
                  )}
                </div>
              )
            })}
          </div>
          {editingWorkflow && (
            <QuickEditModal
              workflowName={editingWorkflow.name}
              params={editingWorkflow.params}
              onClose={() => setEditingWorkflow(null)}
              onSave={() => {
                setEditingWorkflow(null)
                onRefresh()
              }}
            />
          )}
          {showBulkEdit && selectedWorkflowsList.length > 0 && (
            <BulkEditModal
              workflows={selectedWorkflowsList}
              onClose={() => {
                setShowBulkEdit(false)
              }}
              onSave={() => {
                setShowBulkEdit(false)
                exitSelectionMode()
                onRefresh()
              }}
            />
          )}
          {duplicatingWorkflow && (
            <DuplicateModal
              workflow={duplicatingWorkflow}
              onClose={() => setDuplicatingWorkflow(null)}
              onSuccess={() => {
                setDuplicatingWorkflow(null)
                onRefresh()
              }}
            />
          )}
          {downloadingWorkflow && (
            <DownloadModal
              workflow={downloadingWorkflow}
              onClose={() => setDownloadingWorkflow(null)}
            />
          )}
          {logsServerUrl && (
            <ServerLogsModal
              serverUrl={logsServerUrl}
              serverAliases={serverAliasesFromPrefs}
              onClose={() => setLogsServerUrl(null)}
            />
          )}
        </>
      )}

      {editMode && (
        <div className="edit-mode-footer">
          {saveError && (
            <div className="error-banner" role="alert" style={{ marginBottom: '8px' }}>
              <p>{saveError}</p>
            </div>
          )}
          <div className="edit-mode-info">
            <span>Edit mode active. Drag cards to reorder, edit fields directly on cards.</span>
          </div>
          <div className="edit-mode-actions">
            <button onClick={handleCancelEdit} className="btn btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleSaveEdits}
              className="btn btn-primary"
              disabled={editedWorkflows.size === 0}
            >
              <Save size={16} />
              Save Changes ({editedWorkflows.size})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

