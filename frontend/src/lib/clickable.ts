import type { KeyboardEvent } from 'react'

/** Button-like props (role, focus, Enter/Space activation) for a clickable
 *  <div>; `{}` when there's no handler so the element stays inert. */
export function clickable(onClick?: () => void) {
  if (!onClick) return {}
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    },
  }
}
