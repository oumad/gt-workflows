import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Workflow } from '../types'
import { RefreshCw, FileJson, Settings, Server, Clock, Code, Edit2, CheckSquare, X, Search, Activity, Download } from 'lucide-react'
import QuickEditModal from './QuickEditModal'
import BulkEditModal from './BulkEditModal'
import HealthCheckModal from './HealthCheckModal'
import { useServerHealthCheck } from '../hooks/useServerHealthCheck'
import { getSettings } from '../utils/settings'
import { downloadWorkflow } from '../api/workflows'
import './WorkflowList.css'

interface WorkflowListProps {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  onRefresh: () => void
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

  const sortedWorkflows = useMemo(() => {
    return [...filteredWorkflows].sort((a, b) => {
      const orderA = a.params.order ?? 999
      const orderB = b.params.order ?? 999
      return orderA - orderB
    })
  }, [filteredWorkflows])

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
                onClick={enterSelectionMode}
                className="btn btn-primary"
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
          <div className="workflow-grid">
            {sortedWorkflows.map((workflow) => {
              const isSelected = selectedWorkflows.has(workflow.name)
              return (
                <div
                  key={workflow.name}
                  className={`workflow-card-wrapper ${
                    isSelected ? 'selected' : ''
                  } ${selectionMode ? 'selection-mode' : ''}`}
                  onClick={() => {
                    if (selectionMode) {
                      toggleSelection(workflow.name)
                    }
                  }}
                >
                  {selectionMode && isSelected && (
                    <div className="selection-indicator">
                      <CheckSquare size={20} />
                    </div>
                  )}
                  <Link
                    to={`/workflow/${encodeURIComponent(workflow.name)}`}
                    className="workflow-card"
                    onClick={(e) => {
                      if (selectionMode) {
                        e.preventDefault()
                        toggleSelection(workflow.name)
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
              </div>

                  {workflow.params.description && (
                    <p className="workflow-description">{workflow.params.description}</p>
                  )}

                  <div className="workflow-quick-info">
                    {workflow.params.parser === 'comfyui' &&
                      workflow.params.comfyui_config?.serverUrl && (() => {
                        const serverUrl = workflow.params.comfyui_config!.serverUrl!
                        // Normalize server URL for comparison (remove trailing slash, ensure consistent format)
                        const normalizedServerUrl = serverUrl.replace(/\/$/, '')
                        const normalizedMonitoredServers = (settings.monitoredServers || []).map(s => s.replace(/\/$/, ''))
                        
                        // Check if this server is being monitored
                        const isMonitored = normalizedMonitoredServers.includes(normalizedServerUrl)
                        
                        // Get health status if monitored
                        const healthStatus = isMonitored ? getHealthStatus(normalizedServerUrl) : null
                        const isHealthy = healthStatus?.healthy === true
                        const isUnhealthy = healthStatus?.healthy === false
                        
                        return (
                          <div className="quick-info-item">
                            <Server size={14} />
                            <span className="quick-info-label">Server:</span>
                            <span className="quick-info-value" title={serverUrl}>
                              {serverUrl.replace(/^https?:\/\//, '')}
                            </span>
                            {isMonitored && healthStatus && (
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
                            {!isMonitored && (
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
                    {workflow.params.timeout && (
                      <div className="quick-info-item">
                        <Clock size={14} />
                        <span className="quick-info-label">Timeout:</span>
                        <span className="quick-info-value">{workflow.params.timeout}s</span>
                      </div>
                    )}
                    {workflow.params.devMode && (
                      <div className="quick-info-item">
                        <Code size={14} />
                        <span className="quick-info-value dev-mode-badge">Dev Mode</span>
                      </div>
                    )}
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
                  <>
                    <button
                      className="quick-download-btn"
                      onClick={(e) => handleDownload(workflow.name, e)}
                      disabled={downloadingWorkflows.has(workflow.name)}
                      title="Download workflow"
                    >
                      <Download size={16} className={downloadingWorkflows.has(workflow.name) ? 'spinner' : ''} />
                    </button>
                    <button
                      className="quick-edit-btn"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setEditingWorkflow(workflow)
                      }}
                      title="Quick Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                  </>
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
    </div>
  )
}

