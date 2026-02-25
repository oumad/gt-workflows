import { useState, useEffect } from 'react'
import { Save, Settings as SettingsIcon, Activity, Plus, X, Server, ListPlus, FileText } from 'lucide-react'
import { getSettings, saveSettings } from '@/utils/settings'
import type { AppSettings } from '@/utils/settings'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import './Settings.css'

function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [saved, setSaved] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)

  useEffect(() => {
    // Reset saved message after 2 seconds
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  const handleSave = () => {
    saveSettings(settings)
    setSaved(true)
    // Trigger custom event so other components can update
    window.dispatchEvent(new Event('settingsUpdated'))
  }

  const handleAddServer = () => {
    const newServer = prompt('Enter ComfyUI server URL (e.g., http://127.0.0.1:8188):')
    if (newServer && newServer.trim()) {
      const normalized = normalizeServerUrl(newServer)
      if (normalized && !settings.monitoredServers.includes(normalized)) {
        setSettings({
          ...settings,
          monitoredServers: [...settings.monitoredServers, normalized]
        })
      }
    }
  }

  const handleBulkAdd = () => {
    const lines = bulkText.split(/\n/).map((line) => normalizeServerUrl(line)).filter(Boolean)
    const existing = new Set(settings.monitoredServers)
    const added = lines.filter((u) => !existing.has(u))
    if (added.length > 0) {
      setSettings({
        ...settings,
        monitoredServers: [...settings.monitoredServers, ...added]
      })
    }
    setBulkText('')
    setBulkOpen(false)
  }

  const handleRemoveServer = (index: number) => {
    setSettings({
      ...settings,
      monitoredServers: settings.monitoredServers.filter((_, i) => i !== index)
    })
  }

  const handleServerUrlChange = (index: number, newUrl: string) => {
    const updated = [...settings.monitoredServers]
    let normalized = newUrl.trim()
    // Normalize URL (remove trailing slash)
    normalized = normalized.replace(/\/$/, '')
    updated[index] = normalized
    setSettings({ ...settings, monitoredServers: updated })
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>
          <SettingsIcon size={24} />
          Settings
        </h1>
      </div>

      <div className="settings-content">
        <div className="settings-section">
          <div className="section-header">
            <Activity size={20} />
            <h2>Server Health Checks</h2>
          </div>

          <div className="settings-group">
            <div className="setting-item">
              <label>
                <span className="label-text">Health Checks</span>
                <span className="label-description">
                  Health checks are now manual only. Use the "Check Health" button in the workflow list to check server status on demand.
                </span>
              </label>
              <div className="setting-control">
                <small className="setting-hint">
                  Manual checks improve performance and reduce server load.
                </small>
              </div>
            </div>

            <div className="setting-item setting-item-full">
              <label>
                <span className="label-text">Monitored Servers</span>
                <span className="label-description">
                  List of ComfyUI servers to monitor. Workflows will show health status based on these servers.
                </span>
              </label>
              <div className="setting-control servers-list">
                <div className="servers-list-items">
                  {settings.monitoredServers.map((server, index) => (
                    <div key={index} className="server-item">
                      <Server size={16} />
                      <input
                        type="text"
                        value={server}
                        onChange={(e) => handleServerUrlChange(index, e.target.value)}
                        placeholder="http://127.0.0.1:8188"
                        className="server-url-input"
                      />
                      <button
                        type="button"
                        onClick={() => setLogsServerUrl(server)}
                        className="server-logs-btn"
                        title="View server logs"
                      >
                        <FileText size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveServer(index)}
                        className="remove-server-btn"
                        title="Remove server"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="server-add-buttons">
                  <button
                    type="button"
                    onClick={handleAddServer}
                    className="add-server-btn"
                  >
                    <Plus size={16} />
                    Add Server
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkOpen((o) => !o)}
                    className="add-server-btn add-server-btn-bulk"
                  >
                    <ListPlus size={16} />
                    Add multiple
                  </button>
                </div>
                {bulkOpen && (
                  <div className="server-bulk-wrap">
                    <textarea
                      className="server-bulk-textarea"
                      placeholder="Paste one URL per line, e.g.:&#10;http://x1254718:8199&#10;http://x1313257:8188"
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      rows={5}
                    />
                    <div className="server-bulk-actions">
                      <button type="button" onClick={handleBulkAdd} className="btn btn-primary">
                        Add servers
                      </button>
                      <button type="button" onClick={() => { setBulkOpen(false); setBulkText(''); }} className="btn btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {settings.monitoredServers.length === 0 && (
                  <small className="setting-hint">
                    No servers configured. Add at least one server to enable health checks.
                  </small>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <button onClick={handleSave} className="btn btn-primary">
            <Save size={16} />
            Save Settings
          </button>
          {saved && (
            <span className="save-message">
              Settings saved!
            </span>
          )}
        </div>
      </div>
      {logsServerUrl && (
        <ServerLogsModal serverUrl={logsServerUrl} onClose={() => setLogsServerUrl(null)} />
      )}
    </div>
  )
}

