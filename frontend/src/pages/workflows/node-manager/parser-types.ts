/* Types for the ComfyUI workflow parser. */

export type FieldValue = string | number | boolean

export type FieldType =
  | 'textField'
  | 'textArea'
  | 'number'
  | 'slider'
  | 'checkbox'
  | 'select'
  | 'uploadImage'
  | 'uploadVideo'
  | 'uploadAudio'
  | 'file'
  | 'folder'
  | 'unknown'

export interface SelectOption {
  value: string
  label?: string
  image?: string
  dynamic?: boolean
}

export interface AIConfig {
  refine?: { preset?: string }
  describeImage?: { systemPrompt?: string }
}

export interface NodeFlags {
  input?: boolean
  hidden?: boolean
  parsed?: boolean // has a custom parser entry in node_parsers.input_nodes
  defaulted?: boolean // uses one of the built-in DEFAULT_NODE_PARSERS
  wrapped?: boolean
}

export interface ShowWhenRule {
  fieldId: string
  equals: FieldValue
  /** Inverted rules behave like `hiddenWhen` in the underlying params.json
   *  schema — when the rule matches, the field is hidden instead of shown. */
  inverted?: boolean
}

export interface ParsedField extends NodeFlags {
  id: string // `${nodeId}#${fieldName}`
  title: string
  hideTitle: boolean
  type: FieldType
  default: FieldValue
  required?: boolean
  min?: number
  max?: number
  step?: number
  options?: SelectOption[]
  accept?: string[]
  imageSize?: string
  drawMask?: boolean
  compare?: boolean
  ai?: AIConfig
  /** Conditional-visibility rules. The field is visible when **any** rule
   *  with `inverted=false` matches AND **no** rule with `inverted=true`
   *  matches — mirrors gt-plugins' auto-node logic. Stored as an array so
   *  multiple gates (e.g. "show when modeA OR modeB, hide when locked")
   *  survive parsing instead of being collapsed to the first one. */
  showWhen?: ShowWhenRule[]
  /** Raw field-level connectTo from params.json's parser config — a
   *  different schema ({whenValue, value}) that auto-sets this field's
   *  value rather than gating visibility. Carried through parsing so the
   *  block survives round-trip on save. Treated as opaque by the editor;
   *  surfaced read-only via a badge so the user knows it exists. */
  fieldConnectTo?: FieldLevelConnectTo
}

export type ParsedSection =
  | { kind: 'field'; field: ParsedField }
  | (NodeFlags & {
      kind: 'category'
      id: string
      label: string
      defaultOpen: boolean
      children: ParsedField[]
    })

export interface ParsedModel {
  workflowName: string
  sections: ParsedSection[]
}

export interface AvailableNode {
  id: string
  classType: string
  title: string
}

/* ── Internal types ──────────────────────────────────────────── */

/** Field-level connectTo — auto-sets the field's value based on another
 *  field's value. Schema differs from the node-level ConnectTo on purpose:
 *  conditions list `{whenValue, value}` pairs (value to set when matched)
 *  rather than `{displayedWhen, hiddenWhen}` (visibility booleans). Coffee-
 *  maker doesn't currently render this in the preview — it's parsed only
 *  to preserve it on round-trip. */
export interface FieldLevelConnectTo {
  nodeId: string
  inputField: string
  conditions: Array<{ whenValue?: FieldValue; value?: FieldValue }>
}

export type FieldConfig = {
  type: string
  label?: string
  default?: FieldValue
  required?: boolean
  min?: number | string
  max?: number | string
  step?: number | string
  options?: unknown[]
  accept?: string | string[]
  imageSize?: string
  drawMaskEnable?: boolean
  maskNode?: { nodeId?: string }
  aiRefine?: { enable?: boolean; preset?: string }
  aiDescribeImage?: { enable?: boolean; systemPrompt?: string }
  /** Field-level auto-set connection — see FieldLevelConnectTo. Distinct
   *  from `ParserCfg.connectTo` (which is node-level and gates visibility). */
  connectTo?: FieldLevelConnectTo
}

export type ParserCfg = {
  inputs?: Record<string, FieldConfig | false>
  connectTo?: ConnectTo
}

export type RawNode = {
  inputs?: Record<string, unknown>
  class_type: string
  _meta?: { title?: string }
}
export type RawWorkflow = Record<string, RawNode>

export interface SubgraphCfg {
  label?: string
  hideNodeLabels?: boolean | string[]
  nodesOrder?: string[]
}

export interface ConnectTo {
  nodeId: string
  inputField: string
  conditions: Array<{ hiddenWhen?: FieldValue; displayedWhen?: FieldValue }>
}

export interface ComfyConfig {
  hiddenNodeIds?: string[]
  wrappedNodeIds?: string[]
  subgraphs?: Record<string, SubgraphCfg>
  node_parsers?: { input_nodes?: Record<string, ParserCfg> }
  placeholders?: Record<string, string[]>
  outputComparator?: { inputNodeId?: string; defaultEnabled?: boolean }
}

/* ── PowerFlow config (top-level on params.json) ──────────────
 * Drives the optional PowerFlow integration. Each connection points at a
 * node and lists its tracked fields. A field can be a bare string (just the
 * field name) or a richer object that overrides the display label or type.
 *
 *   "powerflowConfig": {
 *     "enabled": true,
 *     "exclusive": true,
 *     "availableConnections": {
 *       "inputs":  [{ "nodeId": "4", "fields": ["image", { "name": "prompt", "label": "Text Prompt", "type": "text" }] }],
 *       "outputs": [{ "nodeId": "8", "fields": ["output_image"] }]
 *     }
 *   }
 *
 * The shape is read straight from params.json — backend doesn't validate it.
 * Persisted as part of `RawParams` (NOT under comfyui_config). */
export type PowerflowFieldSpec = string | { name: string; label?: string; type?: string }

export interface PowerflowNodeSpec {
  nodeId: string
  fields: PowerflowFieldSpec[]
}

export interface PowerflowConfig {
  enabled?: boolean
  exclusive?: boolean
  availableConnections?: {
    inputs?: PowerflowNodeSpec[]
    outputs?: PowerflowNodeSpec[]
  }
}

export interface RawParams {
  comfyui_config?: ComfyConfig
  powerflowConfig?: PowerflowConfig
}
