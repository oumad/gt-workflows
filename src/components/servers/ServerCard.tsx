import { Server, X, FileText, Activity, CheckCircle, XCircle, Clock, LayoutGrid, AlertTriangle } from 'lucide-react'
import type { ServerHealthStatus } from '@/hooks/useServerHealthCheck'
import type { QueueDepth } from '@/services/api/servers'

interface ServerCardProps {
  server: string
  index: number
  serverAliases: Record<string, string>
  health: ServerHealthStatus | null
  wfCount: number
  isServerChecking: boolean
  isDuplicate?: boolean
  queueDepth?: QueueDepth
  onRemove: (index: number) => void
  onUrlChange: (index: number, newUrl: string) => void
  onAliasChange: (url: string, alias: string) => void
  onViewLogs: (url: string) => void
  onCheck: (url: string) => void
  onViewWorkflows: (url: string) => void
}

export function ServerCard({
  server, index, serverAliases, health, wfCount, isServerChecking,
  isDuplicate, queueDepth,
  onRemove, onUrlChange, onAliasChange, onViewLogs, onCheck, onViewWorkflows,
}: ServerCardProps) {
  const norm = server.replace(/\/$/, '')
  const healthClass = !health
    ? ''
    : health.healthy === true
      ? 'server-card--healthy'
      : health.healthy === false
        ? 'server-card--unhealthy'
        : 'server-card--checking'

  const queueLabel = queueDepth
    ? [
        queueDepth.running > 0 ? `${queueDepth.running} running` : '',
        queueDepth.pending > 0 ? `${queueDepth.pending} queued` : '',
      ].filter(Boolean).join(', ')
    : null

  return (
    <div className={`server-card ${healthClass} ${isDuplicate ? 'server-card--duplicate' : ''}`}>
      <div className="server-card-header">
        <div className="server-card-status-icon">
          {!health && <Server size={18} className="server-card-icon-default" />}
          {health?.healthy === null && <Clock size={18} className="server-card-icon-checking spin" />}
          {health?.healthy === true && <CheckCircle size={18} className="server-card-icon-healthy" />}
          {health?.healthy === false && <XCircle size={18} className="server-card-icon-unhealthy" />}
        </div>
        <span className="server-card-title" title={serverAliases[server] || server}>
          {serverAliases[server] || server.replace(/^https?:\/\//, '')}
        </span>
        {isDuplicate && (
          <span className="server-card-duplicate-badge" title="Duplicate URL — this server appears more than once">
            <AlertTriangle size={14} />
          </span>
        )}
        <button type="button" className="server-card-remove" onClick={() => onRemove(index)} title="Remove server">
          <X size={14} />
        </button>
      </div>

      <div className="server-card-body">
        <div className="server-card-field">
          <label className="server-card-label">URL</label>
          <input
            type="text"
            value={server}
            onChange={(e) => onUrlChange(index, e.target.value)}
            placeholder="http://127.0.0.1:8188"
            className={`server-card-input${isDuplicate ? ' server-card-input--duplicate' : ''}`}
            aria-label="Server URL"
          />
        </div>
        <div className="server-card-field">
          <label className="server-card-label">Name</label>
          <input
            type="text"
            value={serverAliases[server] || ''}
            onChange={(e) => onAliasChange(server, e.target.value)}
            placeholder="Optional display name"
            className="server-card-input"
            aria-label="Display name"
          />
        </div>
      </div>

      <div className="server-card-footer">
        <button
          type="button"
          className="server-card-wf-count"
          onClick={() => onViewWorkflows(norm)}
          title={`${wfCount} workflow${wfCount !== 1 ? 's' : ''} use this server — click to view`}
        >
          <LayoutGrid size={13} />
          {wfCount} workflow{wfCount !== 1 ? 's' : ''}
        </button>
        {queueLabel && health?.healthy === true && (
          <span className="server-card-queue" title="ComfyUI queue depth">
            {queueLabel}
          </span>
        )}
        {health?.lastChecked && (
          <span className="server-card-checked-time" title={`Last checked: ${new Date(health.lastChecked).toLocaleTimeString()}`}>
            {new Date(health.lastChecked).toLocaleTimeString()}
          </span>
        )}
        <div className="server-card-actions">
          <button type="button" className="server-action-btn" onClick={() => onViewLogs(server)} title="View server logs">
            <FileText size={14} />
          </button>
          <button type="button" className="server-action-btn" onClick={() => onCheck(norm)} disabled={isServerChecking} title="Check server health">
            <Activity size={14} className={isServerChecking ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {health?.healthy === false && health.error && (
        <div className="server-card-error">{health.error}</div>
      )}
    </div>
  )
}
