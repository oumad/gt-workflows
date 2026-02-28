import { useState, useEffect } from 'react'
import { Save, Settings as SettingsIcon, Activity, Plus, X, Server, ListPlus, FileText } from 'lucide-react'
import { getSettings } from '@/utils/settings'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
import './Settings.css'

function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export function Settings() {
  const [monitoredServers, setMonitoredServers] = useState<string[]>([])
  const [serverAliases, setServerAliases] = useState<Record<string, string>>({})
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [addServerOpen, setAddServerOpen] = useState(false)

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        const list = prefs.monitoredServers ?? getSettings().monitoredServers
        setMonitoredServers(list)
        setServerAliases(prefs.serverAliases ?? {})
        setPrefsLoaded(true)
      })
      .catch(() => setPrefsLoaded(true))
  }, [])

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  const handleSave = async () => {
    try {
      await updatePreferences({ monitoredServers, serverAliases })
      setSaved(true)
      window.dispatchEvent(new Event('settingsUpdated'))
    } catch {
      setSaved(false)
    }
  }

  const handleAddServerConfirm = (result: { url: string; name?: string }) => {
    const { url, name } = result
    if (!monitoredServers.includes(url)) {
      setMonitoredServers([...monitoredServers, url])
      if (name) {
        setServerAliases((prev) => ({ ...prev, [url]: name }))
      }
    }
    setAddServerOpen(false)
  }

  const handleBulkAdd = () => {
    const entries: { url: string; name?: string }[] = []
    for (const line of bulkText.split(/\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const commaIdx = trimmed.indexOf(',')
      let url: string
      let name: string | undefined
      if (commaIdx >= 0) {
        url = normalizeServerUrl(trimmed.slice(0, commaIdx))
        const namePart = trimmed.slice(commaIdx + 1).trim()
        name = namePart || undefined
      } else {
        url = normalizeServerUrl(trimmed)
      }
      if (url) entries.push({ url, name })
    }
    const existing = new Set(monitoredServers)
    const uniqueNewUrls = new Set<string>()
    for (const e of entries) {
      if (e.url && !existing.has(e.url)) uniqueNewUrls.add(e.url)
    }
    const newUrls = Array.from(uniqueNewUrls)
    const newNames: Record<string, string> = {}
    for (const e of entries) {
      if (e.name && uniqueNewUrls.has(e.url)) newNames[e.url] = e.name
    }
    if (newUrls.length > 0) {
      setMonitoredServers([...monitoredServers, ...newUrls])
      if (Object.keys(newNames).length > 0) {
        setServerAliases((prev) => ({ ...prev, ...newNames }))
      }
    }
    setBulkText('')
    setBulkOpen(false)
  }

  const handleRemoveServer = (index: number) => {
    const url = monitoredServers[index]
    setMonitoredServers(monitoredServers.filter((_, i) => i !== index))
    if (serverAliases[url]) {
      const next = { ...serverAliases }
      delete next[url]
      setServerAliases(next)
    }
  }

  const handleServerUrlChange = (index: number, newUrl: string) => {
    const updated = [...monitoredServers]
    const oldUrl = monitoredServers[index]
    const normalized = newUrl.trim().replace(/\/$/, '')
    updated[index] = normalized
    setMonitoredServers(updated)
    if (serverAliases[oldUrl] && oldUrl !== normalized) {
      const next = { ...serverAliases }
      delete next[oldUrl]
      if (normalized) next[normalized] = serverAliases[oldUrl]
      setServerAliases(next)
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1 className="page-title">
          <SettingsIcon size={24} />
          Settings
        </h1>
      </header>

      <div className="settings-content">
        <div className="settings-section settings-section-health">
          <div className="section-header">
            <Activity size={20} aria-hidden />
            <h2>Server Health Checks</h2>
          </div>
          <p className="section-description">
            Configure ComfyUI servers to monitor. Health status is checked on demand from the Workflows tab via &quot;Check Health&quot;.
          </p>

          <div className="settings-group health-panel">
            <div className="setting-item setting-item-full health-servers-block">
              <label>
                <span className="label-text">Monitored Servers</span>
                <span className="label-description">
                  Add ComfyUI server URLs. Workflow cards will show connection status when you run a health check.
                </span>
              </label>
              <div className="setting-control servers-list">
                <div className="servers-list-items">
                  {(!prefsLoaded ? getSettings().monitoredServers : monitoredServers).map((server, index) => (
                    <div key={index} className="server-item">
                      <Server size={16} />
                      <div className="server-item-fields">
                        <input
                          type="text"
                          value={server}
                          onChange={(e) => handleServerUrlChange(index, e.target.value)}
                          placeholder="http://127.0.0.1:8188"
                          className="server-url-input"
                        />
                        {serverAliases[server] && (
                          <span className="server-item-name" title={serverAliases[server]}>
                            {serverAliases[server]}
                          </span>
                        )}
                      </div>
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
                    onClick={() => setAddServerOpen(true)}
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
                    <p className="server-bulk-hint">
                      One entry per line. Use <code>url</code> or <code>url,name</code> (optional display name after comma).
                    </p>
                    <textarea
                      className="server-bulk-textarea"
                      placeholder="http://127.0.0.1:8188&#10;http://x1254718:8199,Production&#10;http://x1313257:8188,Staging"
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
                {monitoredServers.length === 0 && prefsLoaded && (
                  <p className="health-empty-hint">
                    No servers configured. Add at least one ComfyUI server URL above to use health checks from the Workflows tab.
                  </p>
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
        <ServerLogsModal
          serverUrl={logsServerUrl}
          serverAliases={serverAliases}
          onClose={() => setLogsServerUrl(null)}
        />
      )}
      {addServerOpen && (
        <AddServerModal
          existingUrls={monitoredServers}
          onConfirm={handleAddServerConfirm}
          onCancel={() => setAddServerOpen(false)}
        />
      )}
    </div>
  )
}

