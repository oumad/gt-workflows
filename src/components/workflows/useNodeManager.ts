import { useState, useMemo, useCallback, useEffect } from 'react'
import type { WorkflowParams } from '@/types'
import type { NodeInfo, NodeRowCallbacks, ArrayName } from './NodeRow'

export function useNodeManager(
  workflowJson: Record<string, unknown> | null,
  params: WorkflowParams,
  onUpdateParams: (p: WorkflowParams) => void
) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'input' | 'output' | 'all' | 'appinfo'>('input')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [expandedSubgraphs, setExpandedSubgraphs] = useState<Set<string>>(new Set())
  const [groupBySubgraph, setGroupBySubgraph] = useState(true)
  const [editingParser, setEditingParser] = useState<{ nodeId: string; nodeType: string; nodeInputs: Record<string, unknown> } | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState<string | null>(null)
  const [editingSubgraphLabel, setEditingSubgraphLabel] = useState<string | null>(null)
  const [subgraphLabelValue, setSubgraphLabelValue] = useState('')

  useEffect(() => {
    if (!moreMenuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.more-menu-wrapper') && !target.closest('.more-menu-btn')) setMoreMenuOpen(null)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [moreMenuOpen])

  const nodes = useMemo<NodeInfo[]>(() => {
    if (!workflowJson) return []
    return Object.entries(workflowJson)
      .filter(([, node]) => typeof node === 'object' && node !== null && 'class_type' in (node as object))
      .map(([id, node]) => ({ id, ...(node as Omit<NodeInfo, 'id'>) }))
  }, [workflowJson])

  const appInfoNodes = useMemo(() => nodes.filter(n => n.class_type === 'AppInfo' || n.class_type?.includes('AppInfo')), [nodes])

  const appInfoInputIds = useMemo(() => {
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      if (node.inputs?.input_ids) {
        const raw = node.inputs.input_ids
        const parsed = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean)
        ids.push(...parsed)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes])

  const appInfoOutputIds = useMemo(() => {
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      if (node.inputs?.output_ids) {
        const raw = node.inputs.output_ids
        const parsed = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean)
        ids.push(...parsed)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes])

  const configuredInputIds = params.comfyui_config?.input_ids || []
  const configuredOutputIds = params.comfyui_config?.output_ids || []
  const hiddenNodeIds = params.comfyui_config?.hiddenNodeIds || []
  const wrappedNodeIds = params.comfyui_config?.wrappedNodeIds || []
  const hasExplicitInputIds = params.comfyui_config?.input_ids !== undefined
  const hasExplicitOutputIds = params.comfyui_config?.output_ids !== undefined

  const getNodeParser = useCallback((nodeId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeParsers = (params.comfyui_config?.node_parsers as any)?.input_nodes
    return nodeParsers?.[nodeId] ?? null
  }, [params.comfyui_config?.node_parsers])

  const inputNodes = useMemo(() => {
    const effectiveInputIds = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    const topLevel = nodes.filter(n => !n.id.includes(':') && effectiveInputIds.includes(n.id))
    const subgraphWithParser = nodes.filter(n => n.id.includes(':') && getNodeParser(n.id))
    return [...new Map([...topLevel, ...subgraphWithParser].map(n => [n.id, n])).values()]
  }, [nodes, configuredInputIds, appInfoInputIds, getNodeParser])

  const outputNodes = useMemo(() => {
    const effectiveOutputIds = configuredOutputIds.length > 0 ? configuredOutputIds : appInfoOutputIds
    return nodes.filter(n => !n.id.includes(':') && effectiveOutputIds.includes(n.id))
  }, [nodes, configuredOutputIds, appInfoOutputIds])

  const groupedNodes = useMemo(() => {
    const topLevel: NodeInfo[] = []
    const subgraphGroups: Record<string, NodeInfo[]> = {}
    let nodesToGroup = nodes
    if (selectedCategory === 'input') nodesToGroup = inputNodes
    else if (selectedCategory === 'output') nodesToGroup = outputNodes
    else if (selectedCategory === 'appinfo') nodesToGroup = appInfoNodes

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      nodesToGroup = nodesToGroup.filter(n =>
        n.id.toLowerCase().includes(term) || n.class_type?.toLowerCase().includes(term) ||
        n._meta?.title?.toLowerCase().includes(term) || n.title?.toLowerCase().includes(term)
      )
    }

    nodesToGroup.forEach(node => {
      if (node.id.includes(':')) {
        const sgId = node.id.split(':')[0]
        if (!subgraphGroups[sgId]) subgraphGroups[sgId] = []
        subgraphGroups[sgId].push(node)
      } else {
        topLevel.push(node)
      }
    })

    // Expand subgraph groups to include all child nodes (not just filtered)
    Object.keys(subgraphGroups).forEach(sgId => {
      const prefix = `${sgId}:`
      nodes.forEach(node => {
        if (node.id.startsWith(prefix) && !subgraphGroups[sgId].some(n => n.id === node.id)) {
          subgraphGroups[sgId].push(node)
        }
      })
      subgraphGroups[sgId] = Array.from(new Map(subgraphGroups[sgId].map(n => [n.id, n])).values())
    })

    // Detect implicit subgraphs
    let relevantIds: string[] = []
    if (selectedCategory === 'input') relevantIds = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    else if (selectedCategory === 'output') relevantIds = configuredOutputIds.length > 0 ? configuredOutputIds : appInfoOutputIds
    else relevantIds = [...configuredInputIds, ...appInfoInputIds, ...configuredOutputIds, ...appInfoOutputIds]

    const topLevelNodeIds = new Set(nodes.filter(n => !n.id.includes(':')).map(n => n.id))
    const term = searchTerm ? searchTerm.toLowerCase() : ''
    Array.from(new Set(relevantIds)).filter(id => !topLevelNodeIds.has(id)).forEach(sgId => {
      const prefix = `${sgId}:`
      const childNodes = nodes.filter(n => n.id.startsWith(prefix))
      if (!childNodes.length) return
      let shouldInclude = !term || sgId.toLowerCase().includes(term)
      if (term && !shouldInclude) {
        shouldInclude = childNodes.some(n =>
          n.id.toLowerCase().includes(term) || n.class_type?.toLowerCase().includes(term) ||
          n._meta?.title?.toLowerCase().includes(term) || n.title?.toLowerCase().includes(term)
        )
      }
      if (shouldInclude) {
        if (!subgraphGroups[sgId]) subgraphGroups[sgId] = []
        childNodes.forEach(node => {
          if (!subgraphGroups[sgId].some(n => n.id === node.id)) {
            if (!term || node.id.toLowerCase().includes(term) || node.class_type?.toLowerCase().includes(term) ||
              node._meta?.title?.toLowerCase().includes(term) || node.title?.toLowerCase().includes(term)) {
              subgraphGroups[sgId].push(node)
            }
          }
        })
      }
    })

    // Include explicitly declared subgraphs
    Object.keys(params.comfyui_config?.subgraphs || {}).forEach(sgId => {
      const sgConfig = params.comfyui_config!.subgraphs![sgId]
      const label = sgConfig?.label || `Subgraph ${sgId}`
      if (!term || label.toLowerCase().includes(term) || sgId.toLowerCase().includes(term)) {
        if (!subgraphGroups[sgId]) subgraphGroups[sgId] = []
        const prefix = `${sgId}:`
        nodes.forEach(node => {
          if (node.id.startsWith(prefix) && !subgraphGroups[sgId].some(n => n.id === node.id)) {
            if (!term || node.id.toLowerCase().includes(term) || node.class_type?.toLowerCase().includes(term) ||
              node._meta?.title?.toLowerCase().includes(term) || node.title?.toLowerCase().includes(term)) {
              subgraphGroups[sgId].push(node)
            }
          }
        })
      }
    })

    // When 'all', include every subgraph
    if (selectedCategory === 'all') {
      nodes.forEach(node => {
        if (node.id.includes(':')) {
          const sgId = node.id.split(':')[0]
          if (!subgraphGroups[sgId]) subgraphGroups[sgId] = []
          if (!subgraphGroups[sgId].some(n => n.id === node.id)) subgraphGroups[sgId].push(node)
        }
      })
    }

    // Deduplicate + sort
    Object.keys(subgraphGroups).forEach(sgId => {
      subgraphGroups[sgId] = Array.from(new Map(subgraphGroups[sgId].map(n => [n.id, n])).values())
      const nodesOrder = params.comfyui_config?.subgraphs?.[sgId]?.nodesOrder
      if (nodesOrder?.length) {
        subgraphGroups[sgId].sort((a, b) => {
          const ai = nodesOrder.indexOf(a.id.split(':')[1]), bi = nodesOrder.indexOf(b.id.split(':')[1])
          if (ai !== -1 && bi !== -1) return ai - bi
          if (ai !== -1) return -1
          if (bi !== -1) return 1
          return 0
        })
      } else {
        subgraphGroups[sgId].sort((a, b) => (a.id.split(':')[1] || '').localeCompare(b.id.split(':')[1] || ''))
      }
    })

    return { topLevel, subgraphGroups }
  }, [nodes, inputNodes, outputNodes, appInfoNodes, selectedCategory, searchTerm, params, configuredInputIds, configuredOutputIds, appInfoInputIds, appInfoOutputIds])

  const filteredNodes = useMemo(() => {
    let filtered = nodes
    if (selectedCategory === 'input') filtered = inputNodes
    else if (selectedCategory === 'output') filtered = outputNodes
    else if (selectedCategory === 'appinfo') filtered = appInfoNodes
    if (!searchTerm) return filtered
    const term = searchTerm.toLowerCase()
    return filtered.filter(n =>
      n.id.toLowerCase().includes(term) || n.class_type?.toLowerCase().includes(term) ||
      n._meta?.title?.toLowerCase().includes(term) || n.title?.toLowerCase().includes(term)
    )
  }, [nodes, inputNodes, outputNodes, appInfoNodes, selectedCategory, searchTerm])

  const isNodeLabelHidden = useCallback((nodeId: string): boolean => {
    if (!nodeId.includes(':')) return false
    const [sgId] = nodeId.split(':')
    const cfg = params.comfyui_config?.subgraphs?.[sgId]
    if (!cfg) return false
    if (cfg.showNodeLabels !== undefined) {
      if (typeof cfg.showNodeLabels === 'boolean') return !cfg.showNodeLabels
      if (Array.isArray(cfg.showNodeLabels)) return !cfg.showNodeLabels.includes(nodeId)
    }
    if (cfg.hideNodeLabels !== undefined) {
      if (typeof cfg.hideNodeLabels === 'boolean') return cfg.hideNodeLabels
      if (Array.isArray(cfg.hideNodeLabels)) return cfg.hideNodeLabels.includes(nodeId)
    }
    return false
  }, [params.comfyui_config?.subgraphs])

  const getSubgraphLabel = useCallback((sgId: string) =>
    params.comfyui_config?.subgraphs?.[sgId]?.label || `Subgraph ${sgId}`, [params.comfyui_config?.subgraphs])

  const ensureCfg = (p: WorkflowParams) => {
    if (!p.comfyui_config) p.comfyui_config = { serverUrl: 'http://127.0.0.1:8188', workflow: '' }
    return p
  }

  const addToArray = useCallback((arrayName: ArrayName, nodeId: string) => {
    const p = ensureCfg({ ...params })
    const arr = p.comfyui_config![arrayName] || []
    if (!arr.includes(nodeId)) { p.comfyui_config![arrayName] = [...arr, nodeId]; onUpdateParams(p) }
  }, [params, onUpdateParams])

  const removeFromArray = useCallback((arrayName: ArrayName, nodeId: string) => {
    const p = { ...params }
    if (!p.comfyui_config) return
    let arr = p.comfyui_config[arrayName] || []
    if (arr.length === 0 && (arrayName === 'input_ids' || arrayName === 'output_ids')) {
      arr = arrayName === 'input_ids' ? [...appInfoInputIds] : [...appInfoOutputIds]
    }
    p.comfyui_config[arrayName] = arr.filter(id => id !== nodeId)
    onUpdateParams(p)
  }, [params, appInfoInputIds, appInfoOutputIds, onUpdateParams])

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
      return next
    })
  }, [])

  const toggleSubgraph = useCallback((sgId: string) => {
    setExpandedSubgraphs(prev => {
      const next = new Set(prev)
      next.has(sgId) ? next.delete(sgId) : next.add(sgId)
      return next
    })
  }, [])

  const updateSubgraphLabel = useCallback((sgId: string, label: string) => {
    const p = ensureCfg({ ...params })
    if (!p.comfyui_config!.subgraphs) p.comfyui_config!.subgraphs = {}
    const current = p.comfyui_config!.subgraphs[sgId] || {}
    if (label.trim()) {
      p.comfyui_config!.subgraphs[sgId] = { ...current, label: label.trim() }
    } else {
      const { label: _l, ...rest } = current
      if (Object.keys(rest).length > 0) p.comfyui_config!.subgraphs[sgId] = rest
      else {
        delete p.comfyui_config!.subgraphs[sgId]
        if (!Object.keys(p.comfyui_config!.subgraphs).length) p.comfyui_config!.subgraphs = undefined
      }
    }
    onUpdateParams(p)
    setEditingSubgraphLabel(null)
  }, [params, onUpdateParams])

  const startEditingSubgraphLabel = useCallback((sgId: string) => {
    setSubgraphLabelValue(params.comfyui_config?.subgraphs?.[sgId]?.label || '')
    setEditingSubgraphLabel(sgId)
  }, [params.comfyui_config?.subgraphs])

  const cancelEditingSubgraphLabel = useCallback(() => {
    setEditingSubgraphLabel(null)
    setSubgraphLabelValue('')
  }, [])

  const reorderSubgraphNode = useCallback((sgId: string, nodeId: string, direction: 'up' | 'down') => {
    const p = ensureCfg({ ...params })
    if (!p.comfyui_config!.subgraphs) p.comfyui_config!.subgraphs = {}
    const sgCfg = p.comfyui_config!.subgraphs[sgId] || {}
    const childId = nodeId.includes(':') ? nodeId.split(':')[1] : nodeId
    const prefix = `${sgId}:`
    const allChildren = nodes.filter(n => n.id.startsWith(prefix)).map(n => n.id.split(':')[1]).sort((a, b) => a.localeCompare(b))
    let order = [...(sgCfg.nodesOrder || [])]
    allChildren.forEach(c => { if (!order.includes(c)) order.push(c) })
    const idx = order.indexOf(childId)
    if (idx === -1) return
    const newIdx = direction === 'up' ? Math.max(0, idx - 1) : Math.min(order.length - 1, idx + 1)
    if (newIdx === idx) return
    const temp = order[idx]; order[idx] = order[newIdx]; order[newIdx] = temp
    p.comfyui_config!.subgraphs[sgId] = { ...sgCfg, nodesOrder: order }
    onUpdateParams(p)
  }, [params, nodes, onUpdateParams])

  const toggleNodeLabelHidden = useCallback((nodeId: string) => {
    if (!nodeId.includes(':')) return
    const [sgId] = nodeId.split(':')
    const p = ensureCfg({ ...params })
    if (!p.comfyui_config!.subgraphs) p.comfyui_config!.subgraphs = {}
    const sgCfg = p.comfyui_config!.subgraphs[sgId] || {}
    const hidden = isNodeLabelHidden(nodeId)

    if (sgCfg.showNodeLabels !== undefined) {
      if (typeof sgCfg.showNodeLabels === 'boolean') {
        p.comfyui_config!.subgraphs[sgId] = { ...sgCfg, showNodeLabels: hidden ? [nodeId] : [] }
      } else if (Array.isArray(sgCfg.showNodeLabels)) {
        const arr = hidden ? [...sgCfg.showNodeLabels, nodeId] : sgCfg.showNodeLabels.filter(id => id !== nodeId)
        p.comfyui_config!.subgraphs[sgId] = { ...sgCfg, showNodeLabels: arr.length > 0 ? arr : undefined }
      }
    } else {
      if (typeof sgCfg.hideNodeLabels === 'boolean') {
        p.comfyui_config!.subgraphs[sgId] = { ...sgCfg, hideNodeLabels: hidden ? [] : [nodeId] }
      } else if (Array.isArray(sgCfg.hideNodeLabels)) {
        const arr = hidden ? sgCfg.hideNodeLabels.filter(id => id !== nodeId) : [...sgCfg.hideNodeLabels, nodeId]
        p.comfyui_config!.subgraphs[sgId] = { ...sgCfg, hideNodeLabels: arr.length > 0 ? arr : undefined }
      } else {
        p.comfyui_config!.subgraphs[sgId] = { ...sgCfg, hideNodeLabels: hidden ? [] : [nodeId] }
      }
    }
    onUpdateParams(p)
  }, [params, isNodeLabelHidden, onUpdateParams])

  const handleSaveParser = useCallback((nodeId: string, parserConfig: Record<string, unknown>) => {
    const p = ensureCfg({ ...params })
    if (!p.comfyui_config!.node_parsers) p.comfyui_config!.node_parsers = {}
    const np = p.comfyui_config!.node_parsers as Record<string, Record<string, unknown>>
    if (!np.input_nodes) np.input_nodes = {}
    const { hideTitle: _drop, ...parserWithoutHideTitle } = parserConfig
    np.input_nodes[nodeId] = parserWithoutHideTitle
    onUpdateParams(p)
    setEditingParser(null)
  }, [params, onUpdateParams])

  const callbacks: NodeRowCallbacks = {
    onToggle: toggleNode,
    onSetMoreMenu: setMoreMenuOpen,
    onAddToArray: addToArray,
    onRemoveFromArray: removeFromArray,
    onToggleLabelHidden: toggleNodeLabelHidden,
    onReorder: reorderSubgraphNode,
    onEditParser: (nodeId, nodeType, nodeInputs) => setEditingParser({ nodeId, nodeType, nodeInputs }),
    getNodeParser,
    isNodeLabelHidden,
  }

  return {
    searchTerm, setSearchTerm,
    selectedCategory, setSelectedCategory,
    expandedNodes,
    expandedSubgraphs,
    groupBySubgraph, setGroupBySubgraph,
    editingParser, setEditingParser,
    moreMenuOpen,
    editingSubgraphLabel, setEditingSubgraphLabel,
    subgraphLabelValue, setSubgraphLabelValue,
    nodes, appInfoNodes, appInfoInputIds, appInfoOutputIds,
    hiddenNodeIds, wrappedNodeIds,
    hasExplicitInputIds, hasExplicitOutputIds,
    inputNodes, outputNodes,
    groupedNodes, filteredNodes,
    callbacks,
    getSubgraphLabel,
    updateSubgraphLabel,
    startEditingSubgraphLabel,
    cancelEditingSubgraphLabel,
    toggleSubgraph,
    handleSaveParser,
    getNodeParser,
  }
}
