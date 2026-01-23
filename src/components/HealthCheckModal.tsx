import { X, CheckCircle, XCircle, Clock, Activity, Server } from 'lucide-react'
import { ServerHealthStatus } from '../hooks/useServerHealthCheck'
import './HealthCheckModal.css'

interface HealthCheckModalProps {
  healthStatuses: ServerHealthStatus[]
  isChecking: boolean
  monitoredServers: string[]
  onClose: () => void
}

export default function HealthCheckModal({ healthStatuses, isChecking, monitoredServers, onClose }: HealthCheckModalProps) {
  const healthyCount = healthStatuses.filter(s => s.healthy === true).length
  const unhealthyCount = healthStatuses.filter(s => s.healthy === false).length
  const checkingCount = healthStatuses.filter(s => s.healthy === null).length

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return 'Never'
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString()
    } catch {
      return 'Unknown'
    }
  }

  return (
    <div className="health-check-modal-overlay" onClick={onClose}>
      <div className="health-check-modal" onClick={(e) => e.stopPropagation()}>
        <div className="health-check-modal-header">
          <div className="health-check-modal-title">
            <Activity size={20} />
            <h2>Server Health Status</h2>
          </div>
          <button className="health-check-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="health-check-modal-content">
          {monitoredServers.length === 0 && (
            <div className="health-check-status-message">
              <p>No servers configured.</p>
              <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Add servers in Settings to monitor their health. Make sure to click "Save Settings" after adding servers.
              </p>
            </div>
          )}

          {monitoredServers.length > 0 && (
            <>
              {/* Show summary if we have any results or are checking */}
              {(healthStatuses.length > 0 || isChecking) && (
                <>
                  <div className="health-check-summary">
                    <div className="health-check-summary-item healthy">
                      <CheckCircle size={16} />
                      <span>{healthyCount} Healthy</span>
                    </div>
                    <div className="health-check-summary-item unhealthy">
                      <XCircle size={16} />
                      <span>{unhealthyCount} Unhealthy</span>
                    </div>
                    {checkingCount > 0 && (
                      <div className="health-check-summary-item checking">
                        <Clock size={16} className="spinner" />
                        <span>{checkingCount} Checking</span>
                      </div>
                    )}
                  </div>

                  <div className="health-check-list">
                    {/* Show all monitored servers - either with status or as checking */}
                    {monitoredServers.map((serverUrl) => {
                      const status = healthStatuses.find(s => s.serverUrl === serverUrl) || {
                        serverUrl,
                        healthy: isChecking ? null : undefined
                      }
                      return (
                        <div
                          key={status.serverUrl}
                          className={`health-check-item ${
                            status.healthy === true
                              ? 'healthy'
                              : status.healthy === false
                              ? 'unhealthy'
                              : status.healthy === null
                              ? 'checking'
                              : ''
                          }`}
                        >
                          <div className="health-check-item-header">
                            <div className="health-check-item-icon">
                              {status.healthy === true ? (
                                <CheckCircle size={20} />
                              ) : status.healthy === false ? (
                                <XCircle size={20} />
                              ) : status.healthy === null ? (
                                <Clock size={20} className="spinner" />
                              ) : (
                                <Server size={20} />
                              )}
                            </div>
                            <div className="health-check-item-info">
                              <div className="health-check-item-server">
                                <Server size={14} />
                                <span className="health-check-item-url">{status.serverUrl}</span>
                              </div>
                              {status.lastChecked && (
                                <div className="health-check-item-time">
                                  Last checked: {formatTime(status.lastChecked)}
                                </div>
                              )}
                            </div>
                          </div>
                          {status.healthy === false && status.error && (
                            <div className="health-check-item-error">
                              <strong>Error:</strong> {status.error}
                            </div>
                          )}
                          {status.healthy === true && (
                            <div className="health-check-item-success">
                              Server is responding and healthy
                            </div>
                          )}
                          {status.healthy === null && (
                            <div className="health-check-item-checking">
                              Checking server health...
                            </div>
                          )}
                          {status.healthy === undefined && !isChecking && (
                            <div className="health-check-item-checking" style={{ color: 'var(--text-muted)' }}>
                              Click "Check Health" to verify server status
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Show message if no checks have been run yet */}
              {!isChecking && healthStatuses.length === 0 && (
                <div className="health-check-status-message">
                  <p>No health check results yet.</p>
                  <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {monitoredServers.length} server{monitoredServers.length !== 1 ? 's' : ''} configured. 
                    Health checks will appear here after clicking "Check Health".
                  </p>
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
                    <strong style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Configured servers:</strong>
                    <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {monitoredServers.map((server, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>{server}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

