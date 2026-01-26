import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Workflow } from '../types'
import { RefreshCw, FileJson, Settings, Server, Clock, Code, Edit2, CheckSquare, X, Search, Activity, Download, ChevronDown, ChevronUp, Folder, GripVertical, Save } from 'lucide-react'
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
import QuickEditModal from './QuickEditModal'
import BulkEditModal from './BulkEditModal'
import HealthCheckModal from './HealthCheckModal'
import { useServerHealthCheck } from '../hooks/useServerHealthCheck'
import { getSettings } from '../utils/settings'
import { downloadWorkflow, getWorkflowParams, saveWorkflowParams } from '../api/workflows'
import './WorkflowList.css'

interface WorkflowListProps {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

// Sortable workflow card component
interface SortableWorkflowCardProps {
  workflow: Workflow
  isSelected: boolean
  selectionMode: boolean
  editMode: boolean
  settings: any
  getHealthStatus: (url: string) => any
  monitoredServers: string[]
  downloadingWorkflows: Set<string>
  editedParams: Partial<Workflow['params']>
  onToggleSelection: (name: string) => void
  onDownload: (name: string, e: React.MouseEvent) => void
  onFieldChange: (workflowName: string, field: string, value: any) => void
}

function SortableWorkflowCard({
  workflow,
  isSelected,
  selectionMode,
  editMode,
  settings,
  getHealthStatus,
  monitoredServers,
  downloadingWorkflows,
  editedParams,
  onToggleSelection,
  onDownload,
  onFieldChange,
}: SortableWorkflowCardProps) {
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
        to={`/workflow/${encodeURIComponent(workflow.name)}`}
        className="workflow-card"
        onClick={(e) => {
          if (selectionMode || editMode) {
            e.preventDefault()
            if (selectionMode) {
              onToggleSelection(workflow.name)
            }
          }
        }}
      >
        <div className="workflow-card-header">
          {workflow.params.icon && (
            <div className="workflow-icon">
              <img
                src={`${workflow.folderPath}/${workflow.params.icon}`}
                alt={workflow.name}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
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
                      Object.entries(workflow.params.iconBadge as any).filter(([key]) => 
                        key !== 'content' && key !== 'colorVariant'
                      )
                    )),
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
              const serverUrl = (editedParams.comfyui_config?.serverUrl ?? workflow.params.comfyui_config!.serverUrl!) || ''
              const normalizedServerUrl = serverUrl.replace(/\/$/, '')
              const normalizedMonitoredServers = (settings.monitoredServers || []).map(s => s.replace(/\/$/, ''))
              const isMonitored = normalizedMonitoredServers.includes(normalizedServerUrl)
              const healthStatus = isMonitored ? getHealthStatus(normalizedServerUrl) : null
              const isHealthy = healthStatus?.healthy === true
              const isUnhealthy = healthStatus?.healthy === false
              
              return (
                <div className="quick-info-item">
                  <Server size={14} />
                  <span className="quick-info-label">Server:</span>
                  {editMode ? (
                    <input
                      type="text"
                      value={serverUrl}
                      onChange={(e) => onFieldChange(workflow.name, 'comfyui_config.serverUrl', e.target.value || undefined)}
                      className="quick-info-edit-input"
                      placeholder="http://127.0.0.1:8188"
                    />
                  ) : (
                    <span className="quick-info-value" title={serverUrl}>
                      {serverUrl.replace(/^https?:\/\//, '')}
                    </span>
                  )}
                  {!editMode && isMonitored && healthStatus && (
                    <span 
                      className={`server-health-indicator ${
                        isHealthy ? 'healthy' : 
                        isUnhealthy ? 'unhealthy' : 
                        'checking'
                      }`}
                      title={
                        isHealthy ? 'Server is healthy' :
                        isUnhealthy ? `Server is unhealthy: ${healthStatus.error || 'Connection failed'}` :
                        'Checking server health...'
                      }
                    >
                      <Activity size={12} />
                    </span>
                  )}
                  {!editMode && !isMonitored && (
                    <span 
                      className="server-health-indicator not-monitored"
                      title="This server is not in the monitored servers list. Add it in Settings to see health status."
                    >
                      <Activity size={12} />
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
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
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
              <label 
                className="dev-mode-checkbox"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={editedParams.devMode ?? workflow.params.devMode ?? false}
                  onChange={(e) => onFieldChange(workflow.name, 'devMode', e.target.checked || undefined)}
                />
                <Code size={14} />
                <span>Dev Mode</span>
              </label>
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
        </div>
      </Link>
      {!selectionMode && (
        <button
          className="quick-download-btn"
          onClick={(e) => onDownload(workflow.name, e)}
          disabled={downloadingWorkflows.has(workflow.name)}
          title="Download workflow"
        >
          <Download size={16} className={downloadingWorkflows.has(workflow.name) ? 'spinner' : ''} />
        </button>
      )}
    </div>
  )
}

export default function WorkflowList({ workflows, loading, error, onRefresh }: WorkflowListProps) {
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [settings, setSettings] = useState(getSettings())
  const [downloadingWorkflows, setDownloadingWorkflows] = useState<Set<string>>(new Set())
  const [showHealthCheckModal, setShowHealthCheckModal] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [localWorkflows, setLocalWorkflows] = useState<Workflow[]>(workflows)
  const [isReordering, setIsReordering] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editedWorkflows, setEditedWorkflows] = useState<Map<string, Partial<Workflow['params']>>>(new Map())

  // Update local workflows when workflows prop changes
  useEffect(() => {
    setLocalWorkflows(workflows)
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

  // Health check hook - only check servers from settings (manual only)
  // Filter out empty strings and invalid entries
  const monitoredServers = useMemo(() => {
    const servers = settings.monitoredServers || []
    return servers.filter(server => server && server.trim().length > 0)
  }, [settings.monitoredServers]);
  
  const { getHealthStatus, checkAllServers, isChecking, healthStatuses } = useServerHealthCheck(monitoredServers, {
    enabled: true, // Enable checks - they're still manual via button click
  })

  // Update settings when they change
  useEffect(() => {
    const handleStorageChange = () => {
      setSettings(getSettings())
    }
    // Listen for custom settings update event (fired from Settings page)
    window.addEventListener('settingsUpdated', handleStorageChange)
    // Also listen for storage events (from other tabs)
    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('settingsUpdated', handleStorageChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  // Filter workflows based on search term
  const filteredWorkflows = useMemo(() => {
    if (!searchTerm.trim()) {
      return workflows
    }

    const term = searchTerm.toLowerCase().trim()
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
    categories.forEach((workflows, category) => {
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

  // Expand all categories by default on first load
  useEffect(() => {
    if (expandedCategories.size === 0 && categorizedWorkflows.length > 0) {
      setExpandedCategories(new Set(categorizedWorkflows.map(([category]) => category)))
    }
  }, [categorizedWorkflows, expandedCategories.size])

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

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
    
    try {
      setDownloadingWorkflows(prev => new Set(prev).add(workflowName))
      await downloadWorkflow(workflowName)
    } catch (error) {
      console.error('Error downloading workflow:', error)
      alert('Failed to download workflow: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setDownloadingWorkflows(prev => {
        const next = new Set(prev)
        next.delete(workflowName)
        return next
      })
    }
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

  const handleFieldChange = (workflowName: string, field: string, value: any) => {
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
    } catch (error) {
      console.error('Error saving edits:', error)
      alert('Failed to save changes. Please try again.')
    }
  }

  const handleCancelEdit = () => {
    setEditedWorkflows(new Map())
    setEditMode(false)
    setLocalWorkflows(workflows) // Revert to original
  }

  return (
    <div className="workflow-list">
      <div className="list-header">
        <div className="header-left">
          <h2>
            Workflows ({filteredWorkflows.length}
            {searchTerm && filteredWorkflows.length !== workflows.length && ` of ${workflows.length}`})
          </h2>
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
              {monitoredServers.length > 0 ? (
                <button
                  onClick={() => {
                    setShowHealthCheckModal(true)
                    // Start checks immediately
                    checkAllServers()
                  }}
                  className="btn btn-secondary"
                  disabled={isChecking}
                  title={`Check health of ${monitoredServers.length} monitored server${monitoredServers.length !== 1 ? 's' : ''}`}
                >
                  <Activity size={16} className={isChecking ? 'spinner' : ''} />
                  {isChecking ? 'Checking...' : 'Check Health'}
                </button>
              ) : (
                <button
                  onClick={() => setShowHealthCheckModal(true)}
                  className="btn btn-secondary"
                  title="No servers configured. Add servers in Settings."
                >
                  <Activity size={16} />
                  Check Health
                </button>
              )}
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
      </div>

      {workflows.length === 0 ? (
        <div className="empty-state">
          <p>No workflows found</p>
          <Link to="/create" className="btn btn-primary">
            Create Your First Workflow
          </Link>
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="empty-state">
          <p>No workflows match your search "{searchTerm}"</p>
          <button
            onClick={() => setSearchTerm('')}
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
                  <div 
                    className="workflow-category-header"
                    onClick={() => toggleCategory(category)}
                  >
                    <div className="workflow-category-title">
                      <Folder size={18} />
                      <span className="category-name">{category}</span>
                      <span className="category-count">({categoryCount})</span>
                    </div>
                    <div className="workflow-category-toggle">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className="workflow-category-content">
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
                                    settings={settings}
                                    getHealthStatus={getHealthStatus}
                                    monitoredServers={monitoredServers}
                                    downloadingWorkflows={downloadingWorkflows}
                                    editedParams={editedParams}
                                    onToggleSelection={toggleSelection}
                                    onDownload={handleDownload}
                                    onFieldChange={handleFieldChange}
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
                                settings={settings}
                                getHealthStatus={getHealthStatus}
                                monitoredServers={monitoredServers}
                                downloadingWorkflows={downloadingWorkflows}
                                editedParams={{}}
                                onToggleSelection={toggleSelection}
                                onDownload={handleDownload}
                                onFieldChange={handleFieldChange}
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
          {showHealthCheckModal && (
            <HealthCheckModal
              healthStatuses={healthStatuses}
              isChecking={isChecking}
              monitoredServers={monitoredServers}
              onClose={() => setShowHealthCheckModal(false)}
            />
          )}
        </>
      )}

      {editMode && (
        <div className="edit-mode-footer">
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

