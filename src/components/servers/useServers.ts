import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getSettings } from '@/utils/settings'
import { updatePreferences } from '@/services/api/preferences'
import { usePreferences } from '@/hooks/usePreferences'
import { useServerHealthCheck } from '@/hooks/useServerHealthCheck'
import { useWorkflows } from '@/hooks/useWorkflows'
import { getServerUrls } from '@/utils/serverUrl'
import { fetchQueueDepth, type QueueDepth } from '@/services/api/servers'

export type StatusFilter = 'all' | 'healthy' | 'unhealthy' | 'unchecked'

export function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export function useServers() {
  const { preferences, invalidate: invalidatePreferences } = usePreferences()
  const prefsInitialized = useRef(false)
  const [monitoredServers, setMonitoredServers] = useState<string[]>([])
  const [serverAliases, setServerAliases] = useState<Record<string, string>>({})
  const [savedServers, setSavedServers] = useState<string[]>([])
  const [savedAliases, setSavedAliases] = useState<Record<string, string>>({})
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [addServerOpen, setAddServerOpen] = useState(false)
  const [workflowsServerUrl, setWorkflowsServerUrl] = useState<string | null>(null)
  const [serverSearch, setServerSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [queueDepths, setQueueDepths] = useState<Record<string, QueueDepth>>({})

  const hasChanges = useMemo(() => {
    if (monitoredServers.length !== savedServers.length) return true
    if (monitoredServers.some((v, i) => v !== savedServers[i])) return true
    const ak = Object.keys(serverAliases), sk = Object.keys(savedAliases)
    if (ak.length !== sk.length) return true
    return ak.some((k) => serverAliases[k] !== savedAliases[k])
  }, [monitoredServers, savedServers, serverAliases, savedAliases])

  const { workflows } = useWorkflows()
  const displayServers = !prefsLoaded ? getSettings().monitoredServers : monitoredServers
  const { getHealthStatus, checkAllServers, checkServer, isChecking } = useServerHealthCheck(displayServers, { enabled: true })

  useEffect(() => {
    if (!preferences || prefsInitialized.current) return
    prefsInitialized.current = true
    const list = preferences.monitoredServers ?? getSettings().monitoredServers
    const aliases = preferences.serverAliases ?? {}
    setMonitoredServers(list)
    setServerAliases(aliases)
    setSavedServers(list)
    setSavedAliases(aliases)
    setPrefsLoaded(true)
  }, [preferences])

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [saved])

  // Wrap checkServer to also fetch queue depth afterward
  const handleCheckServer = useCallback(async (url: string) => {
    await checkServer(url)
    fetchQueueDepth(url)
      .then((depth) => setQueueDepths((prev) => ({ ...prev, [url]: depth })))
      .catch(() => {})
  }, [checkServer])

  // Wrap checkAllServers to also fetch queue depths afterward
  const handleCheckAllServers = useCallback(async () => {
    await checkAllServers()
    const uniqueUrls = [...new Set(displayServers.map((s) => s.replace(/\/$/, '')))]
    for (const url of uniqueUrls) {
      fetchQueueDepth(url)
        .then((depth) => setQueueDepths((prev) => ({ ...prev, [url]: depth })))
        .catch(() => {})
    }
  }, [checkAllServers, displayServers])

  const handleSave = async (
    servers: string[] = monitoredServers,
    aliases: Record<string, string> = serverAliases,
  ) => {
    try {
      await updatePreferences({ monitoredServers: servers, serverAliases: aliases })
      setSavedServers(servers)
      setSavedAliases(aliases)
      setSaved(true)
      invalidatePreferences()
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
    for (const e of entries) { if (e.url && !existing.has(e.url)) uniqueNewUrls.add(e.url) }
    const newUrls = Array.from(uniqueNewUrls)
    const newNames: Record<string, string> = {}
    for (const e of entries) { if (e.name && uniqueNewUrls.has(e.url)) newNames[e.url] = e.name }
    setBulkText('')
    setBulkOpen(false)
    if (newUrls.length > 0) {
      const newServers = [...monitoredServers, ...newUrls]
      const newAliases = Object.keys(newNames).length > 0 ? { ...serverAliases, ...newNames } : serverAliases
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
      if (alias.trim()) next[url] = alias
      else delete next[url]
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

  const duplicateUrls = useMemo(() => {
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const s of displayServers) {
      const norm = s.replace(/\/$/, '')
      if (seen.has(norm)) dupes.add(norm)
      else seen.add(norm)
    }
    return dupes
  }, [displayServers]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusCounts = useMemo(() => {
    let healthy = 0, unhealthy = 0, unchecked = 0
    for (const s of displayServers) {
      const norm = s.replace(/\/$/, '')
      const h = getHealthStatus(norm)
      if (!h || h.healthy === null) unchecked++
      else if (h.healthy === true) healthy++
      else unhealthy++
    }
    return { all: displayServers.length, healthy, unhealthy, unchecked }
  }, [displayServers, getHealthStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredServers = useMemo(() => {
    return displayServers.filter((server) => {
      const norm = server.replace(/\/$/, '')
      if (serverSearch) {
        const q = serverSearch.toLowerCase()
        const alias = serverAliases[server] || ''
        if (!server.toLowerCase().includes(q) && !alias.toLowerCase().includes(q)) return false
      }
      if (statusFilter !== 'all') {
        const h = getHealthStatus(norm)
        if (statusFilter === 'healthy' && h?.healthy !== true) return false
        if (statusFilter === 'unhealthy' && h?.healthy !== false) return false
        if (statusFilter === 'unchecked' && h != null && h.healthy !== null) return false
      }
      return true
    })
  }, [displayServers, serverSearch, statusFilter, serverAliases, getHealthStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    monitoredServers, serverAliases, prefsLoaded, saved, hasChanges,
    bulkOpen, setBulkOpen, bulkText, setBulkText,
    logsServerUrl, setLogsServerUrl,
    addServerOpen, setAddServerOpen,
    workflowsServerUrl, setWorkflowsServerUrl,
    displayServers, filteredServers,
    serverSearch, setServerSearch,
    statusFilter, setStatusFilter,
    statusCounts,
    duplicateUrls,
    queueDepths,
    getHealthStatus,
    checkAllServers: handleCheckAllServers,
    checkServer: handleCheckServer,
    isChecking,
    workflowCountPerServer,
    workflows,
    handleSave, handleAddServerConfirm, handleBulkAdd,
    handleRemoveServer, handleServerUrlChange, handleServerAliasChange,
  }
}
