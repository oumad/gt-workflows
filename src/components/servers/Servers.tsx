import { useState, useEffect, useMemo } from 'react'
import { Save, Server, Plus, X, ListPlus, FileText, Check, Activity, CheckCircle, XCircle, Clock, LayoutGrid } from 'lucide-react'
import { getSettings } from '@/utils/settings'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
import { useServerHealthCheck } from '@/hooks/useServerHealthCheck'
import { useWorkflows } from '@/hooks/useWorkflows'
import { getServerUrls } from '@/utils/serverUrl'
import './Servers.css'

// Module-level cache — survives component unmount/remount (tab switches)
let serverPrefsCache: { monitoredServers: string[]; serverAliases: Record<string, string> } | null = null

function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export function Servers() {
  const [monitoredServers, setMonitoredServers] = useState<string[]>(
    serverPrefsCache?.monitoredServers ?? []
  )
  const [serverAliases, setServerAliases] = useState<Record<string, string>>(
    serverPrefsCache?.serverAliases ?? {}
  )
  const [savedServers, setSavedServers] = useState<string[]>(
    serverPrefsCache?.monitoredServers ?? []
  )
  const [savedAliases, setSavedAliases] = useState<Record<string, string>>(
    serverPrefsCache?.serverAliases ?? {}
  )
  const [prefsLoaded, setPrefsLoaded] = useState(serverPrefsCache !== null)
  const [saved, setSaved] = useState(false)

  const hasChanges = useMemo(() => {
    if (monitoredServers.length !== savedServers.length) return true
    if (monitoredServers.some((v, i) => v !== savedServers[i])) return true
    const ak = Object.keys(serverAliases), sk = Object.keys(savedAliases)
    if (ak.length !== sk.length) return true
    return ak.some((k) => serverAliases[k] !== savedAliases[k])
  }, [monitoredServers, savedServers, serverAliases, savedAliases])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [addServerOpen, setAddServerOpen] = useState(false)

  const { workflows } = useWorkflows()

  const displayServers = !prefsLoaded ? getSettings().monitoredServers : monitoredServers

  const { getHealthStatus, checkAllServers, checkServer, isChecking } = useServerHealthCheck(
    displayServers,
    { enabled: true }
  )

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        const list = prefs.monitoredServers ?? getSettings().monitoredServers
        const aliases = prefs.serverAliases ?? {}
        serverPrefsCache = { monitoredServers: list, serverAliases: aliases }
        setMonitoredServers(list)
        setServerAliases(aliases)
        setSavedServers(list)
        setSavedAliases(aliases)
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

  const handleSave = async (
    servers: string[] = monitoredServers,
    aliases: Record<string, string> = serverAliases,
  ) => {
    try {
      await updatePreferences({ monitoredServers: servers, serverAliases: aliases })
      serverPrefsCache = { monitoredServers: servers, serverAliases: aliases }
      setSavedServers(servers)
      setSavedAliases(aliases)
      setSaved(true)
      window.dispatchEvent(new Event('settingsUpdated'))
    } catch {
      // leave saved baseline unchanged so the button stays enabled for retry
    }
  }

  const handleAddServerConfirm = async (result: { url: string; name?: string }) => {
    const { url, name } = result
    setAddServerOpen(false)
    if (!monitoredServers.includes(url)) {
      const newServers = [...monitoredServers, url]
      const newAliases = name ? { ...serverAliases, [url]: name } : serverAliases
      setMonitoredServers(newServers)
      setServerAliases(newAliases)
      await handleSave(newServers, newAliases)
    }
  }

  const handleBulkAdd = async () => {
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
    setBulkText('')
    setBulkOpen(false)
    if (newUrls.length > 0) {
      const newServers = [...monitoredServers, ...newUrls]
      const newAliases = Object.keys(newNames).length > 0
        ? { ...serverAliases, ...newNames }
        : serverAliases
      setMonitoredServers(newServers)
      setServerAliases(newAliases)
      await handleSave(newServers, newAliases)
    }
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

  const workflowCountPerServer = useMemo(() => {
    const map: Record<string, number> = {}
    for (const wf of workflows) {
      const serverUrl = wf.params?.comfyui_config?.serverUrl
      if (serverUrl) {
        for (const url of getServerUrls(serverUrl)) {
          const norm = url.replace(/\/$/, '')
          map[norm] = (map[norm] ?? 0) + 1
        }
      }
    }
    return map
  }, [workflows])

  return (
    <div className="servers-page">
      <header className="servers-header">
        <div className="servers-header-title">
          <h1 className="page-title">
            <Server size={24} />
            Servers
          </h1>
          <p className="servers-description">
            ComfyUI servers to monitor. Run health checks to see server status.
          </p>
        </div>
        <div className="servers-header-actions">
          {displayServers.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={checkAllServers}
              disabled={isChecking}
              title="Check health of all servers"
            >
              <Activity size={16} className={isChecking ? 'spin' : ''} />
              {isChecking ? 'Checking…' : 'Check All'}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSave()}
            className="btn btn-primary"
            disabled={!hasChanges}
          >
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

      {prefsLoaded && displayServers.length === 0 ? (
        <div className="servers-empty">
          <Server size={36} />
          <p>No servers yet</p>
          <p className="servers-empty-sub">Add a ComfyUI server URL to monitor its health.</p>
        </div>
      ) : (
        <div className="servers-grid">
          {displayServers.map((server, index) => {
            const norm = server.replace(/\/$/, '')
            const health = getHealthStatus(norm)
            const wfCount = workflowCountPerServer[norm] ?? 0
            const isServerChecking = health?.healthy === null
            const healthClass = !health
              ? ''
              : health.healthy === true
                ? 'server-card--healthy'
                : health.healthy === false
                  ? 'server-card--unhealthy'
                  : 'server-card--checking'

            return (
              <div key={index} className={`server-card ${healthClass}`}>
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
                  <button
                    type="button"
                    className="server-card-remove"
                    onClick={() => handleRemoveServer(index)}
                    title="Remove server"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="server-card-body">
                  <div className="server-card-field">
                    <label className="server-card-label">URL</label>
                    <input
                      type="text"
                      value={server}
                      onChange={(e) => handleServerUrlChange(index, e.target.value)}
                      placeholder="http://127.0.0.1:8188"
                      className="server-card-input"
                      aria-label="Server URL"
                    />
                  </div>
                  <div className="server-card-field">
                    <label className="server-card-label">Name</label>
                    <input
                      type="text"
                      value={serverAliases[server] || ''}
                      onChange={(e) => handleServerAliasChange(server, e.target.value)}
                      placeholder="Optional display name"
                      className="server-card-input"
                      aria-label="Display name"
                    />
                  </div>
                </div>

                <div className="server-card-footer">
                  <span className="server-card-wf-count" title={`${wfCount} workflow${wfCount !== 1 ? 's' : ''} use this server`}>
                    <LayoutGrid size={13} />
                    {wfCount} workflow{wfCount !== 1 ? 's' : ''}
                  </span>
                  {health?.lastChecked && (
                    <span className="server-card-checked-time" title={`Last checked: ${new Date(health.lastChecked).toLocaleTimeString()}`}>
                      {new Date(health.lastChecked).toLocaleTimeString()}
                    </span>
                  )}
                  <div className="server-card-actions">
                    <button
                      type="button"
                      className="server-action-btn"
                      onClick={() => setLogsServerUrl(server)}
                      title="View server logs"
                    >
                      <FileText size={14} />
                    </button>
                    <button
                      type="button"
                      className="server-action-btn"
                      onClick={() => checkServer(norm)}
                      disabled={isServerChecking}
                      title="Check server health"
                    >
                      <Activity size={14} className={isServerChecking ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                {health?.healthy === false && health.error && (
                  <div className="server-card-error">
                    {health.error}
                  </div>
                )}
              </div>
            )
          })}
        </div>
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
