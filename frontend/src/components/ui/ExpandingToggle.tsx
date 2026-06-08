import { useEffect, useRef, useState, type ReactNode } from 'react'

type Option<T extends string> = { value: T; label: ReactNode }

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  /** Always-visible content rendered before the options (e.g. an icon + label) */
  prefix?: ReactNode
  /** Milliseconds to stay expanded after the mouse leaves. Default 1000. */
  collapseDelay?: number
}

/**
 * A toggle group that collapses to its selected option by default and expands
 * on hover/focus, lingering for `collapseDelay` after the mouse leaves so the
 * user has a moment to pick a different value. Picking a value auto-collapses.
 *
 * Implementation note: all buttons are rendered at all times, but non-active
 * buttons get an `.is-collapsed` class while the group isn't expanded. The CSS
 * in global.css drives the max-width / opacity transition for a smooth slide.
 */
export function ExpandingToggle<T extends string>({
  options,
  value,
  onChange,
  prefix,
  collapseDelay = 1000,
}: Props<T>) {
  const [expanded, setExpanded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const handleEnter = () => {
    cancelTimer()
    setExpanded(true)
  }
  const handleLeave = () => {
    cancelTimer()
    timerRef.current = setTimeout(() => {
      setExpanded(false)
      timerRef.current = null
    }, collapseDelay)
  }
  useEffect(() => () => cancelTimer(), [])

  return (
    <div
      className="toggle-group toggle-group-expanding"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {prefix}
      {options.map((opt) => {
        const isActive = opt.value === value
        const isCollapsed = !expanded && !isActive
        return (
          <button
            key={opt.value}
            type="button"
            className={[isActive ? 'active' : '', isCollapsed ? 'is-collapsed' : '']
              .filter(Boolean)
              .join(' ')}
            aria-hidden={isCollapsed || undefined}
            tabIndex={isCollapsed ? -1 : undefined}
            onClick={() => {
              onChange(opt.value)
              // Snap back to the collapsed state immediately on pick so the
              // user sees their new selection settle in.
              cancelTimer()
              setExpanded(false)
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
