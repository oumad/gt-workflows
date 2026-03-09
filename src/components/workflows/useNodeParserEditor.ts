import { useState, useEffect } from 'react'
import type { InputFieldConfig } from './NodeParserEditor'
import type { NodeVisibilityConnectToConfig } from './NodeVisibilityEditor'

const COPIED_CONNECTTO_KEY = 'gt-workflows-copied-connectTo'
const COPIED_NODEPARSER_KEY = 'gt-workflows-copied-nodeParser'

export function useNodeParserEditor(currentParser: Record<string, unknown>, onSave: (config: Record<string, unknown>) => void) {
  const [inputConfigs, setInputConfigs] = useState<Record<string, InputFieldConfig>>({})
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set())
  const [nodeConnectTo, setNodeConnectTo] = useState<NodeVisibilityConnectToConfig | undefined>(undefined)
  const [copiedFeedback, setCopiedFeedback] = useState(false)

  useEffect(() => {
    if (currentParser?.inputs) {
      const configs: Record<string, InputFieldConfig> = {}
      const hidden = new Set<string>()
      Object.entries(currentParser.inputs as Record<string, unknown>).forEach(([fieldName, config]) => {
        if (config === false) hidden.add(fieldName)
        else if (typeof config === 'object' && config !== null) configs[fieldName] = config as InputFieldConfig
      })
      setInputConfigs(configs)
      setHiddenFields(hidden)
    }
    setNodeConnectTo(currentParser?.connectTo ? (currentParser.connectTo as NodeVisibilityConnectToConfig) : undefined)
  }, [currentParser])

  const updateFieldConfig = (fieldName: string, updates: Partial<InputFieldConfig>) => {
    setInputConfigs(prev => ({ ...prev, [fieldName]: { ...prev[fieldName], ...updates } }))
  }

  const toggleFieldHidden = (fieldName: string) => {
    setHiddenFields(prev => {
      const next = new Set(prev)
      if (next.has(fieldName)) {
        next.delete(fieldName)
        const existing = (currentParser?.inputs as Record<string, unknown> | undefined)?.[fieldName]
        if (existing && existing !== false) {
          setInputConfigs(prevConfigs => ({ ...prevConfigs, [fieldName]: existing as InputFieldConfig }))
        }
      } else {
        next.add(fieldName)
        setInputConfigs(prev => { const c = { ...prev }; delete c[fieldName]; return c })
      }
      return next
    })
  }

  const addFieldConfig = (fieldName: string) => {
    setInputConfigs(prev => ({ ...prev, [fieldName]: { type: 'textField' } }))
    setHiddenFields(prev => { const next = new Set(prev); next.delete(fieldName); return next })
  }

  const removeFieldConfig = (fieldName: string) => {
    setInputConfigs(prev => { const c = { ...prev }; delete c[fieldName]; return c })
  }

  const handleSave = () => {
    const parserConfig: Record<string, unknown> = { inputs: {} as Record<string, unknown> }
    hiddenFields.forEach(f => { (parserConfig.inputs as Record<string, unknown>)[f] = false })
    Object.entries(inputConfigs).forEach(([f, cfg]) => {
      if (!hiddenFields.has(f)) (parserConfig.inputs as Record<string, unknown>)[f] = cfg
    })
    if (nodeConnectTo?.nodeId && nodeConnectTo?.inputField && nodeConnectTo.conditions.length > 0) {
      parserConfig.connectTo = nodeConnectTo
    }
    onSave(parserConfig)
  }

  const hasCopiedConnectTo = (): boolean => {
    try {
      const raw = sessionStorage.getItem(COPIED_CONNECTTO_KEY)
      if (!raw) return false
      const p = JSON.parse(raw)
      return p && typeof p.nodeId === 'string' && typeof p.inputField === 'string' && Array.isArray(p.conditions) && p.conditions.length > 0
    } catch { return false }
  }

  const hasCopiedNodeParser = (): boolean => {
    try {
      const raw = sessionStorage.getItem(COPIED_NODEPARSER_KEY)
      if (!raw) return false
      const p = JSON.parse(raw)
      return p && typeof p.inputs === 'object'
    } catch { return false }
  }

  const copyVisibilityConditions = () => {
    if (!nodeConnectTo?.nodeId || !nodeConnectTo?.inputField || !nodeConnectTo.conditions.length) return
    try {
      sessionStorage.setItem(COPIED_CONNECTTO_KEY, JSON.stringify(nodeConnectTo))
      setCopiedFeedback(true)
      setTimeout(() => setCopiedFeedback(false), 2000)
    } catch (e) { console.warn('Failed to copy conditions', e) }
  }

  const pasteVisibilityConditions = () => {
    try {
      const raw = sessionStorage.getItem(COPIED_CONNECTTO_KEY)
      if (!raw) return
      const p = JSON.parse(raw)
      if (p && typeof p.nodeId === 'string' && typeof p.inputField === 'string' && Array.isArray(p.conditions)) {
        setNodeConnectTo({ nodeId: p.nodeId, inputField: p.inputField, conditions: p.conditions })
      }
    } catch (e) { console.warn('Failed to paste conditions', e) }
  }

  const copyFullParser = () => {
    try {
      const inputs: Record<string, unknown> = {}
      hiddenFields.forEach(f => { inputs[f] = false })
      Object.entries(inputConfigs).forEach(([f, cfg]) => { inputs[f] = cfg })
      const payload: Record<string, unknown> = { inputs }
      if (nodeConnectTo?.nodeId && nodeConnectTo?.inputField && nodeConnectTo.conditions?.length) payload.connectTo = nodeConnectTo
      sessionStorage.setItem(COPIED_NODEPARSER_KEY, JSON.stringify(payload))
      setCopiedFeedback(true)
      setTimeout(() => setCopiedFeedback(false), 2000)
    } catch (e) { console.warn('Failed to copy parser', e) }
  }

  const pasteFullParser = () => {
    try {
      const raw = sessionStorage.getItem(COPIED_NODEPARSER_KEY)
      if (!raw) return
      const p = JSON.parse(raw)
      if (!p || typeof p.inputs !== 'object') return
      const configs: Record<string, InputFieldConfig> = {}
      const hidden = new Set<string>()
      Object.entries(p.inputs as Record<string, unknown>).forEach(([f, cfg]) => {
        if (cfg === false) hidden.add(f)
        else if (cfg && typeof cfg === 'object') configs[f] = cfg as InputFieldConfig
      })
      setInputConfigs(configs)
      setHiddenFields(hidden)
      if (p.connectTo && typeof p.connectTo.nodeId === 'string' && typeof p.connectTo.inputField === 'string' && Array.isArray(p.connectTo.conditions)) {
        setNodeConnectTo(p.connectTo)
      } else {
        setNodeConnectTo(undefined)
      }
    } catch (e) { console.warn('Failed to paste parser', e) }
  }

  return {
    inputConfigs, hiddenFields, nodeConnectTo, setNodeConnectTo, copiedFeedback,
    updateFieldConfig, toggleFieldHidden, addFieldConfig, removeFieldConfig, handleSave,
    hasCopiedConnectTo, hasCopiedNodeParser,
    copyVisibilityConditions, pasteVisibilityConditions, copyFullParser, pasteFullParser,
  }
}
