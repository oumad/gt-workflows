import { useRef, useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { AvailableNode } from './parser'

export function AddNodeButton({
  availableNodes,
  onAddNode,
}: {
  availableNodes: AvailableNode[]
  onAddNode: (nodeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const openDropdown = () => {
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setDropPos({ top: r.top, left: r.left, width: r.width })
    }
    setOpen(true)
    setSearch('')
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const filtered = availableNodes.filter(
    (n) =>
      !search ||
      n.id.toLowerCase().includes(search.toLowerCase()) ||
      n.classType.toLowerCase().includes(search.toLowerCase()) ||
      n.title.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div ref={containerRef}>
      <button
        ref={buttonRef}
        onClick={openDropdown}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: open ? 'var(--surface-2)' : 'transparent',
          border: '1px dashed var(--line)',
          borderRadius: 8,
          color: 'var(--ink-3)',
          fontSize: 13,
          fontWeight: 500,
          cursor: availableNodes.length === 0 ? 'default' : 'pointer',
          opacity: availableNodes.length === 0 ? 0.4 : 1,
        }}
        disabled={availableNodes.length === 0}
      >
        <Plus size={14} />
        Add input node
        {availableNodes.length > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              padding: '1px 7px',
              borderRadius: 999,
            }}
          >
            {availableNodes.length}
          </span>
        )}
      </button>

      {open && dropPos && (
        <div
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            transform: 'translateY(calc(-100% - 4px))',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 280,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input
              autoFocus
              placeholder="Search nodes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '5px 9px',
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                color: 'var(--ink)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', color: 'var(--ink-3)', fontSize: 12 }}>
                No nodes match
              </div>
            ) : (
              filtered.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    onAddNode(n.id)
                    setOpen(false)
                  }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderTop: '1px solid var(--line)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                    {n.title !== n.id ? n.title : n.classType}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      marginTop: 2,
                      display: 'flex',
                      gap: 5,
                      alignItems: 'center',
                    }}
                  >
                    <span className="mono">{n.id}</span>
                    <span>·</span>
                    <span>{n.classType}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
