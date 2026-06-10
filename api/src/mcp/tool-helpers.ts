/**
 * Shared utilities for MCP tool handlers.
 *
 * The two non-trivial ones:
 *  - `toolError` / `toolText` / `toolJson` — wrap return values into the MCP
 *    `CallToolResult` shape (content array). Lets tool handlers `return
 *    toolJson(payload)` without remembering the protocol layout.
 *  - `validateParamsShape` / `validateWorkflowShape` — pre-write sanity
 *    checks. Any write tool that touches params.json / workflow.json should
 *    call these before persisting; we throw a structured error which the
 *    caller can surface back to the AI.
 *
 * No state, no side effects beyond what their names imply. Single home for
 * stuff every tool group ends up needing.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readParams, resolveFolder } from '../services/workflows.js'
import type { ParamsJson } from '../models/workflows.js'

/* ─── Result shapes ──────────────────────────────────────────────
   The MCP CallToolResult format is `{ content: [{ type, text }] }`. For
   structured data we still serialize to text — the SDK can attach an
   outputSchema, but the actual transport payload is a content array. */

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

/** Return a structured JSON payload to the AI. The text body is the pretty-
 *  printed JSON (what the model sees); `structuredContent` mirrors it so a
 *  client with `outputSchema` validation can parse it natively. */
export function toolJson(payload: unknown): ToolResult {
  // Wrap top-level arrays/primitives in an envelope so structuredContent is
  // always an object — MCP only allows object-shaped structured content.
  const structuredContent: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : { value: payload }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent,
  }
}

/** Return plain text. Use for confirmations / short messages. */
export function toolText(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

/** Return an error response. The MCP spec says tool errors travel as a normal
 *  result with `isError: true` so the AI can read the message and adapt,
 *  rather than as a protocol-level exception. */
export function toolError(message: string, details?: Record<string, unknown>): ToolResult {
  const body = details ? { error: message, ...details } : { error: message }
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  }
}

/* ─── Shape validation ───────────────────────────────────────────
   "Shape" not "schema": these are pre-write structural checks, not a full
   spec. The goal is to refuse obviously-broken writes (root not an object,
   missing required keys for the file type) before they hit disk. Full
   semantic validation belongs in a dedicated `validate_workflow` tool. */

export type ValidationIssue = {
  level: 'error' | 'warning'
  path: string
  message: string
}

export function validateParamsShape(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ level: 'error', path: '$', message: 'params.json root must be a JSON object' })
    return issues
  }
  const obj = value as Record<string, unknown>

  // Soft expectations — every params.json we've seen has these, but they
  // aren't strictly required by the disk-side reader. Emit warnings so the
  // AI can self-correct without a hard reject.
  if (obj.parser !== undefined && typeof obj.parser !== 'string') {
    issues.push({ level: 'error', path: 'parser', message: 'parser must be a string' })
  }
  if (obj.tags !== undefined && !Array.isArray(obj.tags)) {
    issues.push({ level: 'error', path: 'tags', message: 'tags must be an array' })
  }
  if (obj.timeout !== undefined && typeof obj.timeout !== 'number') {
    issues.push({ level: 'error', path: 'timeout', message: 'timeout must be a number (seconds)' })
  }
  // Workflow-level metadata shape — added when MCP write tools landed.
  for (const k of ['label', 'description', 'category'] as const) {
    if (obj[k] !== undefined && typeof obj[k] !== 'string') {
      issues.push({ level: 'error', path: k, message: `${k} must be a string` })
    }
  }
  if (obj.order !== undefined && typeof obj.order !== 'number') {
    issues.push({ level: 'error', path: 'order', message: 'order must be a number' })
  }
  if (obj.servers !== undefined && !Array.isArray(obj.servers)) {
    issues.push({ level: 'error', path: 'servers', message: 'servers must be an array of strings' })
  }
  if (obj.iconBadge !== undefined) {
    if (
      obj.iconBadge === null ||
      typeof obj.iconBadge !== 'object' ||
      Array.isArray(obj.iconBadge)
    ) {
      issues.push({ level: 'error', path: 'iconBadge', message: 'iconBadge must be an object' })
    } else {
      const ib = obj.iconBadge as Record<string, unknown>
      for (const k of ['content', 'backgroundColor', 'color'] as const) {
        if (ib[k] !== undefined && typeof ib[k] !== 'string') {
          issues.push({
            level: 'error',
            path: `iconBadge.${k}`,
            message: `iconBadge.${k} must be a string`,
          })
        }
      }
    }
  }
  if (obj.comfyui_config !== undefined) {
    if (
      obj.comfyui_config === null ||
      typeof obj.comfyui_config !== 'object' ||
      Array.isArray(obj.comfyui_config)
    ) {
      issues.push({
        level: 'error',
        path: 'comfyui_config',
        message: 'comfyui_config must be an object',
      })
    }
  }
  // Imagine block — same defensive shape check as the others. The MCP
  // imagine tools enforce stricter rules (mainMediaNode required fields,
  // type enum); this is just the structural guard for any other writer.
  if (obj.imagine !== undefined) {
    if (obj.imagine === null || typeof obj.imagine !== 'object' || Array.isArray(obj.imagine)) {
      issues.push({ level: 'error', path: 'imagine', message: 'imagine must be an object' })
    } else {
      const im = obj.imagine as Record<string, unknown>
      if (im.mainMediaNode !== undefined) {
        if (
          im.mainMediaNode === null ||
          typeof im.mainMediaNode !== 'object' ||
          Array.isArray(im.mainMediaNode)
        ) {
          issues.push({
            level: 'error',
            path: 'imagine.mainMediaNode',
            message: 'mainMediaNode must be an object { id, fieldName, type }',
          })
        } else {
          const mn = im.mainMediaNode as Record<string, unknown>
          if (typeof mn.id !== 'string' || mn.id.length === 0) {
            issues.push({
              level: 'error',
              path: 'imagine.mainMediaNode.id',
              message: 'id must be a non-empty string (the ComfyUI node id)',
            })
          }
          if (typeof mn.fieldName !== 'string' || mn.fieldName.length === 0) {
            issues.push({
              level: 'error',
              path: 'imagine.mainMediaNode.fieldName',
              message: 'fieldName must be a non-empty string (an input on the node)',
            })
          }
          if (
            typeof mn.type !== 'string' ||
            !['image', 'video', '3d'].includes(mn.type.toLowerCase())
          ) {
            issues.push({
              level: 'error',
              path: 'imagine.mainMediaNode.type',
              message: 'type must be "image", "video", or "3d"',
            })
          }
        }
      }
    }
  }
  return issues
}

export function validateWorkflowShape(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({
      level: 'error',
      path: '$',
      message: 'workflow.json root must be a JSON object keyed by node id',
    })
    return issues
  }
  const obj = value as Record<string, unknown>
  for (const [nodeId, node] of Object.entries(obj)) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      issues.push({
        level: 'error',
        path: nodeId,
        message: 'Each node must be an object',
      })
      continue
    }
    const n = node as Record<string, unknown>
    if (typeof n.class_type !== 'string' || n.class_type.length === 0) {
      issues.push({
        level: 'error',
        path: `${nodeId}.class_type`,
        message: 'class_type is required and must be a non-empty string',
      })
    }
    if (n.inputs !== undefined) {
      if (n.inputs === null || typeof n.inputs !== 'object' || Array.isArray(n.inputs)) {
        issues.push({
          level: 'error',
          path: `${nodeId}.inputs`,
          message: 'inputs must be an object',
        })
      }
    }
  }
  return issues
}

/** Best-effort `JSON.parse` with a friendly error. Returns parsed value or
 *  throws a single-line Error message for the AI to read. */
export function parseJsonStrict(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${label} is not valid JSON: ${msg}`)
  }
}

/* ─── Snapshot params reader (for diff_params) ───────────────────
   Reads params.json from a specific snapshot under .history/<id>/<snapId>/.
   Lives here rather than in services/workflows because it's only used by an
   MCP tool — keeping it local keeps the workflows service focused. */

/** Read and JSON-parse a workflow's `workflow.json` (or whatever
 *  `params.workflowFile` / `comfyui_config.workflow` names). Returns null
 *  for missing files or parse errors — callers decide whether that's a
 *  hard failure or a soft "skip cross-reference checks" condition. */
export function readWorkflowJsonForId(workflowId: string): Record<string, unknown> | null {
  const { folderAbs } = resolveFolder(workflowId)
  const params = readParams(folderAbs)
  const wfFile = params.workflowFile ?? params.comfyui_config?.workflow ?? 'workflow.json'
  const abs = join(folderAbs, wfFile)
  if (!existsSync(abs)) return null
  try {
    return JSON.parse(readFileSync(abs, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function readSnapshotParams(historyRootAbs: string, snapshotId: string): ParamsJson {
  const snapAbs = join(historyRootAbs, snapshotId, 'params.json')
  if (!existsSync(snapAbs)) {
    throw new Error(`Snapshot ${snapshotId} has no params.json`)
  }
  try {
    return JSON.parse(readFileSync(snapAbs, 'utf-8')) as ParamsJson
  } catch (err) {
    throw new Error(
      `Failed to read snapshot params.json: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/* ─── Diffing ────────────────────────────────────────────────────
   Lightweight recursive object diff. For each path returns one of:
     - 'added'    : present in current, absent in base
     - 'removed'  : absent in current, present in base
     - 'changed'  : present in both, value differs (primitives compared by ===,
                    arrays by JSON.stringify, objects recursed)
   Used by diff_params to give the AI a concise change list rather than a
   full text diff (which is hard for the model to summarize). */

export type DiffEntry = {
  path: string
  kind: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}

export function diffObjects(base: unknown, current: unknown, prefix = '$'): DiffEntry[] {
  if (base === current) return []
  const sameType = typeof base === typeof current && Array.isArray(base) === Array.isArray(current)
  if (!sameType || base === null || current === null) {
    return [{ path: prefix, kind: 'changed', before: base, after: current }]
  }
  if (typeof base !== 'object' || base === null) {
    return base === current ? [] : [{ path: prefix, kind: 'changed', before: base, after: current }]
  }
  // Arrays: stringify-compare for simplicity. Per-element diff isn't useful
  // for params.json (mostly object/scalar fields, not big arrays).
  if (Array.isArray(base)) {
    return JSON.stringify(base) === JSON.stringify(current)
      ? []
      : [{ path: prefix, kind: 'changed', before: base, after: current }]
  }
  const out: DiffEntry[] = []
  const baseObj = base as Record<string, unknown>
  const curObj = current as Record<string, unknown>
  const keys = new Set([...Object.keys(baseObj), ...Object.keys(curObj)])
  for (const k of keys) {
    const path = `${prefix}.${k}`
    const inBase = k in baseObj
    const inCur = k in curObj
    if (inBase && !inCur) out.push({ path, kind: 'removed', before: baseObj[k] })
    else if (!inBase && inCur) out.push({ path, kind: 'added', after: curObj[k] })
    else out.push(...diffObjects(baseObj[k], curObj[k], path))
  }
  return out
}
