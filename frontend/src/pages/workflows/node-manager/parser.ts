/* Public API: model mutation helpers + re-exports for parsing. */

export * from './parser-types'
export { parseWorkflow } from './parser-build'

import type {
  NodeFlags,
  ParsedField,
  ParsedSection,
  ParsedModel,
  ShowWhenRule,
  AvailableNode,
  RawWorkflow,
  RawParams,
} from './parser-types'
import { DEFAULT_NODE_PARSERS, buildNodeFields, mergeParser } from './parser-build'

/* ── Lookup / mutation helpers ───────────────────────────────── */

export function findNodeFields(model: ParsedModel, nodeId: string): ParsedField[] {
  const out: ParsedField[] = []
  for (const sec of model.sections) {
    if (sec.kind === 'field') {
      if (sec.field.id.startsWith(nodeId + '#')) out.push(sec.field)
    } else {
      for (const f of sec.children) if (f.id.startsWith(nodeId + '#')) out.push(f)
    }
  }
  return out
}

export function findCategoryForNode(
  model: ParsedModel,
  nodeId: string,
): { index: number; section: Extract<ParsedSection, { kind: 'category' }> } | null {
  for (let i = 0; i < model.sections.length; i++) {
    const sec = model.sections[i]
    if (sec.kind === 'category' && sec.id === nodeId) return { index: i, section: sec }
  }
  return null
}

export function updateFieldInModel(
  model: ParsedModel,
  fieldId: string,
  patch: Partial<ParsedField>,
): ParsedModel {
  return {
    ...model,
    sections: model.sections.map((sec) => {
      if (sec.kind === 'field' && sec.field.id === fieldId) {
        return { ...sec, field: { ...sec.field, ...patch } }
      }
      if (sec.kind === 'category') {
        let changed = false
        const children = sec.children.map((f) => {
          if (f.id === fieldId) {
            changed = true
            return { ...f, ...patch }
          }
          return f
        })
        return changed ? { ...sec, children } : sec
      }
      return sec
    }),
  }
}

export function updateCategoryInModel(
  model: ParsedModel,
  nodeId: string,
  patch: Partial<Extract<ParsedSection, { kind: 'category' }>>,
): ParsedModel {
  return {
    ...model,
    sections: model.sections.map((sec) =>
      sec.kind === 'category' && sec.id === nodeId ? { ...sec, ...patch } : sec,
    ),
  }
}

export function setNodeHidden(model: ParsedModel, nodeId: string, hidden: boolean): ParsedModel {
  const flag = hidden || undefined
  return {
    ...model,
    sections: model.sections.map((sec) => {
      if (sec.kind === 'field') {
        if (sec.field.id.startsWith(nodeId + '#')) {
          return { ...sec, field: { ...sec.field, hidden: flag } }
        }
        return sec
      }
      const matchSection = sec.id === nodeId
      let childChanged = false
      const children = sec.children.map((f) => {
        if (f.id.startsWith(nodeId + '#')) {
          childChanged = true
          return { ...f, hidden: flag }
        }
        return f
      })
      if (matchSection) return { ...sec, hidden: flag, children }
      return childChanged ? { ...sec, children } : sec
    }),
  }
}

/** Replace the `showWhen` rule set on every field belonging to `nodeId`.
 *  Pass `null` (or an empty array) to clear the gates entirely. */
export function setNodeConnectTo(
  model: ParsedModel,
  nodeId: string,
  rules: ShowWhenRule[] | null,
): ParsedModel {
  const next = rules && rules.length > 0 ? rules : null
  return {
    ...model,
    sections: model.sections.map((sec) => {
      if (sec.kind === 'field') {
        if (sec.field.id.startsWith(nodeId + '#')) {
          const f = { ...sec.field }
          if (next) f.showWhen = next
          else delete f.showWhen
          return { ...sec, field: f }
        }
        return sec
      }
      let changed = false
      const children = sec.children.map((f) => {
        if (f.id.startsWith(nodeId + '#')) {
          changed = true
          const updated = { ...f }
          if (next) updated.showWhen = next
          else delete updated.showWhen
          return updated
        }
        return f
      })
      return changed ? { ...sec, children } : sec
    }),
  }
}

/**
 * Toggle wrapped state for a node.
 *  - Top-level field section → category (with that field as its only child)
 *  - Top-level wrapped category whose children all come from the same node → unwrap back to inline fields
 *  - Subgraph category → flip wrapped flag (controls defaultOpen)
 *  - Field inside a subgraph → no-op (can't wrap inside a subgraph)
 */
export function toggleWrap(model: ParsedModel, nodeId: string): ParsedModel {
  const cat = findCategoryForNode(model, nodeId)
  if (cat) {
    const sec = cat.section
    // Subgraph: flip wrapped/defaultOpen
    const isSubgraphCat = sec.children.some((f) => !f.id.startsWith(nodeId + '#'))
    if (isSubgraphCat) {
      const next = { ...sec, wrapped: !sec.wrapped || undefined, defaultOpen: !!sec.wrapped }
      return { ...model, sections: model.sections.map((s, i) => (i === cat.index ? next : s)) }
    }
    // Wrapped single-node category → unwrap to inline fields
    const fieldSections: ParsedSection[] = sec.children.map((f) => ({
      kind: 'field' as const,
      field: { ...f, hideTitle: false, wrapped: undefined },
    }))
    return {
      ...model,
      sections: [
        ...model.sections.slice(0, cat.index),
        ...fieldSections,
        ...model.sections.slice(cat.index + 1),
      ],
    }
  }

  // Find as top-level field(s): wrap them into a category
  const indices: number[] = []
  for (let i = 0; i < model.sections.length; i++) {
    const s = model.sections[i]
    if (s.kind === 'field' && s.field.id.startsWith(nodeId + '#')) indices.push(i)
  }
  if (indices.length === 0) return model
  const fields = indices.map(
    (i) => (model.sections[i] as { kind: 'field'; field: ParsedField }).field,
  )
  const newCat: ParsedSection = {
    kind: 'category',
    id: nodeId,
    label: fields[0].title,
    defaultOpen: false,
    wrapped: true,
    children: fields.map((f) => ({ ...f, hideTitle: true })),
    input: fields[0].input,
    parsed: fields[0].parsed,
  }
  const first = indices[0]
  const without = model.sections.filter((_, i) => !indices.includes(i))
  return { ...model, sections: [...without.slice(0, first), newCat, ...without.slice(first)] }
}

/* ── Available nodes / add input node ───────────────────────── */

/** Return all workflow nodes not yet present in the model. */
export function getAvailableNodes(
  model: ParsedModel,
  workflow: Record<string, unknown>,
): AvailableNode[] {
  const wf = workflow as RawWorkflow
  const usedIds = new Set<string>()
  for (const sec of model.sections) {
    if (sec.kind === 'field') {
      usedIds.add(sec.field.id.split('#')[0])
    } else {
      usedIds.add(sec.id)
      for (const f of sec.children) usedIds.add(f.id.split('#')[0])
    }
  }
  const out: AvailableNode[] = []
  for (const [id, node] of Object.entries(wf)) {
    if (usedIds.has(id)) continue
    if (id.includes(':')) continue // subgraph child
    if (node.class_type === 'AppInfo') continue
    out.push({ id, classType: node.class_type, title: node._meta?.title ?? id })
  }
  return out
}

/** Remove all sections belonging to nodeId from the model. */
export function removeInputNode(model: ParsedModel, nodeId: string): ParsedModel {
  return {
    ...model,
    sections: model.sections.filter((sec) =>
      sec.kind === 'field' ? !sec.field.id.startsWith(nodeId + '#') : sec.id !== nodeId,
    ),
  }
}

/** Append a workflow node as a new input section to the model. */
export function addInputNode(
  model: ParsedModel,
  nodeId: string,
  workflow: Record<string, unknown>,
  params: Record<string, unknown>,
): ParsedModel {
  const wf = workflow as RawWorkflow
  const p = params as RawParams
  const node = wf[nodeId]
  if (!node) return model
  const cfg = p.comfyui_config
  const parsers = cfg?.node_parsers?.input_nodes ?? {}
  const placeholders = cfg?.placeholders ?? {}
  const compareId = cfg?.outputComparator?.inputNodeId ?? null
  const flags: NodeFlags = {
    input: true,
    parsed: nodeId in parsers || undefined,
    defaulted: node.class_type in DEFAULT_NODE_PARSERS || undefined,
  }
  const fields = buildNodeFields(
    nodeId,
    node,
    mergeParser(node.class_type, parsers[nodeId]),
    placeholders,
    false,
    compareId,
  )
  for (const f of fields) Object.assign(f, flags)

  let newSection: ParsedSection
  if (fields.length === 0) {
    // No parseable fields — visible placeholder so the node appears
    newSection = {
      kind: 'field',
      field: {
        id: `${nodeId}#_`,
        title: node._meta?.title ?? nodeId,
        hideTitle: false,
        type: 'unknown',
        default: '',
        ...flags,
      },
    }
  } else if (fields.length === 1) {
    newSection = { kind: 'field', field: fields[0] }
  } else {
    newSection = {
      kind: 'category',
      id: nodeId,
      label: node._meta?.title ?? nodeId,
      defaultOpen: true,
      children: fields,
      ...flags,
    }
  }
  return { ...model, sections: [...model.sections, newSection] }
}

/* ── Save serializer ─────────────────────────────────────────── */

/**
 * Applies model field-value changes back onto rawWorkflow.
 * Returns a new rawWorkflow with updated inputs from the model's current defaults.
 */
export function applyModelToWorkflow(model: ParsedModel, rawWorkflow: RawWorkflow): RawWorkflow {
  const updated = structuredClone(rawWorkflow) as RawWorkflow
  for (const sec of model.sections) {
    const fields = sec.kind === 'field' ? [sec.field] : sec.kind === 'category' ? sec.children : []
    for (const field of fields) {
      const [nodeId, fieldName] = field.id.split('#')
      if (!nodeId || !fieldName) continue
      const node = updated[nodeId]
      if (!node?.inputs) continue
      if (fieldName in node.inputs) {
        node.inputs[fieldName] = field.default
      }
    }
  }
  return updated
}

/**
 * Re-stitch any field-level connectTo blocks held on the model back onto
 * rawParams. Defensive: today rawParams is saved verbatim so cfg.connectTo
 * survives by virtue of never being rewritten — but a future feature could
 * regenerate the parser config from the model and would silently drop these
 * blocks. Running this on save guarantees the model's fieldConnectTo is
 * always reflected on disk. No-op when no field carries fieldConnectTo.
 *
 * Untouched fields keep whatever connectTo (or lack thereof) rawParams
 * already had — we never delete a block that's only in rawParams.
 */
export function applyFieldConnectToToParams(model: ParsedModel, rawParams: RawParams): RawParams {
  // Fast path: collect all fields that carry a fieldConnectTo. If none, the
  // clone-and-walk below would be wasted work.
  const entries: {
    nodeId: string
    fieldName: string
    spec: NonNullable<ParsedField['fieldConnectTo']>
  }[] = []
  for (const sec of model.sections) {
    const fields = sec.kind === 'field' ? [sec.field] : sec.kind === 'category' ? sec.children : []
    for (const f of fields) {
      if (!f.fieldConnectTo) continue
      const [nodeId, fieldName] = f.id.split('#')
      if (!nodeId || !fieldName) continue
      entries.push({ nodeId, fieldName, spec: f.fieldConnectTo })
    }
  }
  if (entries.length === 0) return rawParams

  const next = structuredClone(rawParams) as RawParams
  const cfg = (next.comfyui_config ??= {})
  const parsers = (cfg.node_parsers ??= {})
  const inputNodes = (parsers.input_nodes ??= {})
  for (const { nodeId, fieldName, spec } of entries) {
    const nodeCfg = (inputNodes[nodeId] ??= {})
    const inputs = (nodeCfg.inputs ??= {})
    const existing = inputs[fieldName]
    // Only update when the slot already holds a config object — we don't
    // want to materialise an entry where the field had `false` (explicitly
    // hidden) or was absent (used a default parser). The truthy check
    // narrows away `false` and `undefined` in one step.
    if (existing && typeof existing === 'object') {
      existing.connectTo = spec
    }
  }
  return next
}

/* ── Reordering ──────────────────────────────────────────────── */

export function moveItem(
  model: ParsedModel,
  fromPath: number[],
  toParent: number[],
  toIdx: number,
): ParsedModel {
  // Top-level reorder among sections
  if (fromPath.length === 1 && toParent.length === 0) {
    const sections = [...model.sections]
    const [m] = sections.splice(fromPath[0], 1)
    const adj = fromPath[0] < toIdx ? toIdx - 1 : toIdx
    sections.splice(adj, 0, m)
    return { ...model, sections }
  }
  // Reorder a field within its category
  if (fromPath.length === 2 && toParent.length === 1 && fromPath[0] === toParent[0]) {
    const sections = [...model.sections]
    const cat = sections[fromPath[0]]
    if (cat.kind !== 'category') return model
    const children = [...cat.children]
    const [m] = children.splice(fromPath[1], 1)
    const adj = fromPath[1] < toIdx ? toIdx - 1 : toIdx
    children.splice(adj, 0, m)
    sections[fromPath[0]] = { ...cat, children }
    return { ...model, sections }
  }
  return model
}
