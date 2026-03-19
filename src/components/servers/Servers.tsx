import { Save, Server, Plus, X, ListPlus, Check, Activity, Search } from 'lucide-react'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
import ServerWorkflowsModal from '@/components/modals/ServerWorkflowsModal'
import { ServerCard } from './ServerCard'
import { useServers } from './useServers'
import type { StatusFilter } from './useServers'
import './Servers.css'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  healthy: 'Healthy',
  unhealthy: 'Unhealthy',
  unchecked: 'Unchecked',
}

export function Servers() {
  const s = useServers()

  return (
    <div className="servers-page">
      <header className="servers-header">
        <div className="servers-header-title">
          <h1 className="page-title">
            <Server size={24} /> Servers
          </h1>
          <p className="servers-description">
            ComfyUI servers to monitor. Run health checks to see server status.
          </p>
        </div>
        <div className="servers-header-actions">
          <button type="button" onClick={() => s.setAddServerOpen(true)} className="btn btn-toolbar">
            <Plus size={16} /> Add Server
          </button>
          <button type="button" onClick={() => s.setBulkOpen((o) => !o)} className="btn btn-toolbar">
            <ListPlus size={16} /> Add Multiple
          </button>
          {s.displayServers.length > 0 && (
            <button type="button" className="btn btn-toolbar" onClick={s.checkAllServers} disabled={s.isChecking} title="Check health of all servers">
              <Activity size={16} className={s.isChecking ? 'spin' : ''} />
              {s.isChecking ? 'Checking…' : 'Check All'}
            </button>
          )}
          <button type="button" onClick={() => s.handleSave()} className="btn btn-toolbar" disabled={!s.hasChanges}>
            <Save size={16} /> Save
          </button>
          {s.saved && <span className="save-message"><Check size={14} /> Saved</span>}
        </div>
      </header>

      {s.prefsLoaded && s.displayServers.length === 0 ? (
        <div className="servers-empty">
          <Server size={36} />
          <p>No servers yet</p>
          <p className="servers-empty-sub">Add a ComfyUI server URL to monitor its health.</p>
        </div>
      ) : s.displayServers.length > 0 ? (
        <>
          <div className="servers-toolbar">
            <div className="servers-search">
              <Search size={15} className="servers-search-icon" />
              <input
                type="text"
                className="servers-search-input"
                placeholder="Search servers…"
                value={s.serverSearch}
                onChange={(e) => s.setServerSearch(e.target.value)}
              />
              {s.serverSearch && (
                <button type="button" className="servers-search-clear" onClick={() => s.setServerSearch('')} aria-label="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="servers-filter-pills">
              {(['all', 'healthy', 'unhealthy', 'unchecked'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`filter-pill filter-pill--${f} ${s.statusFilter === f ? 'filter-pill--active' : ''}`}
                  onClick={() => s.setStatusFilter(f)}
                >
                  {STATUS_FILTER_LABELS[f]}
                  <span className="filter-pill-count">{s.statusCounts[f]}</span>
                </button>
              ))}
            </div>
          </div>

          {s.filteredServers.length === 0 ? (
            <div className="servers-empty servers-empty--filtered">
              <Search size={32} />
              <p>No servers match your filter</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { s.setServerSearch(''); s.setStatusFilter('all') }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="servers-grid">
              {s.filteredServers.map((server, index) => {
                const norm = server.replace(/\/$/, '')
                const health = s.getHealthStatus(norm)
                const isServerChecking = health?.healthy === null
                const realIndex = s.monitoredServers.indexOf(server)
                return (
                  <ServerCard
                    key={server + index}
                    server={server}
                    index={realIndex >= 0 ? realIndex : index}
                    serverAliases={s.serverAliases}
                    health={health ?? null}
                    wfCount={s.workflowCountPerServer[norm] ?? 0}
                    isServerChecking={isServerChecking}
                    isDuplicate={s.duplicateUrls.has(norm)}
                    queueDepth={s.queueDepths[norm]}
                    onRemove={s.handleRemoveServer}
                    onUrlChange={s.handleServerUrlChange}
                    onAliasChange={s.handleServerAliasChange}
                    onViewLogs={s.setLogsServerUrl}
                    onCheck={s.checkServer}
                    onViewWorkflows={s.setWorkflowsServerUrl}
                  />
                )
              })}
            </div>
          )}
        </>
      ) : null}

      {s.bulkOpen && (
        <div className="servers-bulk-panel">
          <p className="servers-bulk-hint">
            One entry per line — <code>url</code> or <code>url, display name</code>
          </p>
          <textarea
            className="servers-bulk-textarea"
            placeholder={`http://127.0.0.1:8188\nhttp://server2:8188, Production\nhttp://server3:8188, Staging`}
            value={s.bulkText}
            onChange={(e) => s.setBulkText(e.target.value)}
            rows={5}
          />
          <div className="servers-bulk-actions">
            <button type="button" onClick={s.handleBulkAdd} className="btn btn-primary">Add servers</button>
            <button type="button" onClick={() => { s.setBulkOpen(false); s.setBulkText('') }} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {s.logsServerUrl && (
        <ServerLogsModal serverUrl={s.logsServerUrl} serverAliases={s.serverAliases} onClose={() => s.setLogsServerUrl(null)} />
      )}
      {s.workflowsServerUrl && (
        <ServerWorkflowsModal
          serverUrl={s.workflowsServerUrl}
          serverAliases={s.serverAliases}
          workflows={s.workflows}
          onClose={() => s.setWorkflowsServerUrl(null)}
        />
      )}
      {s.addServerOpen && (
        <AddServerModal
          existingUrls={s.monitoredServers}
          onConfirm={s.handleAddServerConfirm}
          onCancel={() => s.setAddServerOpen(false)}
        />
      )}
    </div>
  )
}
