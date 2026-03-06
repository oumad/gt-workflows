import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import type { Workflow } from '@/types'
import {
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import type { WorkflowDetailUIState } from '@/services/api/preferences'
import { getWorkflowParams, saveWorkflowParams } from '@/services/api/workflows'

export function useWorkflowList(workflows: Workflow[], onRefresh: () => void) {
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
  const [editMode, setEditMode] = useState(false)
  const [editedWorkflows, setEditedWorkflows] = useState<Map<string, Partial<Workflow['params']>>>(new Map())

  useEffect(() => {
    setLocalWorkflows(workflows)
  }, [workflows])

  useEffect(() => {
    if (workflows.length > 0) {
      updatePreferences({ workflowsInfo: workflows }).catch(() => {})
    }
  }, [workflows])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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

  const filteredWorkflows = useMemo(() => {
    const source = editMode ? localWorkflows : workflows
    const term = searchTerm.toLowerCase().trim()
    if (!term) return source
    return source.filter((workflow) => {
      const name = workflow.name.toLowerCase()
      const label = workflow.params.label?.toLowerCase() || ''
      const description = workflow.params.description?.toLowerCase() || ''
      const category = workflow.params.category?.toLowerCase() || ''
      const tags = workflow.params.tags?.map(t => t.toLowerCase()).join(' ') || ''
      return name.includes(term) || label.includes(term) || description.includes(term) || category.includes(term) || tags.includes(term)
    })
  }, [workflows, localWorkflows, searchTerm, editMode])

  const categorizedWorkflows = useMemo(() => {
    const categories = new Map<string, Workflow[]>()
    filteredWorkflows.forEach(workflow => {
      const category = workflow.params.category || 'Uncategorized'
      if (!categories.has(category)) categories.set(category, [])
      categories.get(category)!.push(workflow)
    })
    categories.forEach((wfs) => {
      wfs.sort((a, b) => {
        const orderA = a.params.order
        const orderB = b.params.order
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB
        if (orderA !== undefined) return -1
        if (orderB !== undefined) return 1
        return (a.params.label || a.name).toLowerCase().localeCompare((b.params.label || b.name).toLowerCase())
      })
    })
    return Array.from(categories.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredWorkflows])

  useEffect(() => {
    if (categorizedWorkflows.length > 0 && prefsLoadedForCategories && !expandedCategoriesRestoredFromPrefs.current) {
      expandedCategoriesRestoredFromPrefs.current = true
      setExpandedCategories(new Set(categorizedWorkflows.map(([category]) => category)))
    }
  }, [categorizedWorkflows, prefsLoadedForCategories])

  const selectedWorkflowsList = useMemo(
    () => filteredWorkflows.filter((w) => selectedWorkflows.has(w.name)),
    [filteredWorkflows, selectedWorkflows]
  )

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

  const toggleSelection = useCallback((workflowName: string) => {
    setSelectedWorkflows((prev) => {
      const next = new Set(prev)
      if (next.has(workflowName)) next.delete(workflowName)
      else next.add(workflowName)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedWorkflows((prev) =>
      prev.size === filteredWorkflows.length
        ? new Set()
        : new Set(filteredWorkflows.map((w) => w.name))
    )
  }, [filteredWorkflows])

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedWorkflows(new Set())
  }, [])

  const enterSelectionMode = useCallback(() => setSelectionMode(true), [])

  const handleDownload = useCallback((workflowName: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const workflow = workflows.find(w => w.name === workflowName)
    if (workflow) setDownloadingWorkflow(workflow)
  }, [workflows])

  const handleDuplicate = useCallback((workflowName: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const workflow = workflows.find(w => w.name === workflowName)
    if (workflow) setDuplicatingWorkflow(workflow)
  }, [workflows])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!editMode) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeWorkflow = localWorkflows.find(w => w.name === active.id)
    const overWorkflow = localWorkflows.find(w => w.name === over.id)
    if (!activeWorkflow || !overWorkflow) return

    const activeCategory = activeWorkflow.params.category || 'Uncategorized'
    const overCategory = overWorkflow.params.category || 'Uncategorized'
    if (activeCategory !== overCategory) return

    const categoryWorkflows = localWorkflows
      .filter(w => (w.params.category || 'Uncategorized') === activeCategory)
      .sort((a, b) => (a.params.order ?? 999) - (b.params.order ?? 999))

    const oldIndex = categoryWorkflows.findIndex(w => w.name === active.id)
    const newIndex = categoryWorkflows.findIndex(w => w.name === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(categoryWorkflows, oldIndex, newIndex)
    const updatedWorkflows = [...localWorkflows]
    reordered.forEach((workflow, index) => {
      const workflowIndex = updatedWorkflows.findIndex(w => w.name === workflow.name)
      if (workflowIndex !== -1) {
        const newOrder = index + 1
        updatedWorkflows[workflowIndex] = {
          ...updatedWorkflows[workflowIndex],
          params: { ...updatedWorkflows[workflowIndex].params, order: newOrder },
        }
        setEditedWorkflows(prev => {
          const next = new Map(prev)
          next.set(workflow.name, { ...(next.get(workflow.name) || {}), order: newOrder })
          return next
        })
      }
    })
    setLocalWorkflows(updatedWorkflows)
  }, [editMode, localWorkflows])

  const handleFieldChange = useCallback((workflowName: string, field: string, value: string | string[] | number | boolean | undefined) => {
    setEditedWorkflows(prev => {
      const next = new Map(prev)
      const existing = next.get(workflowName) || {}
      if (field.includes('.')) {
        const [parent, child] = field.split('.')
        next.set(workflowName, { ...existing, [parent]: { ...(existing[parent] || {}), [child]: value } })
      } else {
        next.set(workflowName, { ...existing, [field]: value })
      }
      return next
    })
  }, [])

  const handleSaveEdits = useCallback(async () => {
    try {
      setSaveError(null)
      await Promise.all(
        Array.from(editedWorkflows.entries()).map(async ([workflowName, changes]) => {
          const fullParams = await getWorkflowParams(workflowName)
          const updatedParams = { ...fullParams, ...changes }
          if (changes.comfyui_config) {
            updatedParams.comfyui_config = { ...fullParams.comfyui_config, ...changes.comfyui_config }
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
  }, [editedWorkflows, onRefresh])

  const handleCancelEdit = useCallback(() => {
    setEditedWorkflows(new Map())
    setEditMode(false)
    setLocalWorkflows(workflows)
  }, [workflows])

  return {
    editingWorkflow, setEditingWorkflow,
    selectedWorkflows,
    showBulkEdit, setShowBulkEdit,
    selectionMode,
    searchTerm, setSearchTerm,
    saveError,
    serverAliasesFromPrefs,
    workflowDetailUI,
    duplicatingWorkflow, setDuplicatingWorkflow,
    downloadingWorkflow, setDownloadingWorkflow,
    logsServerUrl, setLogsServerUrl,
    expandedCategories,
    editMode, setEditMode,
    editedWorkflows,
    sensors,
    filteredWorkflows,
    categorizedWorkflows,
    selectedWorkflowsList,
    toggleCategory,
    toggleSelection,
    toggleSelectAll,
    exitSelectionMode,
    enterSelectionMode,
    handleDownload,
    handleDuplicate,
    handleDragEnd,
    handleFieldChange,
    handleSaveEdits,
    handleCancelEdit,
  }
}
