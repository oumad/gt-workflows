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

const AUTO_INTERVALS = [5, 30, 60, 300, null] as const
export type AutoInterval = 5 | 30 | 60 | 300 | null

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
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [addServerOpen, setAddServerOpen] = useState(false)
  const [workflowsServerUrl, setWorkflowsServerUrl] = useState<string | null>(null)
  const [serverSearch, setServerSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [queueDepths, setQueueDepths] = useState<Record<string, QueueDepth>>({})
  const [serverGroups, setServerGroups] = useState<Record<string, string[]>>({})
  const [savedGroups, setSavedGroups] = useState<Record<string, string[]>>({})
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('default')
  const [autoInterval, setAutoInterval] = useState<AutoInterval>(null)

  const cycleAutoInterval = useCallback(() => {
    setAutoInterval((cur) => {
      const idx = AUTO_INTERVALS.indexOf(cur)
      return AUTO_INTERVALS[(idx + 1) % AUTO_INTERVALS.length]
    })
  }, [])

  const { workflows } = useWorkflows()
  const displayServers = useMemo(
    () => (!prefsLoaded ? getSettings().monitoredServers : monitoredServers),
    [prefsLoaded, monitoredServers],
  )
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

  // Auto-check health at the selected interval
  useEffect(() => {
    if (!autoInterval || displayServers.length === 0) return
    const id = setInterval(() => { handleCheckAllServersRef.current() }, autoInterval * 1000)
    return () => clearInterval(id)
  }, [autoInterval, displayServers.length])

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
    groups: Record<string, string[]> = serverGroups,
  ) => {
    try {
      await updatePreferences({ monitoredServers: servers, serverAliases: aliases, serverGroups: groups })
      setSavedServers(servers)
      setSavedAliases(aliases)
      setSavedGroups(groups)
      invalidatePreferences()
      window.dispatchEvent(new Event('settingsUpdated'))
    } catch {
      // leave saved baseline unchanged so the button stays enabled for retry
    }
  }

  const handleAddServerConfirm = async (result: { url: string; name?: string; tags?: string[] }) => {
    const { url, name, tags } = result
    setAddServerOpen(false)
    if (!monitoredServers.includes(url)) {
      const newServers = [...monitoredServers, url]
      const newAliases = name ? { ...serverAliases, [url]: name } : serverAliases
      const norm = url.replace(/\/$/, '')
      const newGroups = tags && tags.length > 0 ? { ...serverGroups, [norm]: tags } : serverGroups
      setMonitoredServers(newServers)
      setServerAliases(newAliases)
      setServerGroups(newGroups)
      await handleSave(newServers, newAliases, newGroups)
    }
  }

  const handleExport = () => {
    const entries = monitoredServers.map((url) => {
      const norm = url.replace(/\/$/, '')
      const entry: { url: string; name?: string; tags?: string[] } = { url }
      if (serverAliases[url]) entry.name = serverAliases[url]
      if (serverGroups[norm]?.length) entry.tags = serverGroups[norm]
      return entry
    })
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'servers.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handleImport = async (entries: { url: string; name?: string; tags?: string[] }[]) => {
    const newServers: string[] = []
    const newAliases: Record<string, string> = {}
    const newGroups: Record<string, string[]> = {}
    const seen = new Set<string>()
    for (const entry of entries) {
      const url = normalizeServerUrl(entry.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      newServers.push(url)
      if (entry.name?.trim()) newAliases[url] = entry.name.trim()
      const tags = entry.tags?.filter((t) => t.trim()) ?? []
      if (tags.length > 0) newGroups[url.replace(/\/$/, '')] = tags
    }
    setMonitoredServers(newServers)
    setServerAliases(newAliases)
    setServerGroups(newGroups)
    await handleSave(newServers, newAliases, newGroups)
  }

  const handleEditServer = async (oldUrl: string, result: { url: string; name?: string; tags?: string[] }) => {
    const { url: newUrl, name, tags } = result
    const index = monitoredServers.indexOf(oldUrl)
    if (index < 0) return
    const newServers = [...monitoredServers]
    newServers[index] = newUrl
    const oldNorm = oldUrl.replace(/\/$/, '')
    const newNorm = newUrl.replace(/\/$/, '')
    const newAliases = { ...serverAliases }
    delete newAliases[oldUrl]
    if (name) newAliases[newUrl] = name
    const newGroups = { ...serverGroups }
    delete newGroups[oldNorm]
    if (tags && tags.length > 0) newGroups[newNorm] = tags
    setMonitoredServers(newServers)
    setServerAliases(newAliases)
    setServerGroups(newGroups)
    await handleSave(newServers, newAliases, newGroups)
  }

  const handleRemoveServer = (index: number) => {
    const url = monitoredServers[index]
    const norm = url.replace(/\/$/, '')
    setMonitoredServers(monitoredServers.filter((_, i) => i !== index))
    const nextAliases = { ...serverAliases }
    delete nextAliases[url]
    setServerAliases(nextAliases)
    const nextGroups = { ...serverGroups }
    delete nextGroups[norm]
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

  const handleServerGroupChange = (url: string, tags: string[]) => {
    setServerGroups((prev) => {
      const next = { ...prev }
      if (tags.length > 0) next[url] = tags
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
      const tags = serverGroups[norm] ?? serverGroups[url] ?? []
      for (const t of tags) if (t) groups.add(t)
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
        const tags = serverGroups[norm] ?? serverGroups[server] ?? []
        if (!tags.includes(groupFilter)) return false
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
    monitoredServers, serverAliases, serverGroups, prefsLoaded,
    logsServerUrl, setLogsServerUrl,
    addServerOpen, setAddServerOpen,
    workflowsServerUrl, setWorkflowsServerUrl,
    displayServers, filteredServers,
    serverSearch, setServerSearch,
    statusFilter, setStatusFilter,
    groupFilter, setGroupFilter,
    uniqueGroups,
    sortBy, setSortBy,
    autoInterval, cycleAutoInterval,
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
    handleSave, handleAddServerConfirm, handleEditServer, handleExport, handleImport,
    handleRemoveServer, handleReorder,
  }
}
