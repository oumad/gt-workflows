import { useState, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export type DropdownItem = {
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  danger?: boolean
  /** Hide the item without removing it from the array — useful when an action
   *  is conditionally available (e.g. "Show user" only when we have an id). */
  hidden?: boolean
}

/** Portal-positioned dropdown menu that anchors to its trigger button.
 *
 *  Pattern was duplicated between `JobsTables.tsx::LiveRowMenu` and
 *  `JobsHistory.tsx::MenuCell`. Single source now. */
export function DropdownMenu({
  items,
  width = 220,
  trigger,
}: {
  items: DropdownItem[]
  width?: number
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    setRect(btnRef.current?.getBoundingClientRect() ?? null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const visible = items.filter((i) => !i.hidden)

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        className="btn btn-ghost"
        style={{ width: 26, height: 26, padding: 0, border: 0, color: 'var(--ink-3)' }}
        onClick={handleOpen}
        title="Actions"
      >
        {trigger ?? <MoreVertical size={13} />}
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              left: Math.max(8, rect.right - width),
              width,
              zIndex: 300,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
              fontSize: 12,
            }}
          >
            {visible.map((it, i) => (
              <button
                key={i}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  it.onClick()
                }}
                className="row"
                style={{
                  width: '100%',
                  padding: '7px 12px',
                  background: 'transparent',
                  border: 0,
                  fontSize: 12,
                  color: it.danger ? 'var(--bad)' : 'var(--ink)',
                  cursor: 'default',
                  gap: 8,
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {it.icon && (
                  <span
                    style={{
                      color: it.danger ? 'var(--bad)' : 'var(--ink-3)',
                      flexShrink: 0,
                      display: 'inline-flex',
                    }}
                  >
                    {it.icon}
                  </span>
                )}
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}
