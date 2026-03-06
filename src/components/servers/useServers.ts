import { useState, useEffect, useMemo } from 'react'
import { getSettings } from '@/utils/settings'
import { getPreferences, updatePreferences } from '@/services/api/preferences'
import { useServerHealthCheck } from '@/hooks/useServerHealthCheck'
import { useWorkflows } from '@/hooks/useWorkflows'
import { getServerUrls } from '@/utils/serverUrl'

// Module-level cache — survives component unmount/remount (tab switches)
let serverPrefsCache: { monitoredServers: string[]; serverAliases: Record<string, string> } | null = null

export function normalizeServerUrl(s: string): string {
  let u = s.trim()
  if (!u) return ''
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`
  return u.replace(/\/$/, '')
}

export function useServers() {
  const [monitoredServers, setMonitoredServers] = useState<string[]>(serverPrefsCache?.monitoredServers ?? [])
  const [serverAliases, setServerAliases] = useState<Record<string, string>>(serverPrefsCache?.serverAliases ?? {})
  const [savedServers, setSavedServers] = useState<string[]>(serverPrefsCache?.monitoredServers ?? [])
  const [savedAliases, setSavedAliases] = useState<Record<string, string>>(serverPrefsCache?.serverAliases ?? {})
  const [prefsLoaded, setPrefsLoaded] = useState(serverPrefsCache !== null)
  const [saved, setSaved] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [logsServerUrl, setLogsServerUrl] = useState<string | null>(null)
  const [addServerOpen, setAddServerOpen] = useState(false)

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

  return {
    monitoredServers, serverAliases, prefsLoaded, saved, hasChanges,
    bulkOpen, setBulkOpen, bulkText, setBulkText,
    logsServerUrl, setLogsServerUrl,
    addServerOpen, setAddServerOpen,
    displayServers, getHealthStatus, checkAllServers, checkServer, isChecking,
    workflowCountPerServer,
    handleSave, handleAddServerConfirm, handleBulkAdd,
    handleRemoveServer, handleServerUrlChange, handleServerAliasChange,
  }
}
