import { useMemo, useState } from 'react'
import { Download, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { PowerflowConfig, RawWorkflow } from './parser-types'
import {
  detectOutputCandidates,
  isOutputTracked,
  setOutputTracked,
  KNOWN_OUTPUT_CLASS_TYPES,
} from './powerflow'

/** Output-nodes section in NodeBlocks. Lists every node detected as a
 *  workflow output (SaveImage / PreviewImage / VHS_VideoCombine / …) with a
 *  checkbox to include it in `powerflowConfig.availableConnections.outputs`.
 *
 *  Detection is heuristic via class_type. Any workflow node can still be
 *  tracked manually via the PowerFlow modal — this section is the fast path
 *  for the common case. Custom output nodes (tracked but not in the
 *  known-sinks list) render in a separate "custom" block so the user sees
 *  them even when the detector misses.
 */

export function OutputNodesSection({
  workflow,
  cfg,
  onChange,
}: {
  workflow: RawWorkflow
  cfg: PowerflowConfig | null
  onChange: (next: PowerflowConfig | null) => void
}) {
  const [open, setOpen] = useState(true)

  const candidates = useMemo(() => detectOutputCandidates(workflow), [workflow])

  // "custom" = nodes tracked in powerflow.outputs whose class_type isn't in
  // the known-sinks heuristic. Surfaced so the user doesn't lose track of
  // them just because they don't match the auto-detector.
  const customTracked = useMemo(() => {
    const list = cfg?.availableConnections?.outputs ?? []
    return list
      .filter((spec) => {
        const node = workflow[spec.nodeId]
        return node && !KNOWN_OUTPUT_CLASS_TYPES.has(node.class_type)
      })
      .map((spec) => ({
        nodeId: spec.nodeId,
        classType: workflow[spec.nodeId]?.class_type ?? '?',
        title: workflow[spec.nodeId]?._meta?.title ?? spec.nodeId,
      }))
  }, [cfg, workflow])

  // "ghost" = tracked node ids that don't exist in the workflow anymore.
  // Useful signal: the user probably wants to remove these.
  const ghosts = useMemo(() => {
    const list = cfg?.availableConnections?.outputs ?? []
    return list.filter((spec) => !workflow[spec.nodeId])
  }, [cfg, workflow])

  const trackedCount = cfg?.availableConnections?.outputs?.length ?? 0

  const toggle = (nodeId: string) => {
    const next = setOutputTracked(cfg, nodeId, !isOutputTracked(cfg, nodeId))
    onChange(next)
  }

  return (
    <div
      style={{
        border: '1px dashed var(--line)',
        borderRadius: 8,
        background: 'var(--surface)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Download size={13} style={{ color: 'var(--ink-3)' }} />
        <strong style={{ fontSize: 13 }}>Output nodes</strong>
        <span style={{ flex: 1 }} />
        <span className="chip" style={{ fontSize: 10 }}>
          {trackedCount} tracked
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: 10,
            borderTop: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {candidates.length === 0 && customTracked.length === 0 && ghosts.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '4px 4px' }}>
              No output-style nodes detected in this workflow. Add nodes manually via the PowerFlow
              modal.
            </div>
          )}

          {candidates.map((c) => (
            <OutputRow
              key={c.nodeId}
              nodeId={c.nodeId}
              classType={c.classType}
              title={c.title}
              tracked={isOutputTracked(cfg, c.nodeId)}
              onToggle={() => toggle(c.nodeId)}
            />
          ))}

          {customTracked.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  color: 'var(--ink-3)',
                  marginTop: 6,
                }}
              >
                Custom (manually added)
              </div>
              {customTracked.map((c) => (
                <OutputRow
                  key={c.nodeId}
                  nodeId={c.nodeId}
                  classType={c.classType}
                  title={c.title}
                  tracked
                  onToggle={() => toggle(c.nodeId)}
                />
              ))}
            </>
          )}

          {ghosts.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  color: 'var(--warn)',
                  marginTop: 6,
                }}
              >
                Tracked but missing in workflow
              </div>
              {ghosts.map((g) => (
                <div
                  key={g.nodeId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'color-mix(in oklab, var(--warn) 10%, transparent)',
                    border: '1px solid color-mix(in oklab, var(--warn) 30%, transparent)',
                  }}
                >
                  <span className="mono" style={{ fontSize: 11 }}>
                    {g.nodeId}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: 1 }}>
                    Node not present in workflow.json
                  </span>
                  <button
                    className="btn btn-xs"
                    onClick={() => toggle(g.nodeId)}
                    title="Remove from powerflowConfig.outputs"
                  >
                    Untrack
                  </button>
                </div>
              ))}
            </>
          )}

          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            <Plus size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Need a non-detected output? Open the PowerFlow modal to add any node by id.
          </div>
        </div>
      )}
    </div>
  )
}

function OutputRow({
  nodeId,
  classType,
  title,
  tracked,
  onToggle,
}: {
  nodeId: string
  classType: string
  title: string
  tracked: boolean
  onToggle: () => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--line)',
        background: tracked
          ? 'color-mix(in oklab, var(--accent) 8%, var(--surface))'
          : 'var(--surface)',
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={tracked}
        onChange={onToggle}
        style={{ width: 14, height: 14, accentColor: 'var(--accent)' }}
      />
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {nodeId}
      </span>
      <span style={{ fontSize: 13, fontWeight: tracked ? 600 : 400, flex: 1, minWidth: 0 }}>
        {title}
      </span>
      <span className="chip" style={{ fontSize: 10 }}>
        {classType}
      </span>
    </label>
  )
}
