import { Fragment } from 'react'
import { Server, ChevronRight } from 'lucide-react'

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
    <section className="dashboard-servers-panel">
      <h2 className="dashboard-servers-panel-title">
        <Server size={18} /> Servers
      </h2>
      <div className="dashboard-servers-list">
        {serverUsage.map((item) => {
          const isExpanded = expandedServers.has(item.server)
          const wfs = serverWorkflowsMap.get(item.server) ?? []
          const maxWf = wfs.length ? Math.max(...wfs.map((w) => w.count)) : 1
          return (
            <Fragment key={item.server}>
              <div className="dashboard-server-row">
                <span className="dashboard-server-name" title={item.server}>{item.server}</span>
                <div className="dashboard-server-bar-wrap">
                  <div className="dashboard-server-bar" style={{ width: `${(item.count / maxServer) * 100}%` }} />
                </div>
                <span className="dashboard-server-count">{item.count}</span>
                {wfs.length > 0 && (
                  <button
                    type="button"
                    className={`dashboard-server-detail-btn${isExpanded ? ' open' : ''}`}
                    onClick={() => onToggleServer(item.server)}
                    aria-expanded={isExpanded}
                    title={isExpanded ? 'Hide workflow breakdown' : 'Show workflow breakdown'}
                  >
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
              {isExpanded && wfs.length > 0 && (
                <div className="dashboard-server-wf-list">
                  {wfs.map((wf) => (
                    <div key={wf.name} className="dashboard-server-wf-row">
                      <span className="dashboard-server-name dashboard-server-wf-name" title={wf.name}>{wf.name}</span>
                      <div className="dashboard-server-bar-wrap">
                        <div className="dashboard-server-bar dashboard-server-wf-bar" style={{ width: `${(wf.count / maxWf) * 100}%` }} />
                      </div>
                      <span className="dashboard-server-count">{wf.count}</span>
                      <span />
                    </div>
                  ))}
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
