/**
 * Read-patch-validate-write helper for params.json edits made through MCP.
 *
 * This is the single chokepoint every node-config write tool uses. The flow:
 *
 *   1. Resolve workflow folder + read params.json from disk.
 *   2. Run the caller's `mutator` against a structurally-cloned copy. The
 *      mutator returns the new params (must NOT mutate the input; clone-first
 *      is enforced by the helper).
 *   3. Validate the resulting shape via `validateParamsShape`. If any error-
 *      level issue is present, abort BEFORE touching disk.
 *   4. Diff against the pre-patch params so the tool result can show the
 *      model exactly what changed (without dumping the full file back).
 *   5. Persist via `writeParamsFile`, which internally calls
 *      `snapshotWorkflow` — so every successful patch lands a restore point
 *      in .history/<id>/ before the new bytes are written.
 *
 * The mutator pattern means tool authors can't accidentally smash the whole
 * file: every patch is a function of the current state, and the validation
 * gate refuses obviously-broken results before they hit disk.
 */
import { writeParamsFile } from '../services/workflows.js'
import { resolveFolder, readParams } from '../services/workflows.js'
import {
  validateParamsShape,
  diffObjects,
  type ValidationIssue,
  type DiffEntry,
} from './tool-helpers.js'

/** Mutator signature — receives a deep clone of the current params and must
 *  return the new params object. Don't mutate the argument; do `return
 *  { ...p, comfyui_config: { ...p.comfyui_config, ... } }` style updates so
 *  every level is a fresh object. The helper structurally clones before
 *  calling, so even an accidental mutation can't corrupt the on-disk state
 *  if the mutator throws halfway through — but treating the input as
 *  read-only keeps the patch reviewable. */
export type ParamsMutator = (params: Record<string, unknown>) => Record<string, unknown>

export class ParamsValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(
      `params.json failed validation: ${issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    )
    this.name = 'ParamsValidationError'
  }
}

export type PatchResult = {
  workflowId: string
  changes: DiffEntry[]
  /** New params.json after the patch — surfaced so the caller can let the AI
   *  inspect the persisted state without a follow-up read_params call. */
  params: Record<string, unknown>
}

export function applyParamsPatch(
  workflowId: string,
  mutator: ParamsMutator,
): PatchResult {
  const { folderAbs } = resolveFolder(workflowId)
  const before = readParams(folderAbs) as Record<string, unknown>
  // Deep clone via JSON round-trip — params.json is JSON anyway, so this is
  // safe and cheap, and guarantees the mutator can't sneak a reference back
  // into the on-disk state if it deviates from the immutable pattern.
  const draft = JSON.parse(JSON.stringify(before)) as Record<string, unknown>
  const after = mutator(draft)

  const issues = validateParamsShape(after)
  const blocking = issues.filter((i) => i.level === 'error')
  if (blocking.length > 0) {
    throw new ParamsValidationError(blocking)
  }

  // writeParamsFile internally calls snapshotWorkflow(id, folderAbs, 'params'),
  // so we get an automatic restore point in .history/<id>/ before this write.
  writeParamsFile(workflowId, after)

  return {
    workflowId,
    changes: diffObjects(before, after),
    params: after,
  }
}

/* ─── Common path-helpers ─────────────────────────────────────────
   Every node-config tool needs the same prefix-builders for the deeply-nested
   shape under `comfyui_config`. Centralising them keeps the tool handlers
   focused on their actual diff (which key, which value) instead of the
   path-walking. All helpers are pure — they take a params draft and return
   a new params draft. */

type Params = Record<string, unknown>
type ComfyConfig = Record<string, unknown>

/** Ensure `params.comfyui_config` exists. Returns a draft where `comfyui_config`
 *  is guaranteed to be an object — never mutates the input. */
export function withComfyConfig(
  params: Params,
  mutator: (cc: ComfyConfig) => ComfyConfig,
): Params {
  const cc = (params.comfyui_config ?? {}) as ComfyConfig
  const next = mutator({ ...cc })
  return { ...params, comfyui_config: next }
}

/** Ensure `comfyui_config.node_parsers.input_nodes[nodeId]` exists. The
 *  mutator receives the current per-node ParserCfg (or an empty object if
 *  the node has no entry yet) and returns the new one — or `null` to remove
 *  the entry entirely. */
export function withNodeParser(
  params: Params,
  nodeId: string,
  mutator: (entry: Record<string, unknown>) => Record<string, unknown> | null,
): Params {
  return withComfyConfig(params, (cc) => {
    const np = (cc.node_parsers ?? {}) as Record<string, unknown>
    const inputNodes = (np.input_nodes ?? {}) as Record<string, Record<string, unknown>>
    const current = (inputNodes[nodeId] ?? {}) as Record<string, unknown>
    const next = mutator({ ...current })
    const updatedInputNodes = { ...inputNodes }
    if (next === null) delete updatedInputNodes[nodeId]
    else updatedInputNodes[nodeId] = next
    // Collapse empty wrappers so we don't leave `node_parsers: { input_nodes: {} }`
    // littering params.json after a clean-up.
    const updatedNp =
      Object.keys(updatedInputNodes).length > 0
        ? { ...np, input_nodes: updatedInputNodes }
        : Object.fromEntries(Object.entries(np).filter(([k]) => k !== 'input_nodes'))
    return Object.keys(updatedNp).length > 0
      ? { ...cc, node_parsers: updatedNp }
      : Object.fromEntries(Object.entries(cc).filter(([k]) => k !== 'node_parsers'))
  })
}

/** Drill into the top-level `powerflowConfig` (sibling to `comfyui_config`,
 *  NOT a child). Mutator can return `null` to remove the powerflowConfig
 *  block entirely, or the new config object. */
export function withPowerflow(
  params: Params,
  mutator: (pf: Record<string, unknown>) => Record<string, unknown> | null,
): Params {
  const pf = (params.powerflowConfig ?? {}) as Record<string, unknown>
  const next = mutator({ ...pf })
  if (next === null) {
    return Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'powerflowConfig'))
  }
  return { ...params, powerflowConfig: next }
}

/** Toggle `nodeId` membership in a string-array field on comfyui_config
 *  (`hiddenNodeIds` or `wrappedNodeIds`). `include=true` adds, `false` removes.
 *  Returns the params draft. Idempotent — adding twice or removing absent
 *  values is a no-op. */
export function toggleInComfyArray(
  params: Params,
  arrayKey: 'hiddenNodeIds' | 'wrappedNodeIds',
  nodeId: string,
  include: boolean,
): Params {
  return withComfyConfig(params, (cc) => {
    const current = Array.isArray(cc[arrayKey]) ? (cc[arrayKey] as string[]) : []
    const has = current.includes(nodeId)
    if (include === has) return cc // no change
    const next = include ? [...current, nodeId] : current.filter((x) => x !== nodeId)
    if (next.length === 0) {
      return Object.fromEntries(Object.entries(cc).filter(([k]) => k !== arrayKey))
    }
    return { ...cc, [arrayKey]: next }
  })
}
