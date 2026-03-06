import { Save, Server, Plus, X, ListPlus, Check, Activity } from 'lucide-react'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
import { ServerCard } from './ServerCard'
import { useServers } from './useServers'
import './Servers.css'

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
          {s.displayServers.length > 0 && (
            <button type="button" className="btn btn-secondary" onClick={s.checkAllServers} disabled={s.isChecking} title="Check health of all servers">
              <Activity size={16} className={s.isChecking ? 'spin' : ''} />
              {s.isChecking ? 'Checking…' : 'Check All'}
            </button>
          )}
          <button type="button" onClick={() => s.handleSave()} className="btn btn-primary" disabled={!s.hasChanges}>
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
      ) : (
        <div className="servers-grid">
          {s.displayServers.map((server, index) => {
            const norm = server.replace(/\/$/, '')
            const health = s.getHealthStatus(norm)
            const isServerChecking = health?.healthy === null
            return (
              <ServerCard
                key={index}
                server={server}
                index={index}
                serverAliases={s.serverAliases}
                health={health}
                wfCount={s.workflowCountPerServer[norm] ?? 0}
                isServerChecking={isServerChecking}
                onRemove={s.handleRemoveServer}
                onUrlChange={s.handleServerUrlChange}
                onAliasChange={s.handleServerAliasChange}
                onViewLogs={s.setLogsServerUrl}
                onCheck={s.checkServer}
              />
            )
          })}
        </div>
      )}

      <div className="servers-add-row">
        <button type="button" onClick={() => s.setAddServerOpen(true)} className="btn btn-secondary">
          <Plus size={16} /> Add Server
        </button>
        <button type="button" onClick={() => s.setBulkOpen((o) => !o)} className="btn btn-secondary">
          <ListPlus size={16} /> Add Multiple
        </button>
      </div>

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
