import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useBeforeUnload } from 'react-router-dom'
import type { WorkflowParams, WorkflowJson } from '@/types'
import {
  getWorkflowParams,
  getWorkflowJson,
  saveWorkflowParams,
  uploadFile,
  deleteWorkflowFile,
} from '@/services/api/workflows'
import { compressImage } from '@/utils/imageCompression'
import { useTestWorkflow } from '@/hooks/useTestWorkflow'
import { getServerUrls } from '@/utils/serverUrl'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import type { WorkflowDetailUIState, LastRunStatus } from '@/services/api/preferences'
import type { DependencyAuditCache } from '@/components/modals/DependencyAuditModal'

export function useWorkflowDetail(onUpdate: () => void) {
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
  const [iconVersion, setIconVersion] = useState(0)
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
  const [showTestWorkflow, setShowTestWorkflow] = useState(false)
  const [lastTestRun, setLastTestRun] = useState<string | null>(null)
  const [lastTestRunStatus, setLastTestRunStatus] = useState<LastRunStatus | null>(null)
  const [lastAuditRun, setLastAuditRun] = useState<string | null>(null)
  const [lastAuditRunStatus, setLastAuditRunStatus] = useState<LastRunStatus | null>(null)

  const prevAuditKeyRef = useRef(`${name}|${params?.comfyui_config?.serverUrl}`)
  const workflowDetailUIRef = useRef<Record<string, WorkflowDetailUIState>>({})
  const testPhasePrevRef = useRef<string | undefined>(undefined)

  const testServerUrls = useMemo(
    () => getServerUrls(params?.comfyui_config?.serverUrl),
    [params?.comfyui_config?.serverUrl]
  )
  const testWorkflowHook = useTestWorkflow(workflowJson, testServerUrls)

  // Invalidate audit cache when workflow or server config changes
  useEffect(() => {
    const key = `${name}|${params?.comfyui_config?.serverUrl}`
    if (key !== prevAuditKeyRef.current) {
      prevAuditKeyRef.current = key
      setDependencyAuditCache(null)
    }
  }, [name, params?.comfyui_config?.serverUrl])

  // Load persisted workflow detail UI state
  useEffect(() => {
    if (!name) return
    getPreferences()
      .then((prefs) => {
        workflowDetailUIRef.current = prefs.workflowDetailUI ?? {}
        const ui = prefs.workflowDetailUI?.[name]
        if (ui) {
          if (typeof ui.showWorkflowJson === 'boolean') setShowWorkflowJson(ui.showWorkflowJson)
          if (typeof ui.showParamsJson === 'boolean') setShowParamsJson(ui.showParamsJson)
          setLastTestRun(typeof ui.lastTestRun === 'string' ? ui.lastTestRun : null)
          setLastTestRunStatus(ui.lastTestRunStatus === 'ok' || ui.lastTestRunStatus === 'nok' ? ui.lastTestRunStatus : null)
          setLastAuditRun(typeof ui.lastAuditRun === 'string' ? ui.lastAuditRun : null)
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

  const persistWorkflowDetailUI = useCallback((workflowName: string, showWorkflow: boolean, showParams: boolean) => {
    const current = workflowDetailUIRef.current[workflowName] ?? {}
    const next: Record<string, WorkflowDetailUIState> = {
      ...workflowDetailUIRef.current,
      [workflowName]: { ...current, showWorkflowJson: showWorkflow, showParamsJson: showParams },
    }
    workflowDetailUIRef.current = next
    updatePreferences({ workflowDetailUI: next }).catch(() => {})
  }, [])

  const persistLastRun = useCallback((workflowName: string, type: 'test' | 'audit', timestamp: string, status?: LastRunStatus) => {
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
  }, [])

  // Persist last test run when test completes or errors
  useEffect(() => {
    const phase = testWorkflowHook.state.phase
    const prev = testPhasePrevRef.current
    testPhasePrevRef.current = phase
    if (name && (phase === 'completed' || phase === 'error') && prev !== 'completed' && prev !== 'error') {
      persistLastRun(name, 'test', new Date().toISOString(), phase === 'completed' ? 'ok' : 'nok')
    }
  }, [name, testWorkflowHook.state.phase, persistLastRun])

  // Sync scroll for workflow JSON viewer
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
    if (name) loadWorkflow()
  }, [name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Check for external changes periodically
  useEffect(() => {
    if (!name || !params || !originalParams) return
    const checkForExternalChanges = async () => {
      if (document.hidden) return
      try {
        const currentFileParams = await getWorkflowParams(name)
        const currentFileStr = JSON.stringify(currentFileParams, null, 2)
        if (currentFileStr !== JSON.stringify(originalParams, null, 2)) {
          if (currentFileStr !== JSON.stringify(params, null, 2)) {
            setHasExternalChanges(true)
            setExternalParams(currentFileParams)
          }
        } else {
          setHasExternalChanges(false)
          setExternalParams(null)
        }
      } catch { /* Silently fail */ }
    }
    const interval = setInterval(checkForExternalChanges, 5000)
    return () => clearInterval(interval)
  }, [name, params, originalParams])

  useEffect(() => {
    if (params && !editParamsJson) setParamsText(JSON.stringify(params, null, 2))
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
      setOriginalParams(structuredClone(paramsData))
      setParamsText(JSON.stringify(paramsData, null, 2))
      setWorkflowJson(jsonData)
      setIconError(false)
      setIconVersion(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow')
    } finally {
      setLoading(false)
    }
  }

  const hasUnsavedChanges = useMemo(() => {
    if (!originalParams || !params) return false
    return JSON.stringify(originalParams, null, 2) !== JSON.stringify(params, null, 2)
  }, [originalParams, params])

  useBeforeUnload(
    useCallback((e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) e.preventDefault()
    }, [hasUnsavedChanges])
  )

  const isFieldChanged = (fieldPath: string): boolean => {
    if (!originalParams || !params) return false
    const paths = fieldPath.split('.')
    let originalValue: unknown = originalParams
    let currentValue: unknown = params
    for (const path of paths) {
      originalValue = (originalValue as Record<string, unknown>)?.[path]
      currentValue = (currentValue as Record<string, unknown>)?.[path]
    }
    return JSON.stringify(originalValue) !== JSON.stringify(currentValue)
  }

  const handleParamsUpdate = (updatedParams: WorkflowParams) => {
    setParams(updatedParams)
    if (!editParamsJson) setParamsText(JSON.stringify(updatedParams, null, 2))
  }

  const handleSaveConfirm = async () => {
    if (!name || !params) return
    try {
      setSaving(true)
      setError(null)
      const paramsToSave: WorkflowParams = { ...params }
      if ((paramsToSave.comfyui_config as Record<string, unknown>)?._workflowUploaded) {
        const cfg = { ...paramsToSave.comfyui_config } as Record<string, unknown>
        delete cfg._workflowUploaded
        paramsToSave.comfyui_config = cfg as typeof paramsToSave.comfyui_config
      }
      if (paramsToSave._iconUploaded !== undefined) delete paramsToSave._iconUploaded
      await saveWorkflowParams(name, paramsToSave)
      setOriginalParams(structuredClone(paramsToSave))
      setParams(paramsToSave)
      setHasExternalChanges(false)
      setExternalParams(null)
      setShowSaveModal(false)
      setShowSuccessMessage(true)
      onUpdate()
      setTimeout(() => setShowSuccessMessage(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow')
      setShowSaveModal(false)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = async () => {
    if (!name || !params) return
    if (!hasUnsavedChanges && !hasExternalChanges) {
      await handleSaveConfirm()
      return
    }
    if (hasUnsavedChanges && !hasExternalChanges) {
      try {
        const currentFileParams = await getWorkflowParams(name)
        const currentFileStr = JSON.stringify(currentFileParams, null, 2)
        if (currentFileStr !== JSON.stringify(originalParams, null, 2) && currentFileStr !== JSON.stringify(params, null, 2)) {
          setHasExternalChanges(true)
          setExternalParams(currentFileParams)
        }
      } catch { /* ignore */ }
    }
    setShowSaveModal(true)
  }

  const handleReload = async () => {
    if (!name) return
    try {
      setLoading(true)
      setError(null)
      setEditParamsJson(false)
      const freshParams = await getWorkflowParams(name)
      setParams(freshParams)
      setOriginalParams(structuredClone(freshParams))
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

  const handleOverwrite = async () => handleSaveConfirm()

  const handleResetClick = async () => {
    if (!name || !params) return
    try {
      const currentFileParams = await getWorkflowParams(name)
      setFileParams(currentFileParams)
    } catch {
      setFileParams(null)
    }
    setShowResetModal(true)
  }

  const handleResetConfirm = async () => {
    await handleReload()
    setFileParams(null)
    setShowResetModal(false)
  }

  const handleSaveParamsJson = async () => {
    if (!name || !paramsText) return
    try {
      const parsedParams = JSON.parse(paramsText)
      try {
        const currentFileParams = await getWorkflowParams(name)
        const currentFileStr = JSON.stringify(currentFileParams, null, 2)
        if (currentFileStr !== JSON.stringify(originalParams, null, 2)) {
          if (currentFileStr !== JSON.stringify(parsedParams, null, 2)) {
            setHasExternalChanges(true)
            setExternalParams(currentFileParams)
            setError('External changes detected. Use Apply to resolve the conflict.')
            return
          }
        }
      } catch { /* Continue even if check fails */ }
      setSaving(true)
      setError(null)
      await saveWorkflowParams(name, parsedParams)
      setParams(parsedParams)
      setOriginalParams(structuredClone(parsedParams))
      setEditParamsJson(false)
      setParamsText(JSON.stringify(parsedParams, null, 2))
      setHasExternalChanges(false)
      setExternalParams(null)
      onUpdate()
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Invalid JSON format' : err instanceof Error ? err.message : 'Failed to save workflow')
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

  const handleIconDelete = useCallback(async () => {
    if (!name || !params?.icon) return
    const iconFilename = params.icon.replace(/^\.\//, '')
    try {
      await deleteWorkflowFile(name, iconFilename)
    } catch { /* Still remove from params */ }
    handleParamsUpdate({ ...params, icon: undefined })
    setIconVersion(Date.now())
    setIconError(false)
  }, [name, params]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleIconUpload = useCallback(async (file: File) => {
    if (!name || !params) return
    try {
      const compressedFile = await compressImage(file, 800, 0.85)
      const result = await uploadFile(name, compressedFile)
      handleParamsUpdate({ ...params, icon: result.relativePath, _iconUploaded: Date.now() })
      setIconVersion(Date.now())
      setIconError(false)
    } catch (err) {
      setError('Failed to upload icon: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }, [name, params]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleWorkflowFileUpload = useCallback(async (file: File) => {
    if (!name || !params) return
    try {
      const result = await uploadFile(name, file)
      handleParamsUpdate({
        ...params,
        comfyui_config: { ...(params.comfyui_config || {}), workflow: result.relativePath, _workflowUploaded: Date.now() } as WorkflowParams['comfyui_config'],
      })
      const jsonData = await getWorkflowJson(name)
      setWorkflowJson(jsonData)
    } catch (err) {
      setError('Failed to upload workflow file: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }, [name, params]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    name,
    params,
    originalParams,
    workflowJson,
    loading,
    saving,
    error,
    setError,
    showWorkflowJson,
    setShowWorkflowJson,
    showParamsJson,
    setShowParamsJson,
    editParamsJson,
    paramsText,
    setParamsText,
    workflowHighlightRef,
    setWorkflowHighlightRef,
    workflowScrollRef,
    setWorkflowScrollRef,
    iconError,
    setIconError,
    iconDragOver,
    setIconDragOver,
    workflowDragOver,
    setWorkflowDragOver,
    iconVersion,
    showSaveModal,
    setShowSaveModal,
    showResetModal,
    setShowResetModal,
    fileParams,
    setFileParams,
    hasExternalChanges,
    externalParams,
    showSuccessMessage,
    showDuplicateModal,
    setShowDuplicateModal,
    showDownloadModal,
    setShowDownloadModal,
    logsServerUrl,
    setLogsServerUrl,
    showDependencyAudit,
    setShowDependencyAudit,
    dependencyAuditCache,
    setDependencyAuditCache,
    showTestWorkflow,
    setShowTestWorkflow,
    lastTestRun,
    lastTestRunStatus,
    lastAuditRun,
    lastAuditRunStatus,
    testServerUrls,
    testWorkflowHook,
    hasUnsavedChanges,
    isFieldChanged,
    handleParamsUpdate,
    handleSaveClick,
    handleSaveConfirm,
    handleReload,
    handleOverwrite,
    handleResetClick,
    handleResetConfirm,
    handleSaveParamsJson,
    handleEditParamsJson,
    handleCancelEditParamsJson,
    handleIconDelete,
    handleIconUpload,
    handleWorkflowFileUpload,
    persistWorkflowDetailUI,
    persistLastRun,
  }
}
