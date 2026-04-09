import { useState, useEffect, useRef } from 'react'
import { Save, Server, Plus, X, ListPlus, FileText, Check, Settings as SettingsIcon, AlertCircle } from 'lucide-react'
import { getSettings } from '@/utils/settings'
import { updatePreferences } from '@/services/api/preferences'
import { usePreferences } from '@/hooks/usePreferences'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'

function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export function Settings() {
  const { preferences, invalidate: invalidatePreferences } = usePreferences()
  const prefsInitialized = useRef(false)
  const [monitoredServers, setMonitoredServers] = useState<string[]>([])
  const [serverAliases, setServerAliases] = useState<Record<string, string>>({})
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [addServerOpen, setAddServerOpen] = useState(false)

  useEffect(() => {
    if (!preferences || prefsInitialized.current) return
    prefsInitialized.current = true
    setMonitoredServers(preferences.monitoredServers ?? getSettings().monitoredServers)
    setServerAliases(preferences.serverAliases ?? {})
    setPrefsLoaded(true)
  }, [preferences])

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [saved])

  const handleSave = async () => {
    setSaveError(null)
    try {
      await updatePreferences({ monitoredServers, serverAliases })
      setSaved(true)
      setHasChanges(false)
      invalidatePreferences()
      window.dispatchEvent(new Event('settingsUpdated'))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings')
    }
  }

  const handleAddServerConfirm = (result: { url: string; name?: string }) => {
    const { url, name } = result
    if (!monitoredServers.includes(url)) {
      setMonitoredServers([...monitoredServers, url])
      if (name) {
        setServerAliases((prev) => ({ ...prev, [url]: name }))
      }
      setHasChanges(true)
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
      setHasChanges(true)
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
    setHasChanges(true)
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
    setHasChanges(true)
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
    setHasChanges(true)
  }

  const displayServers = !prefsLoaded ? getSettings().monitoredServers : monitoredServers

  return (
    <div className="flex flex-col h-full">
      {/* ── Page title ─────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-2">
        <div className="flex items-center gap-3">
          <SettingsIcon size={22} className="text-purple-500/70" />
          <h1 className="text-xl font-semibold text-[#e8ecf1]">Settings</h1>
          <div className="flex-1 h-px bg-[#2d3a4a]/50 ml-3" />
        </div>
      </div>

      {/* ── Sticky toolbar ─────────────────────────────────────────── */}
      <div className="sticky top-14 z-20 bg-[#0f1419] px-6 py-3 border-b border-[#2d3a4a]/40">
        <div className="flex items-center gap-3">
          <p className="text-sm text-[#697784] flex-1">
            ComfyUI servers to monitor. Health status appears on workflow cards after running &ldquo;Check Health&rdquo;.
          </p>
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-400/90 font-medium">
                <Check size={14} /> Saved
              </span>
            )}
            {saveError && (
              <span className="inline-flex items-center gap-1.5 text-sm text-red-400 max-w-[280px] truncate" role="alert">
                <AlertCircle size={14} className="flex-shrink-0" /> {saveError}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={15} /> Save
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-4 max-w-3xl">
        <div className="flex flex-col gap-4">

          {/* Server list */}
          {displayServers.length > 0 ? (
            <div className="flex flex-col gap-0.5 bg-[#1a2332] border border-[#2d3a4a] rounded-xl p-4">
              {/* Column headers */}
              <div className="grid gap-2 px-1 pb-2 mb-1 border-b border-[#2d3a4a]/50" style={{ gridTemplateColumns: '1fr 200px auto auto' }}>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#697784]">URL</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#697784]">Display name</span>
                <span />
                <span />
              </div>

              {/* Rows */}
              {displayServers.map((server, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-2.5 py-2 bg-[#0f1419] border border-[#2d3a4a] rounded-lg focus-within:border-purple-500/60 focus-within:shadow-[0_0_0_2px_rgba(107,155,209,0.1)] transition-all"
                >
                  <Server size={14} className="text-[#697784] flex-shrink-0" aria-hidden />
                  <input
                    type="text"
                    value={server}
                    onChange={(e) => handleServerUrlChange(index, e.target.value)}
                    placeholder="http://127.0.0.1:8188"
                    className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-[#e8ecf1] placeholder-[#697784]"
                    aria-label="Server URL"
                  />
                  <input
                    type="text"
                    value={serverAliases[server] || ''}
                    onChange={(e) => handleServerAliasChange(server, e.target.value)}
                    placeholder="Optional name…"
                    className="w-[180px] flex-shrink-0 bg-transparent border-none outline-none text-sm text-[#b8c4d0] placeholder-[#697784] italic"
                    aria-label="Display name"
                  />
                  <button
                    type="button"
                    onClick={() => setLogsServerUrl(server)}
                    className="p-1.5 rounded text-[#697784] hover:text-[#b8c4d0] hover:bg-[#243044] transition-colors flex-shrink-0"
                    title="View server logs"
                  >
                    <FileText size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveServer(index)}
                    className="p-1.5 rounded text-[#697784] hover:text-red-400 hover:bg-red-900/10 transition-colors flex-shrink-0"
                    title="Remove server"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            prefsLoaded && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center bg-[#1a2332] border border-dashed border-[#2d3a4a] rounded-xl">
                <Server size={32} className="text-[#697784]" />
                <p className="text-[#8b9aab] font-medium">No servers yet</p>
                <p className="text-sm text-[#697784] max-w-[40ch]">Add a ComfyUI server URL to monitor its health from the Workflows tab.</p>
              </div>
            )
          )}

          {/* Add row */}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setAddServerOpen(true)}
              className="text-sm py-2 px-3 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors duration-150 flex items-center gap-1.5 border border-[#2d3a4a]"
            >
              <Plus size={15} /> Add Server
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen((o) => !o)}
              className={`text-sm py-2 px-3 rounded-lg flex items-center gap-1.5 border transition-colors duration-150 ${
                bulkOpen
                  ? 'bg-purple-700/15 border-purple-600/40 text-purple-400'
                  : 'border-[#2d3a4a] text-[#b8c4d0] hover:bg-[#243044]'
              }`}
            >
              <ListPlus size={15} /> Add Multiple
            </button>
          </div>

          {/* Bulk add panel */}
          {bulkOpen && (
            <div className="bg-[#1a2332] border border-[#2d3a4a] rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm text-[#8b9aab] leading-relaxed m-0">
                One entry per line —{' '}
                <code className="px-1.5 py-0.5 bg-[#0f1419] border border-[#2d3a4a] rounded text-xs font-mono">url</code>
                {' '}or{' '}
                <code className="px-1.5 py-0.5 bg-[#0f1419] border border-[#2d3a4a] rounded text-xs font-mono">url, display name</code>
              </p>
              <textarea
                className="w-full px-3 py-2.5 bg-[#0f1419] border border-[#2d3a4a] rounded-lg text-[#e8ecf1] text-sm font-[inherit] resize-y min-h-[110px] focus:outline-none focus:border-purple-500/60 placeholder-[#697784] box-border"
                placeholder={`http://127.0.0.1:8188\nhttp://server2:8188, Production\nhttp://server3:8188, Staging`}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={5}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBulkAdd}
                  className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150"
                >
                  Add servers
                </button>
                <button
                  type="button"
                  onClick={() => { setBulkOpen(false); setBulkText('') }}
                  className="text-sm py-2 px-4 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors border border-[#2d3a4a]"
                >
                  Cancel
                </button>
              </div>
            </div>
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
