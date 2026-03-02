import { Minus, CheckCircle, XCircle, HelpCircle, Server, ChevronDown, ChevronUp } from 'lucide-react'
import type { ItemStatus } from './types'
import { statusClass } from './utils'

/** Status icon for a single dependency item (pending/available/missing/unknown). */
export function DependencyAuditStatusIcon({
  available,
}: { available: ItemStatus }): React.ReactElement {
  if (available === 'pending') return <Minus size={14} />
  if (available === true) return <CheckCircle size={14} />
  if (available === false) return <XCircle size={14} />
  return <HelpCircle size={14} />
}

interface DependencyAuditItemRowProps {
  name: string
  available: ItemStatus
  variant?: 'default' | 'warn'
}

/** Single row in a dependency list (icon + name). Use variant="warn" for input files not found. */
export function DependencyAuditItemRow({
  name,
  available,
  variant = 'default',
}: DependencyAuditItemRowProps): React.ReactElement {
  const useWarn = variant === 'warn'
  const className = `dep-audit-item ${useWarn ? 'warn' : statusClass(available)}`
  return (
    <div className={className}>
      <span className="dep-audit-item-icon">
        {useWarn ? <HelpCircle size={14} /> : <DependencyAuditStatusIcon available={available} />}
      </span>
      <span className="dep-audit-item-name">{name}</span>
    </div>
  )
}

interface DependencyAuditServerBlockProps {
  serverUrl: string
  collapsed: boolean
  onToggle: () => void
  showHeader: boolean
  children: React.ReactNode
}

/** Collapsible server section (header + content). */
export function DependencyAuditServerBlock({
  serverUrl,
  collapsed,
  onToggle,
  showHeader,
  children,
}: DependencyAuditServerBlockProps): React.ReactElement {
  return (
    <div className="dep-audit-server">
      {showHeader && (
        <div className="dep-audit-server-header" onClick={onToggle}>
          <Server size={14} />
          <span className="dep-audit-server-url">{serverUrl}</span>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      )}
      {!collapsed && children}
    </div>
  )
}
