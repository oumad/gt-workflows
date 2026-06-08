/* Parse ComfyUI params.json + workflow.json into a preview model. */

import type {
  FieldValue,
  FieldType,
  SelectOption,
  AIConfig,
  NodeFlags,
  ParsedField,
  ParsedSection,
  ParsedModel,
  ShowWhenRule,
  FieldConfig,
  ParserCfg,
  RawNode,
  RawWorkflow,
  ConnectTo,
  RawParams,
} from './parser-types'

/* ── Default parsers per class_type ──────────────────────────── */

export const DEFAULT_NODE_PARSERS: Record<string, Record<string, FieldConfig | false>> = {
  TextInput_: { text: { type: 'textArea' } },
  CLIPTextEncode: { text: { type: 'textArea' }, clip: false },
  LoadImage: { image: { type: 'uploadImage', accept: '<ACCEPTED_IMG_FORMATS>' }, upload: false },
  LoadVideo: { file: { type: 'uploadVideo' } },
  ETN_LoadImageBase64: { image: { type: 'uploadImage', accept: '<ACCEPTED_IMG_FORMATS>' } },
  IntNumber: {
    number: { type: 'slider', min: 'min_value', max: 'max_value', step: 'step' },
    min_value: false,
    max_value: false,
    step: false,
  },
  FloatSlider: {
    number: { type: 'slider', min: 'min_value', max: 'max_value', step: 'step' },
    min_value: false,
    max_value: false,
    step: false,
  },
  'Switch any [Crystools]': { boolean: { type: 'checkbox' } },
  VHS_LoadVideo: {
    video: { type: 'uploadVideo' },
    force_size: false,
    frame_load_cap: false,
    skip_first_frames: false,
    select_every_nth: false,
  },
  LoadAudio: { audio: { type: 'uploadAudio' }, audioUI: false },
  'Seed (rgthree)': { seed: { type: 'number' } },
}

/* ── Helpers ─────────────────────────────────────────────────── */
export function findAppInfoInputIds(wf: RawWorkflow): string[] {
  for (const node of Object.values(wf)) {
    if (node.class_type === 'AppInfo') {
      const ids = node.inputs?.['input_ids']
      if (typeof ids === 'string')
        return ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
    }
  }
  return []
}

export function fieldId(nodeId: string, fieldName: string): string {
  return `${nodeId}#${fieldName}`
}

export function resolveAccept(
  raw: string | string[] | undefined,
  placeholders: Record<string, string[]>,
): string[] | undefined {
  if (!raw) return undefined
  if (Array.isArray(raw)) return raw
  const m = raw.match(/^<(.+)>$/)
  if (m) return placeholders[m[1]] // undefined when unresolvable → no restriction
  return [raw]
}

export function parseOptions(raw: unknown[] | undefined): SelectOption[] {
  if (!raw) return []
  const out: SelectOption[] = []
  for (const o of raw) {
    if (typeof o === 'string' || typeof o === 'number') {
      out.push({ value: String(o) })
    } else if (o && typeof o === 'object') {
      const r = o as {
        value?: unknown
        label?: unknown
        image?: { name?: unknown }
        fetchUrl?: unknown
      }
      if (r.fetchUrl) {
        out.push({ value: '__dynamic__', label: '[Dynamic: fetched from API]', dynamic: true })
        continue
      }
      if (typeof r.value === 'string' || typeof r.value === 'number') {
        const opt: SelectOption = { value: String(r.value) }
        if (typeof r.label === 'string') opt.label = r.label
        if (r.image && typeof r.image === 'object' && typeof r.image.name === 'string') {
          opt.image = r.image.name
        }
        out.push(opt)
      }
    }
  }
  return out
}

export function mergeParser(classType: string, custom: ParserCfg | undefined): ParserCfg {
  const def = DEFAULT_NODE_PARSERS[classType]
  if (!def && !custom) return {}
  return {
    ...(custom ?? {}),
    inputs: { ...(def ?? {}), ...(custom?.inputs ?? {}) },
  }
}

/** Collect every condition into a ShowWhenRule entry. Each conditions[] item
 *  may set displayedWhen (visible-when-matched) OR hiddenWhen (hidden-when-
 *  matched); both flavours can coexist on the same connectTo block — gt-
 *  plugins uses this to express "show when modeA or modeB, hide when locked".
 *  Previously only the first matching condition survived; that dropped the
 *  rest silently. */
export function evalCondition(cond: ConnectTo): Array<{ equals: FieldValue; inverted?: true }> {
  const out: Array<{ equals: FieldValue; inverted?: true }> = []
  for (const c of cond.conditions) {
    if (c.displayedWhen !== undefined) out.push({ equals: c.displayedWhen })
    if (c.hiddenWhen !== undefined) out.push({ equals: c.hiddenWhen, inverted: true })
  }
  return out
}

export function readNum(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback
}

export function prettyFieldName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isConnection(v: unknown): boolean {
  return Array.isArray(v)
}

/* ── Build fields for a single node ──────────────────────────── */
export function buildNodeFields(
  nodeId: string,
  node: RawNode,
  parserCfg: ParserCfg,
  placeholders: Record<string, string[]>,
  hideTitle: boolean,
  compareId: string | null,
): ParsedField[] {
  const inputs = node.inputs ?? {}
  const cfgInputs = parserCfg.inputs ?? {}

  // First pass: list fields that survive (skip connections, false config, missing config)
  const renderable: string[] = []
  for (const [fname, raw] of Object.entries(inputs)) {
    if (isConnection(raw)) continue
    const cfg = cfgInputs[fname]
    if (cfg === false) continue
    if (!cfg || !cfg.type) continue
    renderable.push(fname)
  }

  const fields: ParsedField[] = []
  for (const fname of renderable) {
    const cfg = cfgInputs[fname] as FieldConfig
    const raw = inputs[fname]
    const type = cfg.type as FieldType
    const title =
      cfg.label ??
      (renderable.length === 1
        ? (node._meta?.title ?? prettyFieldName(fname))
        : prettyFieldName(fname))

    const f: ParsedField = {
      id: fieldId(nodeId, fname),
      title,
      hideTitle,
      type,
      default: '' as FieldValue,
    }

    switch (type) {
      case 'textField':
      case 'textArea': {
        f.default =
          typeof raw === 'string' ? raw : typeof cfg.default === 'string' ? cfg.default : ''
        if (type === 'textArea') {
          const ai: AIConfig = {}
          if (cfg.aiRefine?.enable)
            ai.refine = { ...(cfg.aiRefine.preset && { preset: cfg.aiRefine.preset }) }
          if (cfg.aiDescribeImage?.enable)
            ai.describeImage = {
              ...(cfg.aiDescribeImage.systemPrompt && {
                systemPrompt: cfg.aiDescribeImage.systemPrompt,
              }),
            }
          if (Object.keys(ai).length) f.ai = ai
        }
        break
      }
      case 'checkbox':
        f.default = raw === true || cfg.default === true
        break
      case 'number':
      case 'slider': {
        const fallback = typeof cfg.default === 'number' ? cfg.default : 0
        f.default = readNum(raw, fallback)
        // min/max/step can be literal numbers, or string refs to sibling inputs on this same node
        const resolve = (v: number | string | undefined): number | undefined => {
          if (typeof v === 'number') return v
          if (typeof v === 'string') {
            const ref = inputs[v]
            return typeof ref === 'number' ? ref : undefined
          }
          return undefined
        }
        const min = resolve(cfg.min)
        const max = resolve(cfg.max)
        const step = resolve(cfg.step)
        if (min !== undefined) f.min = min
        if (max !== undefined) f.max = max
        if (step !== undefined) f.step = step
        break
      }
      case 'select': {
        f.options = parseOptions(cfg.options)
        const def =
          typeof cfg.default === 'string' || typeof cfg.default === 'number'
            ? String(cfg.default)
            : typeof raw === 'string' || typeof raw === 'number'
              ? String(raw)
              : (f.options[0]?.value ?? '')
        f.default = def
        break
      }
      case 'uploadImage':
        f.default = typeof raw === 'string' ? raw : ''
        f.accept = resolveAccept(cfg.accept, placeholders)
        f.imageSize = cfg.imageSize
        f.drawMask = cfg.drawMaskEnable === true
        if (compareId === nodeId) f.compare = true
        break
      case 'uploadVideo':
      case 'uploadAudio':
        f.default = typeof raw === 'string' ? raw : ''
        f.accept = resolveAccept(cfg.accept, placeholders)
        break
      case 'file':
      case 'folder':
        f.default = typeof raw === 'string' ? raw : ''
        f.accept = resolveAccept(cfg.accept, placeholders)
        break
      default:
        f.default =
          typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : ''
    }

    if (cfg.required === true) f.required = true

    // Field-level connectTo (different schema from node-level: {whenValue,value}
    // auto-set instead of {displayedWhen, hiddenWhen} visibility). Stash the
    // raw block so it survives round-trip — the editor surfaces a read-only
    // badge but doesn't try to interpret it.
    if (cfg.connectTo) f.fieldConnectTo = cfg.connectTo

    fields.push(f)
  }

  // Apply node-level connectTo gating (applies to all fields from this node).
  // Multi-condition: every conditions[] entry becomes a ShowWhenRule, so
  // OR-of-displayed and AND-of-not-hidden combinations survive parsing.
  if (parserCfg.connectTo) {
    const rules = evalCondition(parserCfg.connectTo)
    if (rules.length > 0) {
      const tgt = fieldId(parserCfg.connectTo.nodeId, parserCfg.connectTo.inputField)
      const showWhen: ShowWhenRule[] = rules.map((r) => ({
        fieldId: tgt,
        equals: r.equals,
        ...(r.inverted && { inverted: true }),
      }))
      for (const f of fields) f.showWhen = showWhen
    }
  }

  return fields
}

/* ── Public entry ────────────────────────────────────────────── */
export function parseWorkflow(
  params: RawParams,
  workflow: RawWorkflow,
  workflowName: string,
): ParsedModel {
  const cfg = params.comfyui_config
  const wrapped = new Set(cfg?.wrappedNodeIds ?? [])
  const hidden = new Set(cfg?.hiddenNodeIds ?? [])
  const subs = cfg?.subgraphs ?? {}
  const parsers = cfg?.node_parsers?.input_nodes ?? {}
  const placeholders = cfg?.placeholders ?? {}
  const compareId = cfg?.outputComparator?.inputNodeId ?? null

  const inputIds = findAppInfoInputIds(workflow)
  const inputIdSet = new Set(inputIds)
  if (inputIds.length === 0) return { workflowName, sections: [] }

  const flagsFor = (id: string): NodeFlags => {
    const cls = workflow[id]?.class_type
    return {
      input: inputIdSet.has(id) || undefined,
      hidden: hidden.has(id) || undefined,
      parsed: id in parsers || undefined,
      defaulted: (cls && cls in DEFAULT_NODE_PARSERS) || undefined,
      wrapped: wrapped.has(id) || undefined,
    }
  }

  const buildForNode = (id: string, hideTitle: boolean): ParsedField[] => {
    const node = workflow[id]
    if (!node) return []
    const fields = buildNodeFields(
      id,
      node,
      mergeParser(node.class_type, parsers[id]),
      placeholders,
      hideTitle,
      compareId,
    )
    const flags = flagsFor(id)
    for (const f of fields) Object.assign(f, flags)
    return fields
  }

  const sections: ParsedSection[] = []

  for (const id of inputIds) {
    const subCfg = subs[id]

    if (subCfg) {
      const allChildren = Object.keys(workflow).filter((k) => k.startsWith(id + ':'))
      const nodesOrder = subCfg.nodesOrder
      const ordered =
        nodesOrder && nodesOrder.length
          ? nodesOrder
              .map((n) => `${id}:${n}`)
              .filter((k) => k in workflow)
              .concat(allChildren.filter((k) => !nodesOrder.includes(k.split(':')[1])))
          : allChildren

      const hideLabels = subCfg.hideNodeLabels
      const isHidden = (childId: string) =>
        hideLabels === true || (Array.isArray(hideLabels) && hideLabels.includes(childId))

      // Build all child fields (each node may contribute multiple)
      const allFields: ParsedField[] = []
      for (const childId of ordered) {
        for (const f of buildForNode(childId, isHidden(childId))) allFields.push(f)
      }

      // Gating analysis runs on visible (non-hidden) fields only.
      //  - explicit: any checkbox with hideTitle becomes a sequential gate (Denoise / Controlnet pattern)
      //  - implicit: no hideTitle gates, but exactly one checkbox in the subgraph — treat it as the gate
      //              and hoist it to the front (covers "Use Second Image" style patterns)
      const visible = allFields.filter((f) => !f.hidden)
      const explicitGates = visible.filter((f) => f.type === 'checkbox' && f.hideTitle)
      const checkboxes = visible.filter((f) => f.type === 'checkbox')
      const implicitGate =
        explicitGates.length === 0 &&
        checkboxes.length === 1 &&
        visible.length > 1 &&
        !subCfg.nodesOrder?.length
          ? checkboxes[0]
          : null

      const children: ParsedField[] = []
      if (implicitGate) {
        for (const f of allFields) {
          if (f.id === implicitGate.id) continue
          if (!f.hidden && !f.showWhen) {
            f.showWhen = [{ fieldId: implicitGate.id, equals: true }]
          }
        }
        children.push(implicitGate)
        for (const f of allFields) {
          if (f.id === implicitGate.id) continue
          children.push(f)
        }
      } else {
        let gate: string | null = null
        for (const f of allFields) {
          if (!f.hidden) {
            if (f.type === 'checkbox' && f.hideTitle) {
              gate = f.id
            } else if (gate && !f.showWhen) {
              f.showWhen = [{ fieldId: gate, equals: true }]
            }
          }
          children.push(f)
        }
      }

      sections.push({
        kind: 'category',
        id,
        label: subCfg.label ?? id,
        defaultOpen: !wrapped.has(id),
        children,
        ...flagsFor(id),
      })
      continue
    }

    // Non-subgraph: build the node's fields directly
    const nodeFields = buildForNode(id, false)
    if (!nodeFields.length) continue

    if (wrapped.has(id)) {
      const title = workflow[id]?._meta?.title ?? id
      sections.push({
        kind: 'category',
        id,
        label: title,
        defaultOpen: false,
        children: nodeFields.map((f) => ({ ...f, hideTitle: true })),
        ...flagsFor(id),
      })
    } else if (nodeFields.length === 1) {
      sections.push({ kind: 'field', field: nodeFields[0] })
    } else {
      // Multi-field top-level node — fall back to a category named by the node
      const title = workflow[id]?._meta?.title ?? id
      sections.push({
        kind: 'category',
        id,
        label: title,
        defaultOpen: true,
        children: nodeFields,
        ...flagsFor(id),
      })
    }
  }

  return { workflowName, sections }
}
