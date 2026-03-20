import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { getSettings } from '@/utils/settings'
import { updatePreferences } from '@/services/api/preferences'
import { usePreferences } from '@/hooks/usePreferences'
import { useServerHealthCheck } from '@/hooks/useServerHealthCheck'
import { useWorkflows } from '@/hooks/useWorkflows'
import { getServerUrls } from '@/utils/serverUrl'
import { fetchQueueDepth, type QueueDepth } from '@/services/api/servers'

export type StatusFilter = 'all' | 'healthy' | 'unhealthy' | 'unchecked'
export type SortBy = 'default' | 'name' | 'status' | 'latency'

// Status priority for sort: needs-attention first
const STATUS_SORT_ORDER = (healthy: boolean | null | undefined): number => {
  if (healthy === false) return 0   // unhealthy — needs attention now
  if (healthy === null) return 1    // checking
  if (healthy === undefined) return 2 // unchecked
  return 3                          // healthy
}

export function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    if (!u.includes('://')) u = `http://${u}`
  }
  return u.replace(/\/$/, '')
}

export function hasInvalidScheme(url: string): boolean {
  const u = url.trim()
  if (!u || !u.includes('://')) return false
  return !u.startsWith('http://') && !u.startsWith('https://')
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
  const [serverGroups, setServerGroups] = useState<Record<string, string>>({})
  const [savedGroups, setSavedGroups] = useState<Record<string, string>>({})
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('default')
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false)

  const hasChanges = useMemo(() => {
    if (monitoredServers.length !== savedServers.length) return true
    if (monitoredServers.some((v, i) => v !== savedServers[i])) return true
    const ak = Object.keys(serverAliases), sk = Object.keys(savedAliases)
    if (ak.length !== sk.length) return true
    if (ak.some((k) => serverAliases[k] !== savedAliases[k])) return true
    const gk = Object.keys(serverGroups), sgk = Object.keys(savedGroups)
    if (gk.length !== sgk.length) return true
    return gk.some((k) => serverGroups[k] !== savedGroups[k])
  }, [monitoredServers, savedServers, serverAliases, savedAliases, serverGroups, savedGroups])

  const { workflows } = useWorkflows()
  const displayServers = !prefsLoaded ? getSettings().monitoredServers : monitoredServers
  const { getHealthStatus, checkAllServers, checkServer, isChecking, checkProgress } = useServerHealthCheck(displayServers, { enabled: true })

  useEffect(() => {
    if (!preferences || prefsInitialized.current) return
    prefsInitialized.current = true
    const list = preferences.monitoredServers ?? getSettings().monitoredServers
    const aliases = preferences.serverAliases ?? {}
    const groups = preferences.serverGroups ?? {}
    setMonitoredServers(list)
    setServerAliases(aliases)
    setServerGroups(groups)
    setSavedServers(list)
    setSavedAliases(aliases)
    setSavedGroups(groups)
    setPrefsLoaded(true)
  }, [preferences])

  // Stable refs so polling intervals don't reset on every render
  const getHealthStatusRef = useRef(getHealthStatus)
  useEffect(() => { getHealthStatusRef.current = getHealthStatus }, [getHealthStatus])

  const handleCheckAllServersRef = useRef<() => Promise<void>>(async () => {})

  // Auto-poll queue depths for healthy servers every 30 seconds
  useEffect(() => {
    if (displayServers.length === 0) return
    const poll = () => {
      const urls = [...new Set(displayServers.map((s) => s.replace(/\/$/, '')))]
      for (const url of urls) {
        if (getHealthStatusRef.current(url)?.healthy === true) {
          fetchQueueDepth(url)
            .then((depth) => setQueueDepths((prev) => ({ ...prev, [url]: depth })))
            .catch(() => {})
        }
      }
    }
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [displayServers])

  // Auto-check health every 5 minutes when enabled
  useEffect(() => {
    if (!autoCheckEnabled || displayServers.length === 0) return
    const id = setInterval(() => { handleCheckAllServersRef.current() }, 5 * 60_000)
    return () => clearInterval(id)
  }, [autoCheckEnabled, displayServers.length])

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [saved])

  const handleCheckServer = useCallback(async (url: string) => {
    await checkServer(url)
    fetchQueueDepth(url)
      .then((depth) => setQueueDepths((prev) => ({ ...prev, [url]: depth })))
      .catch(() => {})
  }, [checkServer])

  const handleCheckAllServers = useCallback(async () => {
    await checkAllServers()
    const uniqueUrls = [...new Set(displayServers.map((s) => s.replace(/\/$/, '')))]
    for (const url of uniqueUrls) {
      fetchQueueDepth(url)
        .then((depth) => setQueueDepths((prev) => ({ ...prev, [url]: depth })))
        .catch(() => {})
    }
  }, [checkAllServers, displayServers])

  // Keep ref in sync for auto-check interval
  useEffect(() => { handleCheckAllServersRef.current = handleCheckAllServers }, [handleCheckAllServers])

  const handleSave = async (
    servers: string[] = monitoredServers,
    aliases: Record<string, string> = serverAliases,
    groups: Record<string, string> = serverGroups,
  ) => {
    try {
      await updatePreferences({ monitoredServers: servers, serverAliases: aliases, serverGroups: groups })
      setSavedServers(servers)
      setSavedAliases(aliases)
      setSavedGroups(groups)
      setSaved(true)
      invalidatePreferences()
      window.dispatchEvent(new Event('settingsUpdated'))
    } catch {
      // leave saved baseline unchanged so the button stays enabled for retry
    }
  }

  const handleAddServerConfirm = async (result: { url: string; name?: string; group?: string }) => {
    const { url, name, group } = result
    setAddServerOpen(false)
    if (!monitoredServers.includes(url)) {
      const newServers = [...monitoredServers, url]
      const newAliases = name ? { ...serverAliases, [url]: name } : serverAliases
      const newGroups = group ? { ...serverGroups, [url]: group } : serverGroups
      setMonitoredServers(newServers)
      setServerAliases(newAliases)
      setServerGroups(newGroups)
      await handleSave(newServers, newAliases, newGroups)
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
    const nextAliases = { ...serverAliases }
    delete nextAliases[url]
    setServerAliases(nextAliases)
    const nextGroups = { ...serverGroups }
    delete nextGroups[url]
    setServerGroups(nextGroups)
  }

  const handleServerUrlChange = (index: number, newUrl: string) => {
    const updated = [...monitoredServers]
    const oldUrl = monitoredServers[index]
    const normalized = newUrl.trim().replace(/\/$/, '')
    updated[index] = normalized
    setMonitoredServers(updated)
    if (serverAliases[oldUrl] && oldUrl !== normalized) {
      const nextAliases = { ...serverAliases }
      delete nextAliases[oldUrl]
      if (normalized) nextAliases[normalized] = serverAliases[oldUrl]
      setServerAliases(nextAliases)
    }
    if (serverGroups[oldUrl] && oldUrl !== normalized) {
      const nextGroups = { ...serverGroups }
      const group = nextGroups[oldUrl]
      delete nextGroups[oldUrl]
      if (normalized) nextGroups[normalized] = group
      setServerGroups(nextGroups)
    }
  }

  const handleServerGroupChange = (url: string, group: string) => {
    setServerGroups((prev) => {
      const next = { ...prev }
      if (group.trim()) next[url] = group.trim()
      else delete next[url]
      return next
    })
  }

  const handleServerAliasChange = (url: string, alias: string) => {
    setServerAliases((prev) => {
      const next = { ...prev }
      if (alias.trim()) next[url] = alias
      else delete next[url]
      return next
    })
  }

  // Drag-to-reorder: reorder monitoredServers and immediately persist
  const handleReorder = useCallback((activeId: string, overId: string) => {
    const activeIdx = monitoredServers.indexOf(activeId)
    const overIdx = monitoredServers.indexOf(overId)
    if (activeIdx < 0 || overIdx < 0 || activeIdx === overIdx) return
    const reordered = arrayMove(monitoredServers, activeIdx, overIdx)
    setMonitoredServers(reordered)
    setSavedServers(reordered)
    updatePreferences({ monitoredServers: reordered, serverAliases, serverGroups }).catch(() => {})
  }, [monitoredServers, serverAliases, serverGroups])

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

  const uniqueGroups = useMemo(() => {
    const groups = new Set<string>()
    for (const url of displayServers) {
      const norm = url.replace(/\/$/, '')
      const group = serverGroups[norm] || serverGroups[url]
      if (group) groups.add(group)
    }
    return Array.from(groups).sort()
  }, [displayServers, serverGroups])

  const filteredServers = useMemo(() => {
    const filtered = displayServers.filter((server) => {
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
      if (groupFilter !== null) {
        const group = serverGroups[norm] || serverGroups[server]
        if (group !== groupFilter) return false
      }
      return true
    })

    if (sortBy === 'default') return filtered

    return [...filtered].sort((a, b) => {
      const normA = a.replace(/\/$/, '')
      const normB = b.replace(/\/$/, '')
      if (sortBy === 'name') {
        const nameA = (serverAliases[normA] || normA.replace(/^https?:\/\//, '')).toLowerCase()
        const nameB = (serverAliases[normB] || normB.replace(/^https?:\/\//, '')).toLowerCase()
        return nameA.localeCompare(nameB)
      }
      if (sortBy === 'status') {
        return STATUS_SORT_ORDER(getHealthStatus(normA)?.healthy) - STATUS_SORT_ORDER(getHealthStatus(normB)?.healthy)
      }
      if (sortBy === 'latency') {
        const latA = getHealthStatus(normA)?.latencyMs ?? Infinity
        const latB = getHealthStatus(normB)?.latencyMs ?? Infinity
        return latA - latB
      }
      return 0
    })
  }, [displayServers, serverSearch, statusFilter, serverAliases, getHealthStatus, groupFilter, serverGroups, sortBy]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    monitoredServers, serverAliases, serverGroups, prefsLoaded, saved, hasChanges,
    bulkOpen, setBulkOpen, bulkText, setBulkText,
    logsServerUrl, setLogsServerUrl,
    addServerOpen, setAddServerOpen,
    workflowsServerUrl, setWorkflowsServerUrl,
    displayServers, filteredServers,
    serverSearch, setServerSearch,
    statusFilter, setStatusFilter,
    groupFilter, setGroupFilter,
    uniqueGroups,
    sortBy, setSortBy,
    autoCheckEnabled, setAutoCheckEnabled,
    statusCounts,
    duplicateUrls,
    queueDepths,
    getHealthStatus,
    checkAllServers: handleCheckAllServers,
    checkServer: handleCheckServer,
    isChecking,
    checkProgress,
    workflowCountPerServer,
    workflows,
    handleSave, handleAddServerConfirm, handleBulkAdd,
    handleRemoveServer, handleServerUrlChange, handleServerAliasChange, handleServerGroupChange, handleReorder,
  }
}
