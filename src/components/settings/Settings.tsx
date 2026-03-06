import { useState, useEffect } from 'react'
import { Save, Server, Plus, X, ListPlus, FileText, Check } from 'lucide-react'
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
      const timer = setTimeout(() => setSaved(false), 2500)
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

  const handleServerAliasChange = (url: string, alias: string) => {
    setServerAliases((prev) => {
      const next = { ...prev }
      if (alias.trim()) {
        next[url] = alias
      } else {
        delete next[url]
      }
      return next
    })
  }

  const displayServers = !prefsLoaded ? getSettings().monitoredServers : monitoredServers

  return (
    <div className="servers-page">
      <header className="servers-header">
        <div className="servers-header-title">
          <h1 className="page-title">
            <Server size={24} />
            Servers
          </h1>
          <p className="servers-description">
            ComfyUI servers to monitor. Health status appears on workflow cards after running &quot;Check Health&quot; from the Workflows tab.
          </p>
        </div>
        <div className="servers-header-actions">
          <button onClick={handleSave} className="btn btn-primary">
            <Save size={16} />
            Save
          </button>
          {saved && (
            <span className="save-message">
              <Check size={14} /> Saved
            </span>
          )}
        </div>
      </header>

      <div className="servers-list-wrap">
        {displayServers.length > 0 ? (
          <div className="servers-list-rows">
            <div className="servers-list-columns-header">
              <span className="servers-col-label">URL</span>
              <span className="servers-col-label">Display name</span>
            </div>
            {displayServers.map((server, index) => (
              <div key={index} className="server-row">
                <Server size={15} className="server-row-icon" aria-hidden />
                <input
                  type="text"
                  value={server}
                  onChange={(e) => handleServerUrlChange(index, e.target.value)}
                  placeholder="http://127.0.0.1:8188"
                  className="server-row-url"
                  aria-label="Server URL"
                />
                <input
                  type="text"
                  value={serverAliases[server] || ''}
                  onChange={(e) => handleServerAliasChange(server, e.target.value)}
                  placeholder="Optional name…"
                  className="server-row-alias"
                  aria-label="Display name"
                />
                <button
                  type="button"
                  onClick={() => setLogsServerUrl(server)}
                  className="server-action-btn"
                  title="View server logs"
                >
                  <FileText size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveServer(index)}
                  className="server-action-btn server-action-remove"
                  title="Remove server"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          prefsLoaded && (
            <div className="servers-empty">
              <Server size={36} />
              <p>No servers yet</p>
              <p className="servers-empty-sub">Add a ComfyUI server URL to monitor its health from the Workflows tab.</p>
            </div>
          )
        )}

        <div className="servers-add-row">
          <button type="button" onClick={() => setAddServerOpen(true)} className="btn btn-secondary">
            <Plus size={16} />
            Add Server
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen((o) => !o)}
            className="btn btn-secondary"
          >
            <ListPlus size={16} />
            Add Multiple
          </button>
        </div>

        {bulkOpen && (
          <div className="servers-bulk-panel">
            <p className="servers-bulk-hint">
              One entry per line — <code>url</code> or <code>url, display name</code>
            </p>
            <textarea
              className="servers-bulk-textarea"
              placeholder={`http://127.0.0.1:8188\nhttp://server2:8188, Production\nhttp://server3:8188, Staging`}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={5}
            />
            <div className="servers-bulk-actions">
              <button type="button" onClick={handleBulkAdd} className="btn btn-primary">
                Add servers
              </button>
              <button
                type="button"
                onClick={() => { setBulkOpen(false); setBulkText('') }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
