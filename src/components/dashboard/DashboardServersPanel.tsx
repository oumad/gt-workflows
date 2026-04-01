import { Fragment } from 'react'
import { ChevronRight, Server } from 'lucide-react'

interface ServerUsageItem {
  server: string
  count: number
}

interface DashboardServersPanelProps {
  serverUsage: ServerUsageItem[]
  serverWorkflowsMap: Map<string, { name: string; count: number }[]>
  maxServer: number
  expandedServers: Set<string>
  onToggleServer: (server: string) => void
}

export function DashboardServersPanel({
  serverUsage, serverWorkflowsMap, maxServer, expandedServers, onToggleServer,
}: DashboardServersPanelProps) {
  if (serverUsage.length === 0) return null

  return (
    <div className="bg-primary border border-default rounded-[10px] px-[1.15rem] pt-4 pb-3 flex flex-col gap-[0.35rem] min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.06em] text-muted mb-[0.1rem]">
        <Server size={13} className="text-semantic-success shrink-0" />
        <span>Servers</span>
        <span className="inline-flex items-center justify-center min-w-[1.4em] px-[0.35em] py-[0.05em] rounded-full text-sm font-bold bg-[rgba(45,58,74,0.6)] text-muted normal-case tracking-normal">
          {serverUsage.length}
        </span>
      </div>

      {/* Server list */}
      <div className="flex flex-col gap-0.5 overflow-y-auto flex-1 px-2 pb-2">
        {serverUsage.map((item) => {
          const isExpanded = expandedServers.has(item.server)
          const wfs = serverWorkflowsMap.get(item.server) ?? []
          const maxWf = wfs.length ? Math.max(...wfs.map((w) => w.count)) : 1
          const barPct = (item.count / maxServer) * 100
          const hasBreakdown = wfs.length > 0
          return (
            <Fragment key={item.server}>
              <div
                className={`grid grid-cols-[auto_1fr_auto] grid-rows-[auto_auto] gap-x-2 items-center px-2 py-[0.4rem] rounded-md transition-colors ${isExpanded ? 'bg-[rgba(45,58,74,0.25)]' : ''} ${hasBreakdown ? 'cursor-pointer hover:bg-[rgba(45,58,74,0.4)]' : ''}`}
                onClick={hasBreakdown ? () => onToggleServer(item.server) : undefined}
                role={hasBreakdown ? 'button' : undefined}
                aria-expanded={hasBreakdown ? isExpanded : undefined}
                tabIndex={hasBreakdown ? 0 : undefined}
                onKeyDown={hasBreakdown ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleServer(item.server) } } : undefined}
              >
                {hasBreakdown && (
                  <ChevronRight
                    size={13}
                    className={`row-start-1 text-muted shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-accent-light' : ''}`}
                  />
                )}
                <span className={`row-start-1 text-sm text-primary overflow-hidden text-ellipsis whitespace-nowrap ${!hasBreakdown ? 'col-start-2' : ''}`} title={item.server}>
                  {item.server}
                </span>
                <span className="row-start-1 text-sm tabular-nums text-muted text-right">{item.count}</span>
                <div className="col-span-full row-start-2 h-1 rounded-sm bg-[rgba(45,58,74,0.4)] overflow-hidden mt-[0.2rem]">
                  <div
                    className="h-full rounded-sm transition-[width] duration-300"
                    style={{ width: `${barPct}%`, background: 'linear-gradient(90deg,#2f855a,#4db896)' }}
                  />
                </div>
              </div>
              {isExpanded && wfs.length > 0 && (
                <div className="flex flex-col gap-[0.2rem] pl-[1.75rem] pr-2 py-[0.25rem] pb-[0.5rem] border-l-2 border-semantic-success/20 ml-[0.85rem] mb-[0.25rem]">
                  {wfs.map((wf) => (
                    <div key={wf.name} className="grid grid-cols-[1fr_auto] gap-1 items-center text-sm">
                      <span className="text-muted overflow-hidden text-ellipsis whitespace-nowrap" title={wf.name}>{wf.name}</span>
                      <span className="tabular-nums text-muted text-sm text-right">{wf.count}</span>
                      <div className="col-span-full h-[3px] rounded-sm bg-[rgba(45,58,74,0.4)] overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-[width] duration-300"
                          style={{ width: `${(wf.count / maxWf) * 100}%`, background: 'linear-gradient(90deg,#b45309,#f59e0b)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
