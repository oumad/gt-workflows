import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { WorkflowParams, IconBadge, WorkflowJson, SubgraphConfig } from '@/types'
import {
  getWorkflowParams,
  getWorkflowJson,
  saveWorkflowParams,
  uploadFile,
  deleteWorkflowFile,
} from '@/services/api/workflows'
import { ArrowLeft, Save, FileJson, Settings, Eye, EyeOff, RotateCcw, Info, Image as ImageIcon, Upload, X, AlertCircle, ChevronDown, ChevronUp, GripVertical, Plus, Trash2, Download, Copy, FileText, Package, Play } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Editor from '@monaco-editor/react'
import AuthImage from '@/components/ui/AuthImage'
import NodeManager from './NodeManager'
import SaveConfirmationModal from '@/components/modals/SaveConfirmationModal'
import ResetConfirmationModal from '@/components/modals/ResetConfirmationModal'
import DuplicateModal from '@/components/modals/DuplicateModal'
import DownloadModal from '@/components/modals/DownloadModal'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import DependencyAuditModal from '@/components/modals/DependencyAuditModal'
import type { DependencyAuditCache } from '@/components/modals/DependencyAuditModal'
import { TestWorkflowModal } from '@/components/modals/TestWorkflowModal'
import { useTestWorkflow } from '@/hooks/useTestWorkflow'
import ServerUrlEditor from '@/components/ui/ServerUrlEditor'
import { compressImage } from '@/utils/imageCompression'
import { getPrimaryServerUrl, getServerUrls } from '@/utils/serverUrl'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import type { WorkflowDetailUIState, LastRunStatus } from '@/services/api/preferences'
import { formatDateTimeShort } from '@/utils/dateFormat'
import './WorkflowDetail.css'

interface WorkflowDetailProps {
  onUpdate: () => void
}

interface SubgraphEditorProps {
  nodeId: string
  config: SubgraphConfig
  workflowJson: WorkflowJson | null
  onUpdate: (config: SubgraphConfig) => void
  onDelete: () => void
}

function SubgraphEditor({ nodeId, config, workflowJson, onUpdate, onDelete }: SubgraphEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [nodesOrder, setNodesOrder] = useState<string[]>(config.nodesOrder || [])
  const [newNodeId, setNewNodeId] = useState('')

  // Get child nodes for this subgraph with their titles
  const childNodes = useMemo(() => {
    if (!workflowJson) return []
    const children: Array<{ id: string; fullId: string; title: string; classType: string }> = []
    const prefix = `${nodeId}:`
    Object.keys(workflowJson).forEach(key => {
      if (key.startsWith(prefix)) {
        const childId = key.split(':')[1]
        if (childId) {
          const fullId = key
          const node = workflowJson[fullId]
          const title = node?._meta?.title || node?.class_type || childId
          const classType = node?.class_type || ''
          if (!children.find(c => c.id === childId)) {
            children.push({
              id: childId,
              fullId,
              title,
              classType
            })
          }
        }
      }
    })
    return children.sort((a, b) => a.id.localeCompare(b.id))
  }, [workflowJson, nodeId])

  // Helper to get node info by child ID
  const getNodeInfo = (childId: string) => {
    return childNodes.find(n => n.id === childId) || { id: childId, fullId: `${nodeId}:${childId}`, title: childId, classType: '' }
  }

  useEffect(() => {
    setNodesOrder(config.nodesOrder || [])
  }, [config.nodesOrder])

  const handleUpdateNodesOrder = (newOrder: string[]) => {
    setNodesOrder(newOrder)
    onUpdate({
      ...config,
      nodesOrder: newOrder.length > 0 ? newOrder : undefined
    })
  }

  const moveNode = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...nodesOrder]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex >= 0 && newIndex < newOrder.length) {
      [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]]
      handleUpdateNodesOrder(newOrder)
    }
  }

  const removeNode = (index: number) => {
    const newOrder = nodesOrder.filter((_, i) => i !== index)
    handleUpdateNodesOrder(newOrder)
  }

  const addNode = () => {
    if (newNodeId.trim() && !nodesOrder.includes(newNodeId.trim())) {
      handleUpdateNodesOrder([...nodesOrder, newNodeId.trim()])
      setNewNodeId('')
    }
  }

  const availableNodes = childNodes.filter(node => !nodesOrder.includes(node.id))

  return (
    <div className="subgraph-editor">
      <div className="subgraph-header" onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          <strong>Subgraph {nodeId}</strong>
          {config.label && <span style={{ color: 'var(--text-secondary)', fontSize: '0.9em' }}>— {config.label}</span>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete subgraph ${nodeId}?`)) {
              onDelete()
            }
          }}
          className="btn-icon-small"
          title="Delete subgraph"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {expanded && (
        <div className="subgraph-content">
          <div className="info-grid">
            <div className="info-item">
              <label>Label</label>
              <input
                type="text"
                value={config.label || ''}
                onChange={(e) => onUpdate({ ...config, label: e.target.value || undefined })}
                placeholder="Subgraph label"
                className="info-input"
              />
            </div>
            <div className="info-item">
              <label>Hide Node Labels</label>
              <select
                value={typeof config.hideNodeLabels === 'boolean' ? (config.hideNodeLabels ? 'all' : 'none') : 'array'}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === 'all') {
                    onUpdate({ ...config, hideNodeLabels: true })
                  } else if (value === 'none') {
                    onUpdate({ ...config, hideNodeLabels: false })
                  } else {
                    onUpdate({ ...config, hideNodeLabels: config.hideNodeLabels || [] })
                  }
                }}
                className="info-input"
              >
                <option value="none">None</option>
                <option value="all">All</option>
                <option value="array">Specific nodes (edit in JSON)</option>
              </select>
            </div>
            <div className="info-item">
              <label>Show Node Labels</label>
              <select
                value={typeof config.showNodeLabels === 'boolean' ? (config.showNodeLabels ? 'all' : 'none') : 'array'}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === 'all') {
                    onUpdate({ ...config, showNodeLabels: true })
                  } else if (value === 'none') {
                    onUpdate({ ...config, showNodeLabels: false })
                  } else {
                    onUpdate({ ...config, showNodeLabels: config.showNodeLabels || [] })
                  }
                }}
                className="info-input"
              >
                <option value="none">None</option>
                <option value="all">All</option>
                <option value="array">Specific nodes (edit in JSON)</option>
              </select>
            </div>
          </div>

          <div className="info-item info-item-full" style={{ marginTop: '16px' }}>
            <label>Nodes Order</label>
            <small style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
              Specify the display order of child nodes. Only use the child node ID (part after the colon).
            </small>
            {nodesOrder.length > 0 ? (
              <div className="nodes-order-list">
                {nodesOrder.map((childId, index) => {
                  const nodeInfo = getNodeInfo(childId)
                  return (
                    <div key={index} className="nodes-order-item">
                      <GripVertical size={16} className="grip-icon" />
                      <div className="node-info">
                        <div className="node-id-row">
                          <span className="node-id">{childId}</span>
                          <span className="full-node-id">{nodeInfo.fullId}</span>
                        </div>
                        <div className="node-title">{nodeInfo.title}</div>
                        {nodeInfo.classType && (
                          <div className="node-class-type">{nodeInfo.classType}</div>
                        )}
                      </div>
                      <div className="nodes-order-actions">
                        <button
                          onClick={() => moveNode(index, 'up')}
                          disabled={index === 0}
                          className="btn-icon-small"
                          title="Move up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveNode(index, 'down')}
                          disabled={index === nodesOrder.length - 1}
                          className="btn-icon-small"
                          title="Move down"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => removeNode(index)}
                          className="btn-icon-small"
                          title="Remove"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px', marginBottom: '8px' }}>
                <small style={{ color: 'var(--text-secondary)' }}>No nodes in order. Nodes will appear in default order.</small>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <select
                value={newNodeId}
                onChange={(e) => setNewNodeId(e.target.value)}
                className="info-input"
                style={{ flex: 1 }}
              >
                <option value="">Select a node to add...</option>
                {availableNodes.map(node => (
                  <option key={node.id} value={node.id}>
                    {node.id}: {node.title} ({node.classType})
                  </option>
                ))}
              </select>
              <button
                onClick={addNode}
                disabled={!newNodeId.trim()}
                className="btn btn-secondary"
              >
                <Plus size={16} />
                Add
              </button>
            </div>
            {childNodes.length > 0 && (
              <small style={{ display: 'block', marginTop: '8px', color: 'var(--text-secondary)' }}>
                Available child nodes: {childNodes.map(n => `${n.id} (${n.title})`).join(', ')}
              </small>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function WorkflowDetail({ onUpdate }: WorkflowDetailProps) {
  const { name } = useParams<{ name: string }>()
  const [params, setParams] = useState<WorkflowParams | null>(null)
  const [originalParams, setOriginalParams] = useState<WorkflowParams | null>(null)
  const [workflowJson, setWorkflowJson] = useState<WorkflowJson | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWorkflowJson, setShowWorkflowJson] = useState(false)
  const [showParamsJson, setShowParamsJson] = useState(false)
  const [editParamsJson, setEditParamsJson] = useState(false)
  const [paramsText, setParamsText] = useState('')
  const [workflowHighlightRef, setWorkflowHighlightRef] = useState<HTMLDivElement | null>(null)
  const [workflowScrollRef, setWorkflowScrollRef] = useState<HTMLDivElement | null>(null)
  const [iconError, setIconError] = useState(false)
  const [iconDragOver, setIconDragOver] = useState(false)
  const [workflowDragOver, setWorkflowDragOver] = useState(false)
  const [iconVersion, setIconVersion] = useState(0) // For cache-busting when icon is updated
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [fileParams, setFileParams] = useState<WorkflowParams | null>(null)
  const [hasExternalChanges, setHasExternalChanges] = useState(false)
  const [externalParams, setExternalParams] = useState<WorkflowParams | null>(null)
  const [showSuccessMessage, setShowSuccessMessage] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [showDependencyAudit, setShowDependencyAudit] = useState(false)
  const [dependencyAuditCache, setDependencyAuditCache] = useState<DependencyAuditCache | null>(null)
  // Invalidate audit cache when workflow or server config changes
  const prevAuditKeyRef = useRef(`${name}|${params?.comfyui_config?.serverUrl}`)
  useEffect(() => {
    const key = `${name}|${params?.comfyui_config?.serverUrl}`
    if (key !== prevAuditKeyRef.current) {
      prevAuditKeyRef.current = key
      setDependencyAuditCache(null)
    }
  }, [name, params?.comfyui_config?.serverUrl])
  const [showTestWorkflow, setShowTestWorkflow] = useState(false)
  const testServerUrls = useMemo(() => getServerUrls(params?.comfyui_config?.serverUrl), [params?.comfyui_config?.serverUrl])
  const testWorkflowHook = useTestWorkflow(workflowJson, testServerUrls)
  const workflowDetailUIRef = useRef<Record<string, WorkflowDetailUIState>>({})
  const [lastTestRun, setLastTestRun] = useState<string | null>(null)
  const [lastTestRunStatus, setLastTestRunStatus] = useState<LastRunStatus | null>(null)
  const [lastAuditRun, setLastAuditRun] = useState<string | null>(null)
  const [lastAuditRunStatus, setLastAuditRunStatus] = useState<LastRunStatus | null>(null)
  const testPhasePrevRef = useRef<string | undefined>(undefined)

  // Load persisted workflow detail UI state (JSON panels open/closed, last run timestamps)
  useEffect(() => {
    if (!name) return
    getPreferences()
      .then((prefs) => {
        workflowDetailUIRef.current = prefs.workflowDetailUI ?? {}
        const ui = prefs.workflowDetailUI?.[name]
        if (ui) {
          if (typeof ui.showWorkflowJson === 'boolean') setShowWorkflowJson(ui.showWorkflowJson)
          if (typeof ui.showParamsJson === 'boolean') setShowParamsJson(ui.showParamsJson)
          if (typeof ui.lastTestRun === 'string') setLastTestRun(ui.lastTestRun)
          else setLastTestRun(null)
          setLastTestRunStatus(ui.lastTestRunStatus === 'ok' || ui.lastTestRunStatus === 'nok' ? ui.lastTestRunStatus : null)
          if (typeof ui.lastAuditRun === 'string') setLastAuditRun(ui.lastAuditRun)
          else setLastAuditRun(null)
          setLastAuditRunStatus(ui.lastAuditRunStatus === 'ok' || ui.lastAuditRunStatus === 'nok' ? ui.lastAuditRunStatus : null)
        } else {
          setShowWorkflowJson(false)
          setShowParamsJson(false)
          setLastTestRun(null)
          setLastTestRunStatus(null)
          setLastAuditRun(null)
          setLastAuditRunStatus(null)
        }
      })
      .catch(() => {})
  }, [name])

  const persistWorkflowDetailUI = useCallback(
    (workflowName: string, showWorkflow: boolean, showParams: boolean) => {
      const current = workflowDetailUIRef.current[workflowName] ?? {}
      const next: Record<string, WorkflowDetailUIState> = {
        ...workflowDetailUIRef.current,
        [workflowName]: {
          ...current,
          showWorkflowJson: showWorkflow,
          showParamsJson: showParams,
        },
      }
      workflowDetailUIRef.current = next
      updatePreferences({ workflowDetailUI: next }).catch(() => {})
    },
    []
  )

  const persistLastRun = useCallback(
    (workflowName: string, type: 'test' | 'audit', timestamp: string, status?: LastRunStatus) => {
      const current = workflowDetailUIRef.current[workflowName] ?? {}
      const next: Record<string, WorkflowDetailUIState> = {
        ...workflowDetailUIRef.current,
        [workflowName]: {
          ...current,
          ...(type === 'test'
            ? { lastTestRun: timestamp, lastTestRunStatus: status }
            : { lastAuditRun: timestamp, lastAuditRunStatus: status }),
        },
      }
      workflowDetailUIRef.current = next
      if (type === 'test') {
        setLastTestRun(timestamp)
        setLastTestRunStatus(status ?? null)
      } else {
        setLastAuditRun(timestamp)
        setLastAuditRunStatus(status ?? null)
      }
      updatePreferences({ workflowDetailUI: next }).catch(() => {})
    },
    []
  )

  // Persist last test run when test completes or errors
  useEffect(() => {
    const phase = testWorkflowHook.state.phase
    const prev = testPhasePrevRef.current
    testPhasePrevRef.current = phase
    if (
      name &&
      (phase === 'completed' || phase === 'error') &&
      prev !== 'completed' &&
      prev !== 'error'
    ) {
      persistLastRun(name, 'test', new Date().toISOString(), phase === 'completed' ? 'ok' : 'nok')
    }
  }, [name, testWorkflowHook.state.phase, persistLastRun])

  useEffect(() => {
    if (workflowScrollRef && workflowHighlightRef) {
      const syncScroll = () => {
        if (workflowHighlightRef && workflowScrollRef) {
          workflowHighlightRef.scrollTop = workflowScrollRef.scrollTop
          workflowHighlightRef.scrollLeft = workflowScrollRef.scrollLeft
        }
      }
      workflowScrollRef.addEventListener('scroll', syncScroll)
      return () => workflowScrollRef.removeEventListener('scroll', syncScroll)
    }
  }, [workflowScrollRef, workflowHighlightRef])

  useEffect(() => {
    if (name) {
      loadWorkflow()
    }
  }, [name])

  // Check for external changes periodically
  useEffect(() => {
    if (!name || !params || !originalParams) return

    const checkForExternalChanges = async () => {
      try {
        const currentFileParams = await getWorkflowParams(name)
        const currentFileStr = JSON.stringify(currentFileParams, null, 2)
        const originalStr = JSON.stringify(originalParams, null, 2)
        
        if (currentFileStr !== originalStr) {
          // External changes detected
          const currentParamsStr = JSON.stringify(params, null, 2)
          if (currentFileStr !== currentParamsStr) {
            setHasExternalChanges(true)
            setExternalParams(currentFileParams)
          }
        } else {
          setHasExternalChanges(false)
          setExternalParams(null)
        }
      } catch {
        // Silently fail - file might not exist or be accessible
      }
    }

    // Check every 5 seconds
    const interval = setInterval(checkForExternalChanges, 5000)

    return () => {
      clearInterval(interval)
    }
  }, [name, params, originalParams])

  useEffect(() => {
    if (params && !editParamsJson) {
      setParamsText(JSON.stringify(params, null, 2))
    }
  }, [params, editParamsJson])

  const loadWorkflow = async () => {
    if (!name) return
    try {
      setLoading(true)
      setError(null)
      setEditParamsJson(false)
      setHasExternalChanges(false)
      setExternalParams(null)
      const [paramsData, jsonData] = await Promise.all([
        getWorkflowParams(name),
        getWorkflowJson(name).catch(() => null),
      ])
      setParams(paramsData)
      setOriginalParams(JSON.parse(JSON.stringify(paramsData))) // Deep clone
      setParamsText(JSON.stringify(paramsData, null, 2))
      setWorkflowJson(jsonData)
      setIconError(false)
      setIconVersion(Date.now()) // Update icon version on load to ensure fresh image
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveClick = async () => {
    if (!name || !params) return
    
    // Check for external changes before showing modal
    try {
      const currentFileParams = await getWorkflowParams(name)
      const currentFileStr = JSON.stringify(currentFileParams, null, 2)
      const originalStr = JSON.stringify(originalParams, null, 2)
      
      if (currentFileStr !== originalStr) {
        const currentParamsStr = JSON.stringify(params, null, 2)
        if (currentFileStr !== currentParamsStr) {
          setHasExternalChanges(true)
          setExternalParams(currentFileParams)
        } else {
          setHasExternalChanges(false)
          setExternalParams(null)
        }
      } else {
        setHasExternalChanges(false)
        setExternalParams(null)
      }
    } catch {
      setHasExternalChanges(false)
      setExternalParams(null)
    }
    setShowSaveModal(true)
  }

  const handleSaveConfirm = async () => {
    if (!name || !params) return
    try {
      setSaving(true)
      setError(null)
      const paramsToSave: WorkflowParams = { ...params }
      if (paramsToSave.comfyui_config?._workflowUploaded) {
        const { _workflowUploaded, ...comfyuiConfig } = paramsToSave.comfyui_config
        paramsToSave.comfyui_config = comfyuiConfig
      }
      // Remove temporary icon upload flag
      if (paramsToSave._iconUploaded !== undefined) {
        delete paramsToSave._iconUploaded
      }
      await saveWorkflowParams(name, paramsToSave)
      // Update originalParams with the saved params (without temporary flags)
      setOriginalParams(JSON.parse(JSON.stringify(paramsToSave))) // Update original
      // Also update current params to remove temporary flags
      setParams(paramsToSave)
      setHasExternalChanges(false)
      setExternalParams(null)
      setShowSaveModal(false)
      setShowSuccessMessage(true)
      onUpdate()
      
      // Hide success message after 3 seconds
      setTimeout(() => {
        setShowSuccessMessage(false)
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow')
      setShowSaveModal(false)
    } finally {
      setSaving(false)
    }
  }

  const handleReload = async () => {
    if (!name) return
    try {
      setLoading(true)
      setError(null)
      setEditParamsJson(false)
      const freshParams = await getWorkflowParams(name)
      setParams(freshParams)
      setOriginalParams(JSON.parse(JSON.stringify(freshParams))) // Deep clone
      setParamsText(JSON.stringify(freshParams, null, 2))
      setHasExternalChanges(false)
      setExternalParams(null)
      setShowSaveModal(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload workflow')
    } finally {
      setLoading(false)
    }
  }

  const handleOverwrite = async () => {
    await handleSaveConfirm()
  }

  const handleSaveParamsJson = async () => {
    if (!name || !paramsText) return
    try {
      const parsedParams = JSON.parse(paramsText)
      
      // Check for external changes
      try {
        const currentFileParams = await getWorkflowParams(name)
        const currentFileStr = JSON.stringify(currentFileParams, null, 2)
        const originalStr = JSON.stringify(originalParams, null, 2)
        
        if (currentFileStr !== originalStr) {
          const parsedStr = JSON.stringify(parsedParams, null, 2)
          if (currentFileStr !== parsedStr) {
            if (!confirm('Warning: params.json has been modified externally. Saving will overwrite those changes. Continue?')) {
              return
            }
          }
        }
      } catch {
        // Continue even if check fails
      }
      setSaving(true)
      setError(null)
      await saveWorkflowParams(name, parsedParams)
      setParams(parsedParams)
      setOriginalParams(JSON.parse(JSON.stringify(parsedParams))) // Deep clone
      setEditParamsJson(false)
      setParamsText(JSON.stringify(parsedParams, null, 2))
      setHasExternalChanges(false)
      setExternalParams(null)
      onUpdate()
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON format')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save workflow')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleEditParamsJson = () => {
    setEditParamsJson(true)
    setParamsText(JSON.stringify(params, null, 2))
  }

  const handleCancelEditParamsJson = () => {
    setEditParamsJson(false)
    setParamsText(JSON.stringify(params, null, 2))
  }

  const handleParamsUpdate = (updatedParams: WorkflowParams) => {
    setParams(updatedParams)
    if (!editParamsJson) {
      setParamsText(JSON.stringify(updatedParams, null, 2))
    }
  }

  // Detect if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!originalParams || !params) return false
    return JSON.stringify(originalParams, null, 2) !== JSON.stringify(params, null, 2)
  }, [originalParams, params])

  // Check if a specific field has changed
  const isFieldChanged = (fieldPath: string): boolean => {
    if (!originalParams || !params) return false
    const paths = fieldPath.split('.')
    let originalValue: unknown = originalParams
    let currentValue: unknown = params
    
    for (const path of paths) {
      originalValue = originalValue?.[path]
      currentValue = currentValue?.[path]
    }
    
    return JSON.stringify(originalValue) !== JSON.stringify(currentValue)
  }

  const handleResetClick = async () => {
    if (!name || !params) return
    
    // Load current file params to compare
    try {
      const currentFileParams = await getWorkflowParams(name)
      setFileParams(currentFileParams)
      setShowResetModal(true)
    } catch (err) {
      // If we can't load file params, still show modal
      setFileParams(null)
      setShowResetModal(true)
    }
  }

  const handleResetConfirm = async () => {
    if (!name) return
    try {
      setLoading(true)
      setError(null)
      const freshParams = await getWorkflowParams(name)
      setParams(freshParams)
      setOriginalParams(JSON.parse(JSON.stringify(freshParams))) // Deep clone
      setParamsText(JSON.stringify(freshParams, null, 2))
      setHasExternalChanges(false)
      setExternalParams(null)
      setFileParams(null)
      setShowResetModal(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset workflow')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    setShowDownloadModal(true)
  }

  const handleDuplicate = () => {
    setShowDuplicateModal(true)
  }

  if (loading) {
    return (
      <div className="loading-container">
        <p>Loading workflow...</p>
      </div>
    )
  }

  if (error && !params) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <Link to="/workflows" className="btn btn-primary">
          <ArrowLeft size={16} /> Back to List
        </Link>
      </div>
    )
  }

  return (
    <div className={`workflow-detail ${hasUnsavedChanges ? 'has-floating-apply' : ''}`}>
      <div className="detail-header">
        <Link to="/workflows" className="btn btn-secondary">
          <ArrowLeft size={16} /> Back
        </Link>
        <div className="workflow-title-section">
          <h1 className="page-title">
            <FileJson size={24} />
            {params?.label || name}
          </h1>
        </div>
        <div className="header-actions">
          {params?.parser === 'comfyui' && workflowJson && params.comfyui_config?.serverUrl && (
            <>
              <button
                onClick={() => setShowTestWorkflow(true)}
                disabled={loading}
                className="btn btn-secondary"
                title="Test-execute workflow on ComfyUI server"
              >
                <Play size={16} /> Test
              </button>
              <button
                onClick={() => setShowDependencyAudit(true)}
                disabled={loading}
                className="btn btn-secondary"
                title="Audit workflow dependencies against ComfyUI server(s)"
              >
                <Package size={16} /> Audit
              </button>
            </>
          )}
          <button
            onClick={handleDuplicate}
            disabled={loading}
            className="btn btn-secondary"
            title="Duplicate workflow"
          >
            <Copy size={16} /> Duplicate
          </button>
          <button
            onClick={handleDownload}
            disabled={loading}
            className="btn btn-secondary"
            title="Download workflow"
          >
            <Download size={16} /> Download
          </button>
          <button
            onClick={handleResetClick}
            disabled={loading || saving}
            className="btn btn-secondary"
            title="Reset to saved version"
          >
            <RotateCcw size={16} /> Reset
          </button>
          {hasExternalChanges && (
            <div className="external-changes-indicator" title="params.json has been modified externally">
              <AlertCircle size={16} />
              <span>External Changes</span>
            </div>
          )}
          <button
            onClick={handleSaveClick}
            disabled={saving}
            className={`btn btn-primary ${hasUnsavedChanges ? 'has-changes' : ''}`}
            title={hasUnsavedChanges ? 'Apply changes' : 'View current state and apply'}
          >
            <Save size={16} /> {saving ? 'Applying...' : 'Apply'}
            {hasUnsavedChanges && <span className="unsaved-indicator" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
        </div>
      )}

      <div className="detail-content">
        {params && (
          <>
            {/* General Info Section */}
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
                        workflowName={name || ''}
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
                                const next = (params.tags || []).filter((t: string) => t !== tag);
                                handleParamsUpdate({ ...params, tags: next.length > 0 ? next : undefined });
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
                            const input = e.target as HTMLInputElement;
                            const value = input.value.trim();
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              if (value) {
                                const current = params.tags || [];
                                if (!current.includes(value)) {
                                  handleParamsUpdate({ ...params, tags: [...current, value] });
                                  input.value = '';
                                }
                              }
                            } else if (e.key === 'Backspace' && !value && (params.tags || []).length > 0) {
                              e.preventDefault();
                              const current = params.tags || [];
                              handleParamsUpdate({ ...params, tags: current.slice(0, -1) });
                            }
                          }}
                          onPaste={(e) => {
                            const pasted = e.clipboardData.getData('text').trim();
                            if (!pasted) return;
                            const newTags = pasted.split(/[\s,]+/).map((t: string) => t.trim()).filter((t: string) => t);
                            if (newTags.length <= 1) return;
                            e.preventDefault();
                            const current = params.tags || [];
                            const merged = [...current];
                            newTags.forEach((t: string) => { if (!merged.includes(t)) merged.push(t); });
                            handleParamsUpdate({ ...params, tags: merged.length > 0 ? merged : undefined });
                            (e.target as HTMLInputElement).value = '';
                          }}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (value) {
                              const current = params.tags || [];
                              if (!current.includes(value)) {
                                handleParamsUpdate({ ...params, tags: [...current, value] });
                                e.target.value = '';
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
                          iconBadge: e.target.value ? { ...params.iconBadge, content: e.target.value } : undefined
                        })}
                        placeholder="Badge content"
                        className="info-input"
                        style={{ flex: '1', minWidth: '150px' }}
                      />
                      <select
                        value={params.iconBadge?.colorVariant || ''}
                        onChange={(e) => {
                          const colorVariant = e.target.value as IconBadge['colorVariant'] | '';
                          handleParamsUpdate({
                            ...params,
                            iconBadge: params.iconBadge ? {
                              ...params.iconBadge,
                              colorVariant: colorVariant || undefined
                            } : { content: '', colorVariant: colorVariant || undefined }
                          });
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
                        <button
                          type="button"
                          onClick={() => handleParamsUpdate({ ...params, iconBadge: undefined })}
                          className="btn-icon"
                        >
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
                          <button
                            type="button"
                            onClick={async () => {
                              if (!name || !params.icon) return;
                              const iconFilename = params.icon.replace(/^\.\//, '');
                              try {
                                // Delete the icon file
                                await deleteWorkflowFile(name, iconFilename);
                                // Update params (don't auto-save - user must click Apply)
                                const updatedParams = { ...params, icon: undefined };
                                handleParamsUpdate(updatedParams);
                                // Update icon version to force UI refresh
                                setIconVersion(Date.now());
                                setIconError(false);
                              } catch {
                                // Still remove from params even if file deletion fails
                                const updatedParams = { ...params, icon: undefined };
                                handleParamsUpdate(updatedParams);
                                // Update icon version to force UI refresh
                                setIconVersion(Date.now());
                                setIconError(false);
                                // Don't auto-save - user must click Apply
                              }
                            }}
                            className="btn-icon"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <label 
                          className={`file-drop-zone ${iconDragOver ? 'drag-over' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIconDragOver(true);
                          }}
                          onDragLeave={() => setIconDragOver(false)}
                          onDrop={async (e) => {
                            e.preventDefault();
                            setIconDragOver(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.type.startsWith('image/') && name) {
                              try {
                                // Compress image before uploading
                                const compressedFile = await compressImage(file, 800, 0.85);
                                const result = await uploadFile(name, compressedFile);
                                // Add temporary flag to track icon upload even if path is the same
                                const updatedParams = { 
                                  ...params, 
                                  icon: result.relativePath,
                                  _iconUploaded: Date.now() // Temporary flag to track upload
                                };
                                handleParamsUpdate(updatedParams);
                                // Update icon version to force browser cache refresh
                                setIconVersion(Date.now());
                                setIconError(false); // Reset error state in case it was set
                                // Don't auto-save - user must click Apply
                              } catch (error) {
                                alert('Failed to upload icon: ' + (error instanceof Error ? error.message : 'Unknown error'));
                              }
                            }
                          }}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file && name) {
                              try {
                                // Compress image before uploading
                                const compressedFile = await compressImage(file, 800, 0.85);
                                const result = await uploadFile(name, compressedFile);
                                // Add temporary flag to track icon upload even if path is the same
                                const updatedParams = { 
                                  ...params, 
                                  icon: result.relativePath,
                                  _iconUploaded: Date.now() // Temporary flag to track upload
                                };
                                handleParamsUpdate(updatedParams);
                                // Update icon version to force browser cache refresh
                                setIconVersion(Date.now());
                                setIconError(false); // Reset error state in case it was set
                                // Don't auto-save - user must click Apply
                              } catch (error) {
                                alert('Failed to upload icon: ' + (error instanceof Error ? error.message : 'Unknown error'));
                              }
                              }
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

            {/* Dashboard Config Section */}
            {(params.dashboard || params.parser !== 'comfyui') && (
              <div className="detail-section">
                <div className="section-header">
                  <Settings size={20} />
                  <h2>Dashboard Configuration</h2>
                  {!params.dashboard && (
                    <button
                      onClick={() => handleParamsUpdate({ ...params, dashboard: {} })}
                      className="btn btn-secondary"
                      style={{ marginLeft: 'auto' }}
                    >
                      Add Dashboard Config
                    </button>
                  )}
                </div>
                {params.dashboard && (
                  <div className="info-grid">
                    <div className="info-item">
                      <label>Disable Dashboard</label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={params.dashboard.disable || false}
                          onChange={(e) => handleParamsUpdate({
                            ...params,
                            dashboard: { ...params.dashboard, disable: e.target.checked || undefined }
                          })}
                        />
                        <span>Disable</span>
                      </label>
                    </div>
                    <div className="info-item">
                      <label>Break Size</label>
                      <input
                        type="number"
                        value={params.dashboard.breakSize || ''}
                        onChange={(e) => handleParamsUpdate({
                          ...params,
                          dashboard: { ...params.dashboard, breakSize: e.target.value ? Number(e.target.value) : undefined }
                        })}
                        placeholder="Panel size threshold"
                        className="info-input"
                      />
                      <small>Size at which dashboard appears</small>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Use/Selectors Section */}
            {(params.use || params.parser !== 'comfyui') && (
              <div className="detail-section">
                <div className="section-header">
                  <Settings size={20} />
                  <h2>Data Selectors</h2>
                  {!params.use && (
                    <button
                      onClick={() => handleParamsUpdate({ ...params, use: {} })}
                      className="btn btn-secondary"
                      style={{ marginLeft: 'auto' }}
                    >
                      Add Selectors
                    </button>
                  )}
                </div>
                {params.use && (
                  <>
                    <div className="info-grid">
                      <div className="info-item">
                        <label>Current Project</label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={!!params.use.currentProject}
                            onChange={(e) => handleParamsUpdate({
                              ...params,
                              use: {
                                ...(params.use || {}),
                                currentProject: e.target.checked ? (typeof params.use?.currentProject === 'object' ? params.use.currentProject : true) : undefined
                              }
                            })}
                          />
                          <span>Enable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>App Config</label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={!!params.use.appConfig}
                            onChange={(e) => handleParamsUpdate({
                              ...params,
                              use: {
                                ...(params.use || {}),
                                appConfig: e.target.checked ? (typeof params.use?.appConfig === 'object' ? params.use.appConfig : true) : undefined
                              }
                            })}
                          />
                          <span>Enable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>Items</label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={!!params.use.items}
                            onChange={(e) => handleParamsUpdate({
                              ...params,
                              use: {
                                ...(params.use || {}),
                                items: e.target.checked ? (typeof params.use?.items === 'object' ? params.use.items : true) : undefined
                              }
                            })}
                          />
                          <span>Enable</span>
                        </label>
                      </div>
                      <div className="info-item">
                        <label>Selected Images</label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={!!params.use.selectedImages}
                            onChange={(e) => handleParamsUpdate({
                              ...params,
                              use: {
                                ...(params.use || {}),
                                selectedImages: e.target.checked ? (typeof params.use?.selectedImages === 'object' ? params.use.selectedImages : true) : undefined
                              }
                            })}
                          />
                          <span>Enable</span>
                        </label>
                      </div>
                    </div>
                    <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                      <small style={{ color: 'var(--text-secondary)' }}>
                        Advanced selector configuration can be edited in the JSON editor below.
                        Use fields, objectTypeFields, scope, and includesScenes can be configured there.
                      </small>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* UI Configuration Section */}
            {params.parser !== 'comfyui' && params.ui && (
              <div className="detail-section">
                <div className="section-header">
                  <Settings size={20} />
                  <h2>UI Configuration (Categories & Rows)</h2>
                </div>
                <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                  <p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>
                    UI configuration allows you to organize parameters into categories and rows.
                    Use the JSON editor below to configure categories, rows, and parameter visibility.
                  </p>
                  <div style={{ marginTop: '12px' }}>
                    <strong>Available Categories:</strong>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                      {Object.keys(params.ui).map(category => (
                        <li key={category}>{category}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* ComfyUI Config Section */}
            {params.parser === 'comfyui' && params.comfyui_config && (
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
                        value={params.comfyui_config?.serverUrl}
                        onChange={(v) => handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...(params.comfyui_config || {}),
                            serverUrl: v
                          }
                        })}
                        className={isFieldChanged('comfyui_config.serverUrl') ? 'field-changed' : ''}
                        onViewLogs={(url) => setLogsServerUrl(url)}
                      />
                      {params.comfyui_config?.serverUrl && (
                        <button
                          type="button"
                          className="workflow-detail-logs-btn"
                          onClick={() => setLogsServerUrl(getPrimaryServerUrl(params.comfyui_config!.serverUrl!))}
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
                      {params.comfyui_config.workflow ? (
                        <div className="file-info">
                          <span>{params.comfyui_config.workflow.replace(/^\.\//, '')}</span>
                          <button
                            type="button"
                            onClick={() => handleParamsUpdate({
                              ...params,
                              comfyui_config: {
                                ...(params.comfyui_config || {}),
                                workflow: undefined
                              }
                            })}
                            className="btn-icon"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <label 
                          className={`file-drop-zone ${workflowDragOver ? 'drag-over' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setWorkflowDragOver(true);
                          }}
                          onDragLeave={() => setWorkflowDragOver(false)}
                          onDrop={async (e) => {
                            e.preventDefault();
                            setWorkflowDragOver(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith('.json') && name) {
                              try {
                                const result = await uploadFile(name, file);
                                // Always update params with workflow path and a timestamp to ensure change detection
                                // even if the path stays the same (same filename)
                                const updatedParams = {
                                  ...params,
                                  comfyui_config: {
                                    ...(params.comfyui_config || {}),
                                    workflow: result.relativePath,
                                    _workflowUploaded: Date.now() // Temporary flag to track upload
                                  }
                                };
                                handleParamsUpdate(updatedParams);
                                // Reload workflow JSON after upload
                                const jsonData = await getWorkflowJson(name);
                                setWorkflowJson(jsonData);
                                // Note: We don't update originalParams here - that happens when user clicks Apply
                                // This ensures the workflow file change is detected as an unsaved change
                              } catch (error) {
                                alert('Failed to upload workflow file: ' + (error instanceof Error ? error.message : 'Unknown error'));
                              }
                            }
                          }}
                        >
                          <input
                            type="file"
                            accept=".json"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file && name) {
                                try {
                                  const result = await uploadFile(name, file);
                                  // Always update params with workflow path and a timestamp to ensure change detection
                                  // even if the path stays the same (same filename)
                                  const updatedParams = {
                                    ...params,
                                    comfyui_config: {
                                      ...params.comfyui_config,
                                      workflow: result.relativePath,
                                      _workflowUploaded: Date.now() // Temporary flag to track upload
                                    }
                                  };
                                  handleParamsUpdate(updatedParams);
                                  // Reload workflow JSON after upload
                                  const jsonData = await getWorkflowJson(name);
                                  setWorkflowJson(jsonData);
                                  // Note: We don't update originalParams here - that happens when user clicks Apply
                                  // This ensures the workflow file change is detected as an unsaved change
                                } catch (error) {
                                  alert('Failed to upload workflow file: ' + (error instanceof Error ? error.message : 'Unknown error'));
                                }
                              }
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
                      value={params.comfyui_config?.saveOutputPath || ''}
                      onChange={(e) => handleParamsUpdate({
                        ...params,
                        comfyui_config: {
                          ...(params.comfyui_config || {}),
                          saveOutputPath: e.target.value || undefined
                        }
                      })}
                      placeholder="/path/to/output"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Save Input Path</label>
                    <input
                      type="text"
                      value={params.comfyui_config?.SAVE_INPUT_PATH || ''}
                      onChange={(e) => handleParamsUpdate({
                        ...params,
                        comfyui_config: {
                          ...(params.comfyui_config || {}),
                          SAVE_INPUT_PATH: e.target.value || undefined
                        }
                      })}
                      placeholder="/path/to/input"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Accepted Image Formats</label>
                    <input
                      type="text"
                      value={params.comfyui_config.ACCEPTED_IMG_FORMATS ? params.comfyui_config.ACCEPTED_IMG_FORMATS.join(', ') : ''}
                      onChange={(e) => {
                        const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f);
                        handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...(params.comfyui_config || {}),
                            ACCEPTED_IMG_FORMATS: formats.length > 0 ? formats : undefined
                          }
                        });
                      }}
                      placeholder="png, jpg, jpeg"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Accepted Video Formats</label>
                    <input
                      type="text"
                      value={params.comfyui_config.ACCEPTED_VIDEO_FORMATS ? params.comfyui_config.ACCEPTED_VIDEO_FORMATS.join(', ') : ''}
                      onChange={(e) => {
                        const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f);
                        handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...(params.comfyui_config || {}),
                            ACCEPTED_VIDEO_FORMATS: formats.length > 0 ? formats : undefined
                          }
                        });
                      }}
                      placeholder="mp4, mov"
                      className="info-input"
                    />
                  </div>
                  <div className="info-item">
                    <label>Accepted File Formats</label>
                    <input
                      type="text"
                      value={params.comfyui_config.ACCEPTED_FILE_FORMATS ? params.comfyui_config.ACCEPTED_FILE_FORMATS.join(', ') : ''}
                      onChange={(e) => {
                        const formats = e.target.value.split(',').map(f => f.trim()).filter(f => f);
                        handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...(params.comfyui_config || {}),
                            ACCEPTED_FILE_FORMATS: formats.length > 0 ? formats : undefined
                          }
                        });
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
                        value={params.comfyui_config?.outputComparator?.inputNodeId || ''}
                        onChange={(e) => handleParamsUpdate({
                          ...params,
                          comfyui_config: {
                            ...(params.comfyui_config || {}),
                            outputComparator: e.target.value ? {
                              ...(params.comfyui_config?.outputComparator || {}),
                              inputNodeId: e.target.value,
                              defaultEnabled: params.comfyui_config?.outputComparator?.defaultEnabled || false
                            } : undefined
                          }
                        })}
                        placeholder="Input node ID for comparison"
                        className="info-input"
                        style={{ flex: '1', minWidth: '200px' }}
                      />
                      {params.comfyui_config.outputComparator && (
                        <>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={params.comfyui_config?.outputComparator?.defaultEnabled || false}
                              onChange={(e) => handleParamsUpdate({
                                ...params,
                                comfyui_config: {
                                  ...(params.comfyui_config || {}),
                                  outputComparator: {
                                    ...(params.comfyui_config?.outputComparator || {}),
                                    inputNodeId: params.comfyui_config?.outputComparator?.inputNodeId,
                                    defaultEnabled: e.target.checked
                                  }
                                }
                              })}
                            />
                            <span>Default Enabled</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => handleParamsUpdate({
                              ...params,
                              comfyui_config: {
                                ...(params.comfyui_config || {}),
                                outputComparator: undefined
                              }
                            })}
                            className="btn-icon"
                          >
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
                      {params.comfyui_config.subgraphs && Object.keys(params.comfyui_config.subgraphs).length > 0 ? (
                        <div className="subgraphs-list">
                          {Object.entries(params.comfyui_config.subgraphs).map(([nodeId, config]) => (
                            <SubgraphEditor
                              key={nodeId}
                              nodeId={nodeId}
                              config={config}
                              workflowJson={workflowJson}
                              onUpdate={(updatedConfig) => {
                                handleParamsUpdate({
                                  ...params,
                                  comfyui_config: {
                                    ...(params.comfyui_config || {}),
                                    subgraphs: {
                                      ...(params.comfyui_config?.subgraphs || {}),
                                      [nodeId]: updatedConfig
                                    }
                                  }
                                })
                              }}
                              onDelete={() => {
                                const newSubgraphs = { ...(params.comfyui_config?.subgraphs || {}) }
                                delete newSubgraphs[nodeId]
                                handleParamsUpdate({
                                  ...params,
                                  comfyui_config: {
                                    ...(params.comfyui_config || {}),
                                    subgraphs: Object.keys(newSubgraphs).length > 0 ? newSubgraphs : undefined
                                  }
                                })
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

                {/* Node Manager inside ComfyUI section */}
                {workflowJson ? (
                  <NodeManager
                    workflowJson={workflowJson}
                    params={params}
                    onUpdateParams={handleParamsUpdate}
                  />
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
            )}
          </>
        )}

        {/* Params JSON Editor */}
        <div className="detail-section">
          <div className="section-header">
            <Settings size={20} />
            <h2>Parameters (params.json)</h2>
            <button
              onClick={() => {
                setShowParamsJson((prev) => {
                  const next = !prev
                  if (name) persistWorkflowDetailUI(name, showWorkflowJson, next)
                  return next
                })
              }}
              className="btn-toggle"
            >
              {showParamsJson ? <EyeOff size={16} /> : <Eye size={16} />}
              {showParamsJson ? 'Hide' : 'Show'}
            </button>
          </div>
          {showParamsJson && (
            <>
              {!editParamsJson ? (
                <div className="editor-container">
                  <Editor
                    key="readonly"
                    height="500px"
                    language="json"
                    value={JSON.stringify(params, null, 2)}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                      readOnly: true,
                    }}
                  />
                </div>
              ) : (
                <div className="editor-container">
                  <Editor
                    key="editable"
                    height="500px"
                    language="json"
                    value={paramsText}
                    onChange={(value: string | undefined) => setParamsText(value || '')}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: 'on',
                      readOnly: false,
                      formatOnPaste: true,
                      formatOnType: true,
                    }}
                  />
                </div>
              )}
              <div className="params-json-actions">
                {!editParamsJson ? (
                  <button
                    onClick={handleEditParamsJson}
                    className="btn btn-secondary"
                  >
                    <Settings size={16} /> Edit JSON
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCancelEditParamsJson}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveParamsJson}
                      disabled={saving}
                      className="btn btn-primary"
                    >
                      <Save size={16} /> {saving ? 'Applying...' : 'Apply JSON'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Workflow JSON Viewer */}
        {workflowJson && (
          <div className="detail-section">
            <div className="section-header">
              <FileJson size={20} />
              <h2>Workflow JSON</h2>
              <button
                onClick={() => {
                  setShowWorkflowJson((prev) => {
                    const next = !prev
                    if (name) persistWorkflowDetailUI(name, next, showParamsJson)
                    return next
                  })
                }}
                className="btn-toggle"
              >
                {showWorkflowJson ? <EyeOff size={16} /> : <Eye size={16} />}
                {showWorkflowJson ? 'Hide' : 'Show'}
              </button>
            </div>
            {showWorkflowJson && (
              <div className="editor-container">
                <div className="code-viewer-wrapper" ref={setWorkflowScrollRef}>
                  <div
                    ref={setWorkflowHighlightRef}
                    className="syntax-highlight-background workflow-json-highlight"
                  >
                    {/* @ts-expect-error - react-syntax-highlighter has type compatibility issues */}
                    <SyntaxHighlighter
                      language="json"
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: '1rem',
                        background: 'transparent',
                        minHeight: '100%',
                      }}
                      PreTag="div"
                    >
                      {JSON.stringify(workflowJson, null, 2)}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Confirmation Modal */}
      {showSaveModal && (
        <SaveConfirmationModal
          originalParams={originalParams}
          currentParams={params}
          hasExternalChanges={hasExternalChanges}
          externalParams={externalParams}
          onSave={handleSaveConfirm}
          onCancel={() => setShowSaveModal(false)}
          onReload={handleReload}
          onOverwrite={handleOverwrite}
        />
      )}

      {showResetModal && (
        <ResetConfirmationModal
          currentParams={params}
          fileParams={fileParams}
          hasUnsavedChanges={hasUnsavedChanges}
          onReset={handleResetConfirm}
          onCancel={() => {
            setShowResetModal(false)
            setFileParams(null)
          }}
        />
      )}

      {showSuccessMessage && (
        <div className="success-toast">
          <div className="success-toast-content">
            <Save size={20} />
            <span>Changes applied successfully!</span>
          </div>
        </div>
      )}

      {showDuplicateModal && name && params && (
        <DuplicateModal
          workflow={{
            name,
            folderPath: `/data/gt-workflows/${encodeURIComponent(name)}`,
            params,
            hasWorkflowFile: !!workflowJson,
          }}
          onClose={() => setShowDuplicateModal(false)}
          onSuccess={(newWorkflowName) => {
            setShowDuplicateModal(false)
            onUpdate()
            if (newWorkflowName) {
              // Navigate to the duplicated workflow
              window.location.href = `/workflows/workflow/${encodeURIComponent(newWorkflowName)}`
            }
          }}
          navigateToNew={false}
        />
      )}

      {showDownloadModal && name && params && (
        <DownloadModal
          workflow={{
            name,
            folderPath: `/data/gt-workflows/${encodeURIComponent(name)}`,
            params,
            hasWorkflowFile: !!workflowJson,
          }}
          onClose={() => setShowDownloadModal(false)}
        />
      )}

      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}

      {showDependencyAudit && workflowJson && params?.comfyui_config?.serverUrl && (
        <DependencyAuditModal
          workflowJson={workflowJson}
          serverUrls={getServerUrls(params.comfyui_config.serverUrl)}
          cached={dependencyAuditCache}
          onCacheUpdate={(cache) => {
            setDependencyAuditCache(cache)
            if (name && cache?.timestamp) {
              persistLastRun(name, 'audit', cache.timestamp, cache.error ? 'nok' : 'ok')
            }
          }}
          onClose={() => setShowDependencyAudit(false)}
        />
      )}

      {showTestWorkflow && workflowJson && params?.comfyui_config?.serverUrl && (
        <TestWorkflowModal
          state={testWorkflowHook.state}
          actions={testWorkflowHook.actions}
          isRunning={testWorkflowHook.isRunning}
          workflowNodeCount={testWorkflowHook.workflowNodeCount}
          serverUrls={testServerUrls}
          onClose={() => setShowTestWorkflow(false)}
        />
      )}

      {/* Floating Apply bar – visible when there are unsaved changes so user can apply without scrolling up */}
      {hasUnsavedChanges && (
        <div className="floating-apply-bar">
          <span className="floating-apply-bar-label">You have unsaved changes</span>
          <button
            onClick={handleSaveClick}
            disabled={saving}
            className="btn btn-primary floating-apply-btn"
            title="Apply changes"
          >
            <Save size={16} /> {saving ? 'Applying...' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  )
}

