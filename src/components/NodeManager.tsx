import { useState, useMemo, useCallback, useEffect } from 'react'
import { WorkflowParams } from '../types'
import { 
  Search, Plus, X, Eye, EyeOff, Package, Settings, 
  ArrowRight, ArrowDown, ArrowUp, Info, Edit2, MoreVertical, Tag, Check
} from 'lucide-react'
import NodeParserEditor from './NodeParserEditor'
import './NodeManager.css'

interface NodeManagerProps {
  workflowJson: any
  params: WorkflowParams
  onUpdateParams: (updatedParams: WorkflowParams) => void
}

interface NodeInfo {
  id: string
  class_type: string
  title?: string
  inputs?: Record<string, any>
  _meta?: { title?: string }
}

export default function NodeManager({ workflowJson, params, onUpdateParams }: NodeManagerProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'input' | 'output' | 'all' | 'appinfo'>('input')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [expandedSubgraphs, setExpandedSubgraphs] = useState<Set<string>>(new Set())
  const [groupBySubgraph, setGroupBySubgraph] = useState(true)
  const [editingParser, setEditingParser] = useState<{ nodeId: string; nodeType: string; nodeInputs: Record<string, any> } | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState<string | null>(null)
  const [editingSubgraphLabel, setEditingSubgraphLabel] = useState<string | null>(null)
  const [subgraphLabelValue, setSubgraphLabelValue] = useState<string>('')

  // Close more menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.more-menu-wrapper') && !target.closest('.more-menu-btn')) {
        setMoreMenuOpen(null)
      }
    }
    if (moreMenuOpen) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [moreMenuOpen])

  // Extract nodes from workflow JSON
  const nodes = useMemo(() => {
    if (!workflowJson) return []
    const nodeList: NodeInfo[] = []
    for (const [id, node] of Object.entries(workflowJson)) {
      if (typeof node === 'object' && node !== null && 'class_type' in node) {
        nodeList.push({ id, ...(node as any) })
      }
    }
    return nodeList
  }, [workflowJson])

  // Find AppInfo nodes
  const appInfoNodes = useMemo(() => {
    return nodes.filter(node => 
      node.class_type === 'AppInfo' || 
      node.class_type?.includes('AppInfo')
    )
  }, [nodes])

  // Extract input_ids and output_ids from AppInfo nodes
  const appInfoInputIds = useMemo(() => {
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      if (node.inputs?.input_ids) {
        let inputIds: string[] = []
        
        if (Array.isArray(node.inputs.input_ids)) {
          // Already an array
          inputIds = node.inputs.input_ids.map(String)
        } else {
          // String - parse comma, space, or newline separated values
          const str = String(node.inputs.input_ids)
          inputIds = str
            .split(/[,\s\n]+/)
            .map(id => id.trim())
            .filter(id => id.length > 0)
        }
        
        ids.push(...inputIds)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes])

  const appInfoOutputIds = useMemo(() => {
    const ids: string[] = []
    appInfoNodes.forEach(node => {
      if (node.inputs?.output_ids) {
        let outputIds: string[] = []
        
        if (Array.isArray(node.inputs.output_ids)) {
          // Already an array
          outputIds = node.inputs.output_ids.map(String)
        } else {
          // String - parse comma, space, or newline separated values
          const str = String(node.inputs.output_ids)
          outputIds = str
            .split(/[,\s\n]+/)
            .map(id => id.trim())
            .filter(id => id.length > 0)
        }
        
        ids.push(...outputIds)
      }
    })
    return [...new Set(ids)]
  }, [appInfoNodes])

  // Get configured input/output IDs from params
  const configuredInputIds = params.comfyui_config?.input_ids || []
  const configuredOutputIds = params.comfyui_config?.output_ids || []
  const hiddenNodeIds = params.comfyui_config?.hiddenNodeIds || []
  const wrappedNodeIds = params.comfyui_config?.wrappedNodeIds || []
  
  // Check if input_ids/output_ids are explicitly set (overriding AppInfo)
  const hasExplicitInputIds = params.comfyui_config?.input_ids !== undefined
  const hasExplicitOutputIds = params.comfyui_config?.output_ids !== undefined

  // Helper function to get node parser
  const getNodeParser = useCallback((nodeId: string) => {
    return params.comfyui_config?.node_parsers?.input_nodes?.[nodeId]
  }, [params.comfyui_config?.node_parsers])

  // Determine which nodes are inputs/outputs
  // Include subgraph nodes if they have parsers configured (they are parsed)
  const inputNodes = useMemo(() => {
    const ids = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    const explicitInputNodes = nodes.filter(node => ids.includes(node.id))
    
    // Also include subgraph nodes (nodes with ":" in ID) that have parsers configured
    const nodeParsers = params.comfyui_config?.node_parsers?.input_nodes || {}
    const subgraphNodesWithParsers = nodes.filter(node => {
      // Check if it's a subgraph node (contains ":")
      if (!node.id.includes(':')) return false
      // Check if it has a parser configured
      return !!nodeParsers[node.id]
    })
    
    // Combine and deduplicate
    const allInputNodes = [...explicitInputNodes, ...subgraphNodesWithParsers]
    const uniqueNodes = Array.from(new Map(allInputNodes.map(node => [node.id, node])).values())
    return uniqueNodes
  }, [nodes, configuredInputIds, appInfoInputIds, params.comfyui_config?.node_parsers])

  const outputNodes = useMemo(() => {
    const ids = configuredOutputIds.length > 0 ? configuredOutputIds : appInfoOutputIds
    return nodes.filter(node => ids.includes(node.id))
  }, [nodes, configuredOutputIds, appInfoOutputIds])

  // Group nodes by subgraph
  const groupedNodes = useMemo(() => {
    const topLevel: NodeInfo[] = []
    const subgraphGroups: Record<string, NodeInfo[]> = {}
    
    let nodesToGroup = nodes
    if (selectedCategory === 'input') nodesToGroup = inputNodes
    else if (selectedCategory === 'output') nodesToGroup = outputNodes
    else if (selectedCategory === 'appinfo') nodesToGroup = appInfoNodes

    // Filter by search term if provided
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      nodesToGroup = nodesToGroup.filter(node => 
        node.id.toLowerCase().includes(term) ||
        node.class_type?.toLowerCase().includes(term) ||
        node._meta?.title?.toLowerCase().includes(term) ||
        node.title?.toLowerCase().includes(term)
      )
    }

    // Group nodes - only create subgraph groups for nodes that match the filter
    nodesToGroup.forEach(node => {
      if (node.id.includes(':')) {
        const subgraphId = node.id.split(':')[0]
        if (!subgraphGroups[subgraphId]) {
          subgraphGroups[subgraphId] = []
        }
        subgraphGroups[subgraphId].push(node)
      } else {
        topLevel.push(node)
      }
    })

    // For subgraph groups, also include ALL child nodes from workflowJson (not just filtered ones)
    // This ensures we show all nodes that exist in the subgraph, even if they're not inputs/outputs
    Object.keys(subgraphGroups).forEach(subgraphId => {
      const allSubgraphNodes: NodeInfo[] = []
      const prefix = `${subgraphId}:`
      
      // Get all nodes that belong to this subgraph from the full nodes list
      nodes.forEach(node => {
        if (node.id.startsWith(prefix)) {
          // Check if it's already in the filtered list
          const alreadyIncluded = subgraphGroups[subgraphId].some(n => n.id === node.id)
          if (!alreadyIncluded) {
            // Add it so we show all subgraph nodes, not just filtered ones
            allSubgraphNodes.push(node)
          }
        }
      })
      
      // Merge with already filtered nodes
      subgraphGroups[subgraphId] = [...subgraphGroups[subgraphId], ...allSubgraphNodes]
      
      // Remove duplicates
      const uniqueNodes = Array.from(new Map(subgraphGroups[subgraphId].map(node => [node.id, node])).values())
      subgraphGroups[subgraphId] = uniqueNodes
    })

    // Detect implicit subgraphs: IDs in input_ids/output_ids that don't exist as top-level nodes
    // but have child nodes (e.g., "66" doesn't exist but "66:11", "66:13" do)
    // Determine which IDs to check based on selected category
    let relevantIds: string[] = []
    if (selectedCategory === 'input') {
      relevantIds = configuredInputIds.length > 0 ? configuredInputIds : appInfoInputIds
    } else if (selectedCategory === 'output') {
      relevantIds = configuredOutputIds.length > 0 ? configuredOutputIds : appInfoOutputIds
    } else if (selectedCategory === 'all' || selectedCategory === 'appinfo') {
      // For 'all' or 'appinfo', check all input/output IDs
      relevantIds = [
        ...configuredInputIds,
        ...appInfoInputIds,
        ...configuredOutputIds,
        ...appInfoOutputIds
      ]
    }
    
    // Get all top-level node IDs (nodes without ":")
    const topLevelNodeIds = new Set(nodes.filter(node => !node.id.includes(':')).map(node => node.id))
    
    // Find IDs that are declared but don't exist as top-level nodes
    const implicitSubgraphIds = Array.from(new Set(relevantIds)).filter(id => !topLevelNodeIds.has(id))
    
    // For each implicit subgraph ID, check if it has child nodes
    const term = searchTerm ? searchTerm.toLowerCase() : ''
    implicitSubgraphIds.forEach(subgraphId => {
      const prefix = `${subgraphId}:`
      const childNodes = nodes.filter(node => node.id.startsWith(prefix))
      const hasChildNodes = childNodes.length > 0
      
      if (hasChildNodes) {
        // Check if subgraph should be included based on search term
        // Include if: no search term, or subgraph ID matches, or any child node matches
        let shouldInclude = !term || subgraphId.toLowerCase().includes(term)
        
        // If there's a search term and subgraph ID doesn't match, check if any child node matches
        if (term && !shouldInclude) {
          shouldInclude = childNodes.some(node => 
            node.id.toLowerCase().includes(term) ||
            node.class_type?.toLowerCase().includes(term) ||
            node._meta?.title?.toLowerCase().includes(term) ||
            node.title?.toLowerCase().includes(term)
          )
        }
        
        if (shouldInclude) {
          // This is an implicit subgraph - ensure it exists in subgraphGroups
          if (!subgraphGroups[subgraphId]) {
            subgraphGroups[subgraphId] = []
          }
          
          // Add all child nodes for this implicit subgraph from the full nodes list
          childNodes.forEach(node => {
            const alreadyIncluded = subgraphGroups[subgraphId].some(n => n.id === node.id)
            if (!alreadyIncluded) {
              // If there's a search term, only include nodes that match
              if (term) {
                const nodeMatches = 
                  node.id.toLowerCase().includes(term) ||
                  node.class_type?.toLowerCase().includes(term) ||
                  node._meta?.title?.toLowerCase().includes(term) ||
                  node.title?.toLowerCase().includes(term)
                if (nodeMatches) {
                  subgraphGroups[subgraphId].push(node)
                }
              } else {
                // No search term: include all child nodes
                subgraphGroups[subgraphId].push(node)
              }
            }
          })
        }
      }
    })

    // Include explicitly declared subgraphs from params.comfyui_config.subgraphs
    // These should always be shown even if they don't have visible child nodes in the current filter
    const declaredSubgraphs = params.comfyui_config?.subgraphs || {}
    Object.keys(declaredSubgraphs).forEach(subgraphId => {
      const subgraphConfig = declaredSubgraphs[subgraphId]
      const subgraphLabel = subgraphConfig?.label || `Subgraph ${subgraphId}`
      
      // Check if subgraph should be included based on search term
      // Include if: no search term, or subgraph label/ID matches search term
      const term = searchTerm ? searchTerm.toLowerCase() : ''
      const shouldInclude = !term || 
        subgraphLabel.toLowerCase().includes(term) || 
        subgraphId.toLowerCase().includes(term)
      
      if (shouldInclude) {
        // Ensure the subgraph group exists
        if (!subgraphGroups[subgraphId]) {
          subgraphGroups[subgraphId] = []
        }
        
        // Add all child nodes for this declared subgraph from the full nodes list
        // If there's a search term, filter child nodes; otherwise include all
        const prefix = `${subgraphId}:`
        nodes.forEach(node => {
          if (node.id.startsWith(prefix)) {
            const alreadyIncluded = subgraphGroups[subgraphId].some(n => n.id === node.id)
            if (!alreadyIncluded) {
              // If there's a search term, only include nodes that match
              if (term) {
                const nodeMatches = 
                  node.id.toLowerCase().includes(term) ||
                  node.class_type?.toLowerCase().includes(term) ||
                  node._meta?.title?.toLowerCase().includes(term) ||
                  node.title?.toLowerCase().includes(term)
                if (nodeMatches) {
                  subgraphGroups[subgraphId].push(node)
                }
              } else {
                // No search term: include all child nodes
                subgraphGroups[subgraphId].push(node)
              }
            }
          }
        })
      }
    })

    // For subgraph groups, include additional nodes based on the current filter
    if (selectedCategory === 'all') {
      // When showing all nodes, include ALL child nodes from each subgraph
      // First, identify all subgraphs that exist
      const allSubgraphIds = new Set<string>()
      nodes.forEach(node => {
        if (node.id.includes(':')) {
          const subgraphId = node.id.split(':')[0]
          allSubgraphIds.add(subgraphId)
        }
      })
      
      // Initialize all subgraph groups and add all their nodes
      allSubgraphIds.forEach(subgraphId => {
        if (!subgraphGroups[subgraphId]) {
          subgraphGroups[subgraphId] = []
        }
        const prefix = `${subgraphId}:`
        nodes.forEach(node => {
          if (node.id.startsWith(prefix)) {
            const alreadyIncluded = subgraphGroups[subgraphId].some(n => n.id === node.id)
            if (!alreadyIncluded) {
              subgraphGroups[subgraphId].push(node)
            }
          }
        })
      })
    }
    
    // Remove duplicates from all subgraph groups
    Object.keys(subgraphGroups).forEach(subgraphId => {
      const uniqueNodes = Array.from(new Map(subgraphGroups[subgraphId].map(node => [node.id, node])).values())
      subgraphGroups[subgraphId] = uniqueNodes
    })

    // Sort subgraph groups and their nodes according to nodesOrder if configured
    Object.keys(subgraphGroups).forEach(subgraphId => {
      const subgraphConfig = params.comfyui_config?.subgraphs?.[subgraphId]
      const nodesOrder = subgraphConfig?.nodesOrder
      
      if (nodesOrder && Array.isArray(nodesOrder)) {
        // Sort according to nodesOrder
        subgraphGroups[subgraphId].sort((a, b) => {
          const aChild = a.id.split(':')[1]
          const bChild = b.id.split(':')[1]
          
          const aIndex = nodesOrder.indexOf(aChild)
          const bIndex = nodesOrder.indexOf(bChild)
          
          // If both are in nodesOrder, sort by their position
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex
          }
          // If only a is in nodesOrder, it comes first
          if (aIndex !== -1) return -1
          // If only b is in nodesOrder, it comes first
          if (bIndex !== -1) return 1
          // If neither is in nodesOrder, maintain original order (they go to the end)
          return 0
        })
      } else {
        // Default: sort alphabetically by child ID
        subgraphGroups[subgraphId].sort((a, b) => {
          const aChild = a.id.split(':')[1]
          const bChild = b.id.split(':')[1]
          return aChild.localeCompare(bChild)
        })
      }
    })

    return { topLevel, subgraphGroups }
  }, [nodes, inputNodes, outputNodes, appInfoNodes, selectedCategory, searchTerm, params])

  // Get subgraph labels from params
  const getSubgraphLabel = (subgraphId: string) => {
    return params.comfyui_config?.subgraphs?.[subgraphId]?.label || `Subgraph ${subgraphId}`
  }

  // Update subgraph label
  const updateSubgraphLabel = (subgraphId: string, label: string) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: './workflow.json',
      }
    }
    if (!updatedParams.comfyui_config.subgraphs) {
      updatedParams.comfyui_config.subgraphs = {}
    }
    
    const currentConfig = updatedParams.comfyui_config.subgraphs[subgraphId] || {}
    if (label.trim()) {
      updatedParams.comfyui_config.subgraphs[subgraphId] = {
        ...currentConfig,
        label: label.trim()
      }
    } else {
      // Remove label if empty
      const { label: _, ...rest } = currentConfig
      if (Object.keys(rest).length > 0) {
        updatedParams.comfyui_config.subgraphs[subgraphId] = rest
      } else {
        delete updatedParams.comfyui_config.subgraphs[subgraphId]
        if (Object.keys(updatedParams.comfyui_config.subgraphs).length === 0) {
          updatedParams.comfyui_config.subgraphs = undefined
        }
      }
    }
    
    onUpdateParams(updatedParams)
    setEditingSubgraphLabel(null)
  }

  // Start editing subgraph label
  const startEditingSubgraphLabel = (subgraphId: string) => {
    const currentLabel = params.comfyui_config?.subgraphs?.[subgraphId]?.label || ''
    setSubgraphLabelValue(currentLabel)
    setEditingSubgraphLabel(subgraphId)
  }

  // Cancel editing subgraph label
  const cancelEditingSubgraphLabel = () => {
    setEditingSubgraphLabel(null)
    setSubgraphLabelValue('')
  }

  // Reorder node within subgraph
  const reorderSubgraphNode = (subgraphId: string, nodeId: string, direction: 'up' | 'down') => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: './workflow.json',
      }
    }
    if (!updatedParams.comfyui_config.subgraphs) {
      updatedParams.comfyui_config.subgraphs = {}
    }
    
    const subgraphConfig = updatedParams.comfyui_config.subgraphs[subgraphId] || {}
    const currentOrder = subgraphConfig.nodesOrder || []
    
    // Extract child ID (part after ":")
    const childId = nodeId.includes(':') ? nodeId.split(':')[1] : nodeId
    
    // Get all child nodes for this subgraph to build complete order if needed
    const prefix = `${subgraphId}:`
    const allChildNodes = nodes
      .filter(node => node.id.startsWith(prefix))
      .map(node => node.id.split(':')[1])
      .sort((a, b) => a.localeCompare(b))
    
    // Build the order array: start with currentOrder, then add any missing nodes
    let newOrder = [...currentOrder]
    allChildNodes.forEach(childId => {
      if (!newOrder.includes(childId)) {
        newOrder.push(childId)
      }
    })
    
    // Find current index
    const currentIndex = newOrder.indexOf(childId)
    if (currentIndex === -1) return // Node not found
    
    // Calculate new index
    let newIndex: number
    if (direction === 'up') {
      newIndex = Math.max(0, currentIndex - 1)
    } else {
      newIndex = Math.min(newOrder.length - 1, currentIndex + 1)
    }
    
    // If position didn't change, do nothing
    if (newIndex === currentIndex) return
    
    // Swap nodes
    const temp = newOrder[currentIndex]
    newOrder[currentIndex] = newOrder[newIndex]
    newOrder[newIndex] = temp
    
    // Update params
    updatedParams.comfyui_config.subgraphs[subgraphId] = {
      ...subgraphConfig,
      nodesOrder: newOrder
    }
    
    onUpdateParams(updatedParams)
  }

  // Filter nodes based on search and category (for backward compatibility)
  const filteredNodes = useMemo(() => {
    let filtered = nodes
    if (selectedCategory === 'input') filtered = inputNodes
    else if (selectedCategory === 'output') filtered = outputNodes
    else if (selectedCategory === 'appinfo') filtered = appInfoNodes

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(node => 
        node.id.toLowerCase().includes(term) ||
        node.class_type?.toLowerCase().includes(term) ||
        node._meta?.title?.toLowerCase().includes(term) ||
        node.title?.toLowerCase().includes(term)
      )
    }
    return filtered
  }, [nodes, inputNodes, outputNodes, appInfoNodes, selectedCategory, searchTerm])

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  const toggleSubgraph = (subgraphId: string) => {
    const newExpanded = new Set(expandedSubgraphs)
    if (newExpanded.has(subgraphId)) {
      newExpanded.delete(subgraphId)
    } else {
      newExpanded.add(subgraphId)
    }
    setExpandedSubgraphs(newExpanded)
  }

  const addToArray = (arrayName: 'input_ids' | 'output_ids' | 'hiddenNodeIds' | 'wrappedNodeIds', nodeId: string) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: '',
      }
    }
    
    const currentArray = updatedParams.comfyui_config[arrayName] || []
    if (!currentArray.includes(nodeId)) {
      updatedParams.comfyui_config[arrayName] = [...currentArray, nodeId]
      onUpdateParams(updatedParams)
    }
  }

  const removeFromArray = (arrayName: 'input_ids' | 'output_ids' | 'hiddenNodeIds' | 'wrappedNodeIds', nodeId: string) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) return
    
    let currentArray = updatedParams.comfyui_config[arrayName] || []
    
    // If array is empty and we're removing from input_ids/output_ids, 
    // we need to initialize it from AppInfo to exclude the node
    if (currentArray.length === 0 && (arrayName === 'input_ids' || arrayName === 'output_ids')) {
      if (arrayName === 'input_ids') {
        currentArray = [...appInfoInputIds]
      } else if (arrayName === 'output_ids') {
        currentArray = [...appInfoOutputIds]
      }
    }
    
    updatedParams.comfyui_config[arrayName] = currentArray.filter(id => id !== nodeId)
    onUpdateParams(updatedParams)
  }

  // Check if a node's label is hidden (for subgraph nodes)
  const isNodeLabelHidden = (nodeId: string): boolean => {
    if (!nodeId.includes(':')) return false // Not a subgraph node
    
    const [subgraphId, childId] = nodeId.split(':')
    const subgraphConfig = params.comfyui_config?.subgraphs?.[subgraphId]
    if (!subgraphConfig) return false

    // showNodeLabels takes precedence
    if (subgraphConfig.showNodeLabels !== undefined) {
      if (typeof subgraphConfig.showNodeLabels === 'boolean') {
        return !subgraphConfig.showNodeLabels // If showNodeLabels is true, label is NOT hidden
      }
      if (Array.isArray(subgraphConfig.showNodeLabels)) {
        return !subgraphConfig.showNodeLabels.includes(childId) // If in showNodeLabels array, label is NOT hidden
      }
    }

    // Check hideNodeLabels
    if (subgraphConfig.hideNodeLabels !== undefined) {
      if (typeof subgraphConfig.hideNodeLabels === 'boolean') {
        return subgraphConfig.hideNodeLabels // If true, all labels are hidden
      }
      if (Array.isArray(subgraphConfig.hideNodeLabels)) {
        return subgraphConfig.hideNodeLabels.includes(childId) // If in array, label is hidden
      }
    }

    return false
  }

  // Toggle node label visibility for subgraph nodes
  const toggleNodeLabelHidden = (nodeId: string) => {
    if (!nodeId.includes(':')) return // Not a subgraph node
    
    const [subgraphId, childId] = nodeId.split(':')
    const updatedParams = { ...params }
    
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: '',
      }
    }
    
    if (!updatedParams.comfyui_config.subgraphs) {
      updatedParams.comfyui_config.subgraphs = {}
    }
    
    const subgraphConfig = updatedParams.comfyui_config.subgraphs[subgraphId] || {}
    const isHidden = isNodeLabelHidden(nodeId)
    
    // If showNodeLabels exists, we need to manage that instead
    if (subgraphConfig.showNodeLabels !== undefined) {
      if (typeof subgraphConfig.showNodeLabels === 'boolean') {
        // Convert to array format
        if (isHidden) {
          // Show this label: add to showNodeLabels array
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            showNodeLabels: [childId]
          }
        } else {
          // Hide this label: remove from showNodeLabels (or set to empty array)
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            showNodeLabels: []
          }
        }
      } else if (Array.isArray(subgraphConfig.showNodeLabels)) {
        if (isHidden) {
          // Show this label: add to array
          const newArray = [...subgraphConfig.showNodeLabels, childId]
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            showNodeLabels: newArray
          }
        } else {
          // Hide this label: remove from array
          const newArray = subgraphConfig.showNodeLabels.filter(id => id !== childId)
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            showNodeLabels: newArray.length > 0 ? newArray : undefined
          }
        }
      }
    } else {
      // Use hideNodeLabels
      if (isHidden) {
        // Show this label: remove from hideNodeLabels array
        if (typeof subgraphConfig.hideNodeLabels === 'boolean') {
          // Convert boolean to array format, excluding this node
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            hideNodeLabels: [] // Empty array means no labels hidden
          }
        } else if (Array.isArray(subgraphConfig.hideNodeLabels)) {
          const newArray = subgraphConfig.hideNodeLabels.filter(id => id !== childId)
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            hideNodeLabels: newArray.length > 0 ? newArray : undefined
          }
        } else {
          // No hideNodeLabels config, create array without this node
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            hideNodeLabels: []
          }
        }
      } else {
        // Hide this label: add to hideNodeLabels array
        if (typeof subgraphConfig.hideNodeLabels === 'boolean') {
          // Convert boolean to array format
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            hideNodeLabels: [childId]
          }
        } else if (Array.isArray(subgraphConfig.hideNodeLabels)) {
          const newArray = [...subgraphConfig.hideNodeLabels, childId]
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            hideNodeLabels: newArray
          }
        } else {
          // No hideNodeLabels config, create array with this node
          updatedParams.comfyui_config.subgraphs[subgraphId] = {
            ...subgraphConfig,
            hideNodeLabels: [childId]
          }
        }
      }
    }
    
    onUpdateParams(updatedParams)
  }

  const handleSaveParser = (nodeId: string, parserConfig: any) => {
    const updatedParams = { ...params }
    if (!updatedParams.comfyui_config) {
      updatedParams.comfyui_config = {
        serverUrl: 'http://127.0.0.1:8188',
        workflow: '',
      }
    }
    
    if (!updatedParams.comfyui_config.node_parsers) {
      updatedParams.comfyui_config.node_parsers = {}
    }
    
    if (!updatedParams.comfyui_config.node_parsers.input_nodes) {
      updatedParams.comfyui_config.node_parsers.input_nodes = {}
    }
    
    updatedParams.comfyui_config.node_parsers.input_nodes[nodeId] = parserConfig
    onUpdateParams(updatedParams)
    setEditingParser(null)
  }

  const formatNodeValue = (value: any): string => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') {
      // Truncate long strings
      if (value.length > 50) return value.substring(0, 47) + '...'
      return value
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      if (value.length === 1) return `[${formatNodeValue(value[0])}]`
      return `[${value.length} items]`
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 0) return '{}'
      if (keys.length === 1) {
        return `{${keys[0]}: ${formatNodeValue(value[keys[0]])}}`
      }
      return `{${keys.length} fields}`
    }
    return String(value)
  }

  const getNodeValuePreview = (node: NodeInfo): string | null => {
    if (!node.inputs || Object.keys(node.inputs).length === 0) return null
    
    const inputKeys = Object.keys(node.inputs)
    
    // Single input: show the value
    if (inputKeys.length === 1) {
      const key = inputKeys[0]
      const value = node.inputs[key]
      // Skip if it's a node reference (array with node ID)
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return null
      }
      return `${key}: ${formatNodeValue(value)}`
    }
    
    // Multiple inputs: show summary
    // Try to find a "text" or "value" field first (common in ComfyUI)
    const priorityFields = ['text', 'value', 'prompt', 'seed', 'steps', 'width', 'height']
    for (const field of priorityFields) {
      if (node.inputs[field] !== undefined) {
        const value = node.inputs[field]
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
          continue // Skip node references
        }
        return `${field}: ${formatNodeValue(value)}`
      }
    }
    
    // Otherwise show count
    return `${inputKeys.length} inputs`
  }

  const renderNode = (node: NodeInfo, subgraphId?: string, nodeIndex?: number, totalNodes?: number) => {
    const isExpanded = expandedNodes.has(node.id)
    const isInput = inputNodes.some(n => n.id === node.id)
    const isOutput = outputNodes.some(n => n.id === node.id)
    const isHidden = hiddenNodeIds.includes(node.id)
    const isWrapped = wrappedNodeIds.includes(node.id)
    const isSubgraphNode = node.id.includes(':')
    const isLabelHidden = isSubgraphNode ? isNodeLabelHidden(node.id) : false
    const nodeParser = getNodeParser(node.id)
    const hasParser = !!nodeParser
    const valuePreview = !isExpanded ? getNodeValuePreview(node) : null
    // Only show reorder buttons for actual subgraph nodes (with ":" in ID) within a subgraph group
    const showReorderButtons = isSubgraphNode && subgraphId !== undefined && nodeIndex !== undefined && totalNodes !== undefined
    const canMoveUp = showReorderButtons && nodeIndex > 0
    const canMoveDown = showReorderButtons && nodeIndex < totalNodes! - 1

    return (
      <div key={node.id} className="node-item">
        <div className="node-header">
          {showReorderButtons ? (
            <div className="node-header-controls">
              <div className="node-reorder-buttons" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canMoveUp && subgraphId) {
                      reorderSubgraphNode(subgraphId, node.id, 'up')
                    }
                  }}
                  className={`node-reorder-btn ${canMoveUp ? '' : 'disabled'}`}
                  title="Move up"
                  disabled={!canMoveUp}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (canMoveDown && subgraphId) {
                      reorderSubgraphNode(subgraphId, node.id, 'down')
                    }
                  }}
                  className={`node-reorder-btn ${canMoveDown ? '' : 'disabled'}`}
                  title="Move down"
                  disabled={!canMoveDown}
                >
                  <ArrowDown size={12} />
                </button>
              </div>
              <div className="node-expand-icon" onClick={() => toggleNode(node.id)}>
                {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
              </div>
            </div>
          ) : (
            <div className="node-expand-icon" onClick={() => toggleNode(node.id)}>
              {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
            </div>
          )}
          <div className="node-header-left" onClick={() => toggleNode(node.id)}>
            <div className="node-id-section">
              <span className="node-id">{node.id}</span>
            </div>
            <div className="node-title-section">
              {(node._meta?.title || node.title) && (
                <span className="node-title">{node._meta?.title || node.title}</span>
              )}
            </div>
            <div className="node-type-section">
              <span className="node-type">{node.class_type}</span>
            </div>
            <div className="node-badges-section">
              {isInput && <span className="node-badge input-badge">Input</span>}
              {isOutput && <span className="node-badge output-badge">Output</span>}
              {isHidden && <span className="node-badge hidden-badge">Hidden</span>}
              {isWrapped && <span className="node-badge wrapped-badge">Wrapped</span>}
              {hasParser && <span className="node-badge parser-badge">Parsed</span>}
            </div>
            <div className="node-value-section">
              {valuePreview && (
                <span 
                  className="node-value-preview" 
                  title={valuePreview}
                >
                  {valuePreview}
                </span>
              )}
            </div>
          </div>
          <div className="node-header-actions" onClick={(e) => e.stopPropagation()}>
            {!isHidden ? (
              <button
                onClick={() => addToArray('hiddenNodeIds', node.id)}
                className="node-quick-action-btn"
                title="Hide this node from UI"
              >
                <Eye size={14} />
              </button>
            ) : (
              <button
                onClick={() => removeFromArray('hiddenNodeIds', node.id)}
                className="node-quick-action-btn node-quick-action-btn-active"
                title="Show this node in UI"
              >
                <EyeOff size={14} />
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="node-details">
            <div className="node-actions">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const currentNode = nodes.find(n => n.id === node.id)
                  if (currentNode) {
                    setEditingParser({
                      nodeId: currentNode.id,
                      nodeType: currentNode.class_type,
                      nodeInputs: currentNode.inputs || {}
                    })
                  }
                }}
                className={`action-btn ${hasParser ? 'parser' : ''}`}
                title={hasParser ? 'Edit parser config' : 'Configure parser'}
              >
                <Edit2 size={12} /> {hasParser ? 'Edit Parser' : 'Configure Parser'}
              </button>
              {!isWrapped ? (
                <button
                  onClick={() => addToArray('wrappedNodeIds', node.id)}
                  className="action-btn"
                >
                  <Package size={12} /> Wrap Node
                </button>
              ) : (
                <button
                  onClick={() => removeFromArray('wrappedNodeIds', node.id)}
                  className="action-btn remove"
                >
                  <Package size={12} /> Unwrap Node
                </button>
              )}
              {!isHidden ? (
                <button
                  onClick={() => addToArray('hiddenNodeIds', node.id)}
                  className="action-btn"
                >
                  <EyeOff size={12} /> Hide Node
                </button>
              ) : (
                <button
                  onClick={() => removeFromArray('hiddenNodeIds', node.id)}
                  className="action-btn remove"
                >
                  <Eye size={12} /> Show Node
                </button>
              )}
              {isSubgraphNode && (
                isLabelHidden ? (
                  <button
                    onClick={() => toggleNodeLabelHidden(node.id)}
                    className="action-btn remove"
                    title="Show node label"
                  >
                    <Tag size={12} /> Show Label
                  </button>
                ) : (
                  <button
                    onClick={() => toggleNodeLabelHidden(node.id)}
                    className="action-btn"
                    title="Hide node label"
                  >
                    <Tag size={12} /> Hide Label
                  </button>
                )
              )}
              <div className="more-menu-wrapper">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setMoreMenuOpen(moreMenuOpen === node.id ? null : node.id)
                  }}
                  className={`action-btn more-menu-btn ${moreMenuOpen === node.id ? 'active' : ''}`}
                  title="More options"
                >
                  <MoreVertical size={12} /> More
                </button>
                {moreMenuOpen === node.id && (
                  <div className="more-menu-dropdown">
                    {!isInput ? (
                      <button
                        onClick={() => {
                          addToArray('input_ids', node.id)
                          setMoreMenuOpen(null)
                        }}
                        className="more-menu-item"
                      >
                        <Plus size={12} /> Add to Input IDs
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          removeFromArray('input_ids', node.id)
                          setMoreMenuOpen(null)
                        }}
                        className="more-menu-item remove"
                      >
                        <X size={12} /> Remove from Input IDs
                      </button>
                    )}
                    {!isOutput ? (
                      <button
                        onClick={() => {
                          addToArray('output_ids', node.id)
                          setMoreMenuOpen(null)
                        }}
                        className="more-menu-item"
                      >
                        <Plus size={12} /> Add to Output IDs
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          removeFromArray('output_ids', node.id)
                          setMoreMenuOpen(null)
                        }}
                        className="more-menu-item remove"
                      >
                        <X size={12} /> Remove from Output IDs
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {hasParser && (
              <div className="node-parser-config">
                <strong>Parser Configuration:</strong>
                <pre className="parser-config-preview">
                  {JSON.stringify(nodeParser, null, 2)}
                </pre>
              </div>
            )}

            {node.inputs && Object.keys(node.inputs).length > 0 && (
              <div className="node-inputs">
                <strong>Inputs:</strong>
                <div className="inputs-list">
                  {Object.entries(node.inputs).map(([key, value]) => {
                    const fieldParser = nodeParser?.inputs?.[key]
                    return (
                      <div key={key} className="input-item">
                        <span className="input-key">
                          {key}
                          {fieldParser === false && <span className="field-hidden-badge">Hidden</span>}
                          {fieldParser && typeof fieldParser === 'object' && (
                            <span className="field-parsed-badge">{fieldParser.type || 'Parsed'}</span>
                          )}
                          :
                        </span>
                        <span className="input-value">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (!workflowJson || params.parser !== 'comfyui') {
    return null
  }

  return (
    <div className="node-manager">
      <div className="node-manager-header">
        <h3>
          <Settings size={20} />
          Node Manager
        </h3>
        <div className="node-manager-controls">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="category-tabs">
            <button
              className={selectedCategory === 'input' ? 'active' : ''}
              onClick={() => setSelectedCategory('input')}
            >
              Input ({inputNodes.length})
            </button>
            <button
              className={selectedCategory === 'output' ? 'active' : ''}
              onClick={() => setSelectedCategory('output')}
            >
              Output ({outputNodes.length})
            </button>
            <button
              className={selectedCategory === 'appinfo' ? 'active' : ''}
              onClick={() => setSelectedCategory('appinfo')}
            >
              AppInfo ({appInfoNodes.length})
            </button>
            <button
              className={selectedCategory === 'all' ? 'active' : ''}
              onClick={() => setSelectedCategory('all')}
            >
              All ({nodes.length})
            </button>
            <button
              className={`group-toggle ${groupBySubgraph ? 'active' : ''}`}
              onClick={() => setGroupBySubgraph(!groupBySubgraph)}
              title={groupBySubgraph ? 'Show flat list' : 'Group by subgraph'}
            >
              <Package size={14} />
              {groupBySubgraph ? 'Grouped' : 'Flat'}
            </button>
          </div>
        </div>
      </div>

      {appInfoNodes.length > 0 && (
        <div className="appinfo-banner">
          <Info size={16} />
          <span>
            Found {appInfoNodes.length} AppInfo node(s). 
            {appInfoInputIds.length > 0 && ` ${appInfoInputIds.length} input node(s) exposed.`}
            {appInfoOutputIds.length > 0 && ` ${appInfoOutputIds.length} output node(s) exposed.`}
          </span>
        </div>
      )}

      {(hasExplicitInputIds || hasExplicitOutputIds) && (
        <div className="explicit-config-banner">
          <Info size={16} />
          <span>
            {hasExplicitInputIds && "Input IDs are explicitly set in params.json (overriding AppInfo). "}
            {hasExplicitOutputIds && "Output IDs are explicitly set in params.json (overriding AppInfo)."}
          </span>
        </div>
      )}

      <div className="nodes-list">
        {filteredNodes.length > 0 && (
          <>
            <div className="nodes-list-header">
              <div></div>
              <div>ID</div>
              <div>Title</div>
              <div>Type</div>
              <div>Status</div>
              <div>Value</div>
              <div></div>
            </div>
            {groupBySubgraph ? (
              <>
                {/* Top-level nodes */}
                {groupedNodes.topLevel.length > 0 && (
                  <div className="node-group">
                    <div className="node-group-header">
                      <span className="group-label">Top-Level Nodes</span>
                      <span className="group-count">({groupedNodes.topLevel.length})</span>
                    </div>
                    <div className="node-group-content">
                      {groupedNodes.topLevel.map(renderNode)}
                    </div>
                  </div>
                )}
                {/* Subgraph groups */}
                {Object.entries(groupedNodes.subgraphGroups)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([subgraphId, subgraphNodes]) => {
                    const isExpanded = expandedSubgraphs.has(subgraphId)
                    const subgraphLabel = getSubgraphLabel(subgraphId)
                    const isSubgraphWrapped = wrappedNodeIds.includes(subgraphId)
                    return (
                      <div key={subgraphId} className="node-group subgraph-group">
                        <div 
                          className="node-group-header subgraph-header" 
                          onClick={(e) => {
                            // Don't toggle if clicking on the label edit area or action buttons
                            if ((e.target as HTMLElement).closest('.subgraph-label-edit') ||
                                (e.target as HTMLElement).closest('.subgraph-header-actions')) {
                              return
                            }
                            toggleSubgraph(subgraphId)
                          }}
                        >
                          <div className="subgraph-expand-icon">
                            {isExpanded ? <ArrowDown size={16} /> : <ArrowRight size={16} />}
                          </div>
                          {editingSubgraphLabel === subgraphId ? (
                            <div className="subgraph-label-edit" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                value={subgraphLabelValue}
                                onChange={(e) => setSubgraphLabelValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    updateSubgraphLabel(subgraphId, subgraphLabelValue)
                                  } else if (e.key === 'Escape') {
                                    cancelEditingSubgraphLabel()
                                  }
                                }}
                                onBlur={() => updateSubgraphLabel(subgraphId, subgraphLabelValue)}
                                autoFocus
                                className="subgraph-label-input"
                                placeholder={`Subgraph ${subgraphId}`}
                              />
                              <button
                                onClick={() => updateSubgraphLabel(subgraphId, subgraphLabelValue)}
                                className="subgraph-label-save-btn"
                                title="Save"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={cancelEditingSubgraphLabel}
                                className="subgraph-label-cancel-btn"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <span 
                              className="group-label subgraph-label-clickable"
                              onClick={(e) => {
                                e.stopPropagation()
                                startEditingSubgraphLabel(subgraphId)
                              }}
                              title="Click to edit label"
                            >
                              {subgraphLabel}
                            </span>
                          )}
                          <span className="group-count">({subgraphNodes.length})</span>
                          <span className="subgraph-id">ID: {subgraphId}</span>
                          {isSubgraphWrapped && <span className="node-badge wrapped-badge" style={{ marginLeft: '8px' }}>Wrapped</span>}
                          <div className="subgraph-header-actions" onClick={(e) => e.stopPropagation()}>
                            {!isSubgraphWrapped ? (
                              <button
                                onClick={() => addToArray('wrappedNodeIds', subgraphId)}
                                className="subgraph-action-btn"
                                title="Wrap subgraph"
                              >
                                <Package size={14} />
                              </button>
                            ) : (
                              <button
                                onClick={() => removeFromArray('wrappedNodeIds', subgraphId)}
                                className="subgraph-action-btn subgraph-action-btn-active"
                                title="Unwrap subgraph"
                              >
                                <Package size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="node-group-content subgraph-content">
                            {subgraphNodes.map((node, index) => 
                              renderNode(node, subgraphId, index, subgraphNodes.length)
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </>
            ) : (
              filteredNodes.map(renderNode)
            )}
          </>
        )}
        {filteredNodes.length === 0 && (
          <div className="empty-nodes">
            <p>No nodes found</p>
          </div>
        )}
      </div>

      {editingParser && (
        <NodeParserEditor
          nodeId={editingParser.nodeId}
          nodeType={editingParser.nodeType}
          nodeInputs={editingParser.nodeInputs}
          currentParser={getNodeParser(editingParser.nodeId)}
          workflowJson={workflowJson}
          params={params}
          onSave={(parserConfig) => handleSaveParser(editingParser.nodeId, parserConfig)}
          onClose={() => setEditingParser(null)}
        />
      )}
    </div>
  )
}

