/**
 * jobDataUtils.ts
 *
 * Shared helpers for parsing BullMQ job hash fields into typed values.
 * Used by both the sync service (batch Redis → Postgres) and the live
 * reader (real-time Redis → API response).
 */

/** Parse the 'data' field of a BullMQ job hash. */
export function parseJobData(h: Record<string, string>): Record<string, unknown> {
  try {
    return JSON.parse(h['data'] ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Walk a dot-separated path (e.g. "config.comfyui_config.serverUrl") in a
 * nested object, trying each key in order until a non-empty string is found.
 */
export function str(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    let curr: unknown = data
    for (const part of k.split('.')) {
      if (typeof curr !== 'object' || curr === null) {
        curr = undefined
        break
      }
      curr = (curr as Record<string, unknown>)[part]
    }
    if (typeof curr === 'string' && curr) return curr
  }
  return ''
}

/** Recursively search for a key anywhere in a nested object (last-resort fallback). */
function deepFind(obj: unknown, ...keys: string[]): string {
  if (typeof obj !== 'object' || obj === null) return ''
  const o = obj as Record<string, unknown>
  for (const k of keys) {
    if (typeof o[k] === 'string' && o[k].length > 0) return o[k]
  }
  for (const v of Object.values(o)) {
    const r = deepFind(v, ...keys)
    if (r) return r
  }
  return ''
}

/** Extract the workflow name from a WF job's data payload. */
export function extractWfName(data: Record<string, unknown>): string {
  return str(data, 'workflow.name', 'workflowName', 'workflow')
}

/** Extract the server URL from a WF job's data payload (tries multiple path formats). */
export function extractWfServerUrl(data: Record<string, unknown>): string {
  return (
    str(
      data,
      'workflow.config.comfyui_config.serverUrl',
      'workflow.config.comfyui_config.serverURL',
      'workflow.config.comfyUIConfig.serverUrl',
      'workflow.config.comfyUIConfig.serverURL',
      'workflow.config.comfyUiConfig.serverUrl',
      'workflow.config.comfyUiConfig.serverURL',
      'config.comfyui_config.serverUrl',
      'config.comfyui_config.serverURL',
      'config.comfyUIConfig.serverUrl',
      'config.comfyUIConfig.serverURL',
      'serverUrl',
      'serverURL',
      'server',
    ) || deepFind(data, 'serverUrl', 'serverURL')
  )
}

/** Extract the server URL from a LoRA job's data payload. */
export function extractLoraServerUrl(data: Record<string, unknown>): string {
  return (
    str(data, 'aiToolkitServerUrl', 'serverUrl', 'serverURL', 'server') ||
    deepFind(data, 'aiToolkitServerUrl', 'serverURL', 'serverUrl')
  )
}

/** Extract the user's display name from a job's executionContext. */
export function extractUserName(data: Record<string, unknown>): string {
  return str(data, 'executionContext.context.user.name', 'executionContext.user.name')
}

/** Extract the user's external id (MongoDB ObjectId from gt-workflows) from a
 *  job's executionContext. This is what `gt_users.external_id` is keyed on, so
 *  it lets the live feed resolve a job back to its gt_users row. */
export function extractUserExternalId(data: Record<string, unknown>): string {
  return str(
    data,
    'executionContext.context.user.id',
    'executionContext.context.user._id',
    'executionContext.user.id',
    'executionContext.user._id',
  )
}
