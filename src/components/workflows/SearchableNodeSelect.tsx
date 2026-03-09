import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'

interface NodeOption {
  id: string
  title: string
  classType: string
}

interface SearchableNodeSelectProps {
  value: string
  onChange: (nodeId: string) => void
  availableNodes: NodeOption[]
  currentNodeId: string
  placeholder?: string
}

export function SearchableNodeSelect({
  value,
  onChange,
  availableNodes,
  currentNodeId,
  placeholder = 'Select a node...',
}: SearchableNodeSelectProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [filteredNodes, setFilteredNodes] = useState(availableNodes)

  useEffect(() => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      setFilteredNodes(
        availableNodes.filter(node =>
          node.id.toLowerCase().includes(term) ||
          node.title.toLowerCase().includes(term) ||
          node.classType.toLowerCase().includes(term)
        )
      )
    } else {
      setFilteredNodes(availableNodes)
    }
  }, [searchTerm, availableNodes])

  const selectedNode = availableNodes.find(n => n.id === value)

  return (
    <div className="searchable-node-select" style={{ position: 'relative' }}>
      <div
        className="config-input"
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', position: 'relative' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Search size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          type="text"
          value={isOpen ? searchTerm : (selectedNode ? `${selectedNode.id}: ${selectedNode.title}` : value || '')}
          onChange={(e) => { setSearchTerm(e.target.value); if (!isOpen) setIsOpen(true) }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, cursor: 'pointer', color: 'var(--text-primary)', caretColor: 'var(--text-primary)' }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8em' }}>{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && (
        <>
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', marginTop: '4px', maxHeight: '300px', overflowY: 'auto', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            {filteredNodes.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>No nodes found</div>
            ) : (
              filteredNodes
                .filter(node => node.id !== currentNodeId)
                .map(node => (
                  <div
                    key={node.id}
                    onClick={() => { onChange(node.id); setIsOpen(false); setSearchTerm('') }}
                    style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', backgroundColor: value === node.id ? 'var(--bg-secondary)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '4px' }}
                    onMouseEnter={(e) => { if (value !== node.id) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)' }}
                    onMouseLeave={(e) => { if (value !== node.id) e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <code style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{node.id}</code>
                      {value === node.id && <span style={{ color: 'var(--accent)', fontSize: '0.8em' }}>✓</span>}
                    </div>
                    <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>{node.title}</div>
                    <div style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>{node.classType}</div>
                  </div>
                ))
            )}
          </div>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
            onClick={() => { setIsOpen(false); setSearchTerm('') }}
          />
        </>
      )}
    </div>
  )
}
