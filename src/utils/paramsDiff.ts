/**
 * Utilities for diffing two objects (e.g. workflow params) and formatting values for display.
 * Used by SaveConfirmationModal and ResetConfirmationModal.
 */

export type ParamsChangeType = 'added' | 'removed' | 'modified'

export interface ParamsChangeItem {
  path: string
  oldValue: unknown
  newValue: unknown
  type: ParamsChangeType
}

/**
 * Recursively diff two values and return a list of changes (path, oldValue, newValue, type).
 */
export function detectParamsChanges(
  oldVal: unknown,
  newVal: unknown,
  path = ''
): ParamsChangeItem[] {
  const changes: ParamsChangeItem[] = []
  const pathLabel = path || 'root'

  if (oldVal === null || oldVal === undefined) {
    if (newVal !== null && newVal !== undefined) {
      changes.push({
        path: pathLabel,
        oldValue: null,
        newValue: newVal,
        type: 'added',
      })
    }
    return changes
  }

  if (newVal === null || newVal === undefined) {
    changes.push({
      path: pathLabel,
      oldValue: oldVal,
      newValue: null,
      type: 'removed',
    })
    return changes
  }

  if (Array.isArray(oldVal) || Array.isArray(newVal)) {
    const oldArr = Array.isArray(oldVal) ? oldVal : []
    const newArr = Array.isArray(newVal) ? newVal : []
    if (JSON.stringify(oldArr) !== JSON.stringify(newArr)) {
      changes.push({
        path: pathLabel,
        oldValue: oldArr,
        newValue: newArr,
        type: 'modified',
      })
    }
    return changes
  }

  if (typeof oldVal === 'object' && typeof newVal === 'object') {
    const allKeys = new Set([
      ...Object.keys(oldVal as Record<string, unknown>),
      ...Object.keys(newVal as Record<string, unknown>),
    ])

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key
      const oldChild = (oldVal as Record<string, unknown>)[key]
      const newChild = (newVal as Record<string, unknown>)[key]

      if (!(key in (oldVal as Record<string, unknown>))) {
        changes.push({
          path: newPath,
          oldValue: undefined,
          newValue: newChild,
          type: 'added',
        })
      } else if (!(key in (newVal as Record<string, unknown>))) {
        changes.push({
          path: newPath,
          oldValue: oldChild,
          newValue: undefined,
          type: 'removed',
        })
      } else if (
        typeof oldChild === 'object' &&
        typeof newChild === 'object' &&
        oldChild !== null &&
        newChild !== null &&
        !Array.isArray(oldChild) &&
        !Array.isArray(newChild)
      ) {
        changes.push(...detectParamsChanges(oldChild, newChild, newPath))
      } else if (JSON.stringify(oldChild) !== JSON.stringify(newChild)) {
        changes.push({
          path: newPath,
          oldValue: oldChild,
          newValue: newChild,
          type: 'modified',
        })
      }
    }
    return changes
  }

  if (oldVal !== newVal) {
    changes.push({
      path: pathLabel,
      oldValue: oldVal,
      newValue: newVal,
      type: 'modified',
    })
  }

  return changes
}

/**
 * Format a value for display in diff views (e.g. in <pre>).
 */
export function formatValueForDisplay(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}
