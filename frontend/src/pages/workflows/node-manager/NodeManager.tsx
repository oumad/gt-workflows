import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Zap } from 'lucide-react'
import { api } from '../../../lib/api'
import type { Workflow } from '../../../types'
import {
  parseWorkflow,
  moveItem,
  updateFieldInModel,
  getAvailableNodes,
  addInputNode,
  removeInputNode,
  applyModelToWorkflow,
  applyFieldConnectToToParams,
  type FieldValue,
  type ParsedModel,
  type AvailableNode,
} from './parser'
import type { PowerflowConfig, RawParams, RawWorkflow } from './parser-types'
import { readPowerflow, writePowerflow } from './powerflow'
import { Preview } from './Preview'
import { NodeBlocks } from './NodeBlocks'
import { EditNodeModal } from './EditNodeModal'
import { PowerflowConfigModal } from './PowerflowConfigModal'

type Props = {
  wf: Workflow
  isAdmin: boolean
  hidden?: boolean
  onDirtyChange?: (dirty: boolean) => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}

const MIN_PCT = 20
const MAX_PCT = 80

export function NodeManager({ wf, isAdmin: _isAdmin, hidden, onDirtyChange, saveRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(50)
  const [dragging, setDragging] = useState(false)

  /* ── Splitter drag ─────────────────────────────────────────── */
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)))
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging])

  /* ── Load params.json + workflow.json ──────────────────────── */
  const [model, setModel] = useState<ParsedModel | null>(null)
  const [rawWorkflow, setRawWorkflow] = useState<Record<string, unknown> | null>(null)
  const [rawParams, setRawParams] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [, setIsDirty] = useState(false)
  const [powerflowOpen, setPowerflowOpen] = useState(false)
  // Snapshots taken after the initial load so we can diff against current
  // state for dirty tracking. Powerflow lives on rawParams (not the model),
  // so we track both axes — either changing flips the dirty flag.
  const initialModelRef = useRef<string | null>(null)
  const initialParamsRef = useRef<string | null>(null)

  const reorder = useCallback((fromPath: number[], toParent: number[], toIdx: number) => {
    setModel((prev) => (prev ? moveItem(prev, fromPath, toParent, toIdx) : prev))
  }, [])

  const toggleExpanded = useCallback((id: string, defaultOpen: boolean) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultOpen) }))
  }, [])

  const onFieldChange = useCallback((fieldId: string, value: FieldValue) => {
    setModel((prev) => (prev ? updateFieldInModel(prev, fieldId, { default: value }) : prev))
  }, [])

  const availableNodes = useMemo<AvailableNode[]>(
    () => (model && rawWorkflow ? getAvailableNodes(model, rawWorkflow) : []),
    [model, rawWorkflow],
  )

  const addNode = useCallback(
    (nodeId: string) => {
      if (!rawWorkflow || !rawParams) return
      setModel((prev) => (prev ? addInputNode(prev, nodeId, rawWorkflow, rawParams) : prev))
    },
    [rawWorkflow, rawParams],
  )

  /* ── Dirty tracking — model OR rawParams (powerflow lives on params) ── */
  useEffect(() => {
    if (initialModelRef.current === null || initialParamsRef.current === null) return
    const modelDirty = model ? JSON.stringify(model) !== initialModelRef.current : false
    const paramsDirty = rawParams ? JSON.stringify(rawParams) !== initialParamsRef.current : false
    const newDirty = modelDirty || paramsDirty
    setIsDirty(newDirty)
    onDirtyChange?.(newDirty)
  }, [model, rawParams, onDirtyChange])

  /* ── Save function ─────────────────────────────────────────── */
  const save = useCallback(async () => {
    if (!model || !rawWorkflow || !rawParams) return
    const updatedWorkflow = applyModelToWorkflow(model, rawWorkflow as never)
    // Re-stitch field-level connectTo onto params from the model so any
    // future restructuring of the parser config can't silently drop it.
    const updatedParams = applyFieldConnectToToParams(model, rawParams as RawParams)
    await Promise.all([
      api.put(`/api/workflows/${wf.id}/files/workflow`, updatedWorkflow),
      api.put(`/api/workflows/${wf.id}/files/params`, updatedParams),
    ])
    initialModelRef.current = JSON.stringify(model)
    initialParamsRef.current = JSON.stringify(updatedParams)
    setRawParams(updatedParams as Record<string, unknown>)
    setIsDirty(false)
    onDirtyChange?.(false)
  }, [model, rawWorkflow, rawParams, wf.id, onDirtyChange])

  /* ── Register save fn with parent ─────────────────────────── */
  useEffect(() => {
    if (saveRef) saveRef.current = save
    return () => {
      if (saveRef) saveRef.current = null
    }
  }, [save, saveRef])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setModel(null)
    setRawWorkflow(null)
    setRawParams(null)
    setEditingId(null)
    setExpanded({})
    setIsDirty(false)
    onDirtyChange?.(false)
    initialModelRef.current = null

    Promise.all([
      api.get<Record<string, unknown>>(`/api/workflows/${wf.id}/files/params`),
      api.get<Record<string, unknown>>(`/api/workflows/${wf.id}/files/workflow`),
    ])
      .then(([params, workflow]) => {
        if (cancelled) return
        const parsed = parseWorkflow(params as never, workflow as never, wf.name)
        setModel(parsed)
        setRawWorkflow(workflow)
        setRawParams(params)
        initialModelRef.current = JSON.stringify(parsed)
        initialParamsRef.current = JSON.stringify(params)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load workflow')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [wf.id, wf.name, onDirtyChange])

  /* PowerFlow live config getter + setter — backed by rawParams. The modal
   * receives a snapshot and pushes back the full next config; we splice it
   * onto rawParams via writePowerflow. */
  const powerflowCfg = readPowerflow(rawParams as RawParams | null)
  const handlePowerflowChange = useCallback(
    (next: PowerflowConfig | null) => {
      setRawParams((prev) => writePowerflow(prev as RawParams | null, next) as Record<string, unknown>)
    },
    [],
  )
  const powerflowEnabled = powerflowCfg?.enabled ?? false

  const HEADER_H = 40

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        height: 'calc(100vh - 220px)',
        minHeight: 400,
        display: hidden ? 'none' : undefined,
      }}
    >
      {/* Header bar — hosts the PowerFlow modal entry. Kept slim so it
       *  doesn't steal vertical room from the splitter below. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: HEADER_H,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 4px',
        }}
      >
        <button
          className={`btn btn-sm ${powerflowEnabled ? 'btn-primary' : ''}`}
          onClick={() => setPowerflowOpen(true)}
          disabled={!rawWorkflow || !rawParams}
          title={
            powerflowCfg
              ? `PowerFlow ${powerflowEnabled ? 'enabled' : 'configured but disabled'} — click to edit`
              : 'Configure the PowerFlow integration on this workflow'
          }
        >
          <Zap size={13} /> PowerFlow{powerflowCfg ? (powerflowEnabled ? ' · on' : ' · off') : ''}
        </button>
      </div>

      <div
        style={{
          position: 'absolute',
          top: HEADER_H,
          bottom: 0,
          left: 0,
          width: `${leftPct}%`,
          paddingRight: 8,
          boxSizing: 'border-box',
        }}
      >
        <NodeBlocks
          model={model}
          loading={loading}
          error={error}
          onReorder={reorder}
          onEditNode={setEditingId}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          availableNodes={availableNodes}
          onAddNode={addNode}
          rawWorkflow={rawWorkflow as RawWorkflow | null}
          powerflowCfg={powerflowCfg}
          onPowerflowChange={handlePowerflowChange}
        />
      </div>

      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute',
          top: HEADER_H,
          bottom: 0,
          left: `${leftPct}%`,
          marginLeft: -3,
          width: 6,
          cursor: 'col-resize',
          background: dragging ? 'var(--ink-3)' : 'transparent',
          borderRadius: 3,
          transition: dragging ? 'none' : 'background 120ms',
        }}
        onMouseEnter={(e) => {
          if (!dragging) e.currentTarget.style.background = 'var(--line)'
        }}
        onMouseLeave={(e) => {
          if (!dragging) e.currentTarget.style.background = 'transparent'
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 2,
            height: 28,
            borderRadius: 1,
            background: 'var(--ink-3)',
            opacity: 0.4,
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          top: HEADER_H,
          bottom: 0,
          right: 0,
          left: `${leftPct}%`,
          paddingLeft: 8,
          boxSizing: 'border-box',
        }}
      >
        <Preview
          model={model}
          loading={loading}
          error={error}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          onFieldChange={onFieldChange}
        />
      </div>

      {editingId && model && (
        <EditNodeModal
          nodeId={editingId}
          model={model}
          rawNode={(rawWorkflow?.[editingId] as never) ?? null}
          onClose={() => setEditingId(null)}
          onChange={(updater) => setModel((prev) => (prev ? updater(prev) : prev))}
          onDelete={() => setModel((prev) => (prev ? removeInputNode(prev, editingId) : prev))}
        />
      )}

      {powerflowOpen && rawWorkflow && (
        <PowerflowConfigModal
          config={powerflowCfg}
          workflow={rawWorkflow as RawWorkflow}
          onChange={handlePowerflowChange}
          onClose={() => setPowerflowOpen(false)}
        />
      )}
    </div>
  )
}
