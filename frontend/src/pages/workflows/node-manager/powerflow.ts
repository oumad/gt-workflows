import type {
  PowerflowConfig,
  PowerflowNodeSpec,
  PowerflowFieldSpec,
  RawWorkflow,
  RawParams,
} from './parser-types'

/* Helpers for reading/writing the top-level `powerflowConfig` on params.json
 * and for detecting candidate output nodes in a workflow. */

/** Class types that ComfyUI ships as output sinks (or that the cluster's
 *  custom nodes use as such). Detection is conservative — we surface these
 *  as candidates, the user picks which to track. Extend as new sinks land. */
export const KNOWN_OUTPUT_CLASS_TYPES = new Set([
  'SaveImage',
  'PreviewImage',
  'SaveAnimatedWEBP',
  'SaveAnimatedPNG',
  'SaveVideo',
  'VHS_VideoCombine',
  'VHS_SaveVideo',
  'SaveAudio',
  'PreviewAudio',
  'AppOutput',
  'AppOutputImage',
])

export interface OutputCandidate {
  nodeId: string
  classType: string
  title: string
}

/** Scan the workflow for nodes that look like outputs. Two heuristics:
 *  1. Class type matches the known-sinks list above (high confidence).
 *  2. Node has no other node referencing it (sink in the graph). Suppressed
 *     when (1) matches no nodes — heuristic-2 is too broad on dense graphs.
 *  Subgraph children (id contains ':') and AppInfo are skipped. */
export function detectOutputCandidates(workflow: RawWorkflow): OutputCandidate[] {
  const known: OutputCandidate[] = []
  for (const [id, node] of Object.entries(workflow)) {
    if (id.includes(':')) continue
    if (node.class_type === 'AppInfo') continue
    if (KNOWN_OUTPUT_CLASS_TYPES.has(node.class_type)) {
      known.push({ nodeId: id, classType: node.class_type, title: node._meta?.title ?? id })
    }
  }
  return known.sort((a, b) => a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true }))
}

/** Read the powerflow config off a raw params object. Returns `null` when
 *  unset so callers can render an "enable" affordance instead of empty form
 *  fields. */
export function readPowerflow(rawParams: RawParams | null): PowerflowConfig | null {
  return rawParams?.powerflowConfig ?? null
}

/** Overwrite (or clear, when `next == null`) the powerflow config on
 *  `rawParams` and return the new params object so the caller can update
 *  state. Clones to avoid mutating the React-held reference. */
export function writePowerflow(
  rawParams: RawParams | null,
  next: PowerflowConfig | null,
): RawParams {
  const base = (rawParams ? { ...rawParams } : {}) as RawParams
  if (next == null) {
    delete base.powerflowConfig
  } else {
    base.powerflowConfig = next
  }
  return base
}

/** Normalize a field spec to its canonical `{name, label, type}` shape for
 *  the editor UI. Strings collapse to `{name: <string>}` so all consumers
 *  can treat the field uniformly. */
export function normalizeField(
  spec: PowerflowFieldSpec,
): { name: string; label?: string; type?: string } {
  if (typeof spec === 'string') return { name: spec }
  return { name: spec.name, label: spec.label, type: spec.type }
}

/** Inverse of normalizeField — collapses an editor-shape back to the bare
 *  string when no label/type is set so saved JSON stays clean. */
export function compactField(field: {
  name: string
  label?: string
  type?: string
}): PowerflowFieldSpec {
  if (!field.label && !field.type) return field.name
  const out: { name: string; label?: string; type?: string } = { name: field.name }
  if (field.label) out.label = field.label
  if (field.type) out.type = field.type
  return out
}

/** Is the given workflow node tracked in powerflow.outputs? Used by the
 *  Outputs section in NodeBlocks to show check state on each candidate row. */
export function isOutputTracked(cfg: PowerflowConfig | null, nodeId: string): boolean {
  return (cfg?.availableConnections?.outputs ?? []).some((n) => n.nodeId === nodeId)
}

/** Add (or remove, when `tracked=false`) a node to powerflow.outputs.
 *  When adding, seeds `fields` with empty list — the user fills it in via
 *  the powerflow modal. */
export function setOutputTracked(
  cfg: PowerflowConfig | null,
  nodeId: string,
  tracked: boolean,
): PowerflowConfig {
  const base: PowerflowConfig = cfg ?? {}
  const ac = base.availableConnections ?? {}
  const outputs = [...(ac.outputs ?? [])]
  const idx = outputs.findIndex((n) => n.nodeId === nodeId)
  if (tracked) {
    if (idx === -1) outputs.push({ nodeId, fields: [] })
  } else {
    if (idx !== -1) outputs.splice(idx, 1)
  }
  return { ...base, availableConnections: { ...ac, outputs } }
}

/** Replace a single node spec by id. No-op when the id isn't present. */
export function updateNodeSpec(
  list: PowerflowNodeSpec[],
  nodeId: string,
  patch: Partial<PowerflowNodeSpec>,
): PowerflowNodeSpec[] {
  return list.map((n) => (n.nodeId === nodeId ? { ...n, ...patch } : n))
}
