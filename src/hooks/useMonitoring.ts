import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getMonitoringConfig, patchMonitoringConfig, triggerMonitoringCheck,
  type MonitoringConfig,
} from '@/services/api/servers'

export type { MonitoringConfig }

export function useMonitoring() {
  const [config, setConfig] = useState<MonitoringConfig | null>(null)
  const [checking, setChecking] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      setConfig(await getMonitoringConfig())
    } catch { /* ignore — monitoring may not be available */ }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll every 30 s when there are watched servers
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (!config?.watchedServers.length) return
    pollRef.current = setInterval(load, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [config?.watchedServers.length, load])

  const toggleWatched = useCallback(async (url: string) => {
    if (!config) return
    const normalized = url.replace(/\/$/, '')
    const isWatched = config.watchedServers.some((u) => u.replace(/\/$/, '') === normalized)
    const next = isWatched
      ? config.watchedServers.filter((u) => u.replace(/\/$/, '') !== normalized)
      : [...config.watchedServers, normalized]
    // Optimistic update
    setConfig((c) => c ? { ...c, watchedServers: next } : c)
    try {
      setConfig(await patchMonitoringConfig({ watchedServers: next }))
    } catch {
      // Revert on failure
      setConfig((c) => c ? { ...c, watchedServers: config.watchedServers } : c)
    }
  }, [config])

  const updateInterval = useCallback(async (intervalSeconds: number) => {
    try { setConfig(await patchMonitoringConfig({ intervalSeconds })) } catch {}
  }, [])

  const checkNow = useCallback(async () => {
    setChecking(true)
    try { setConfig(await triggerMonitoringCheck()) } finally { setChecking(false) }
  }, [])

  const isWatched = useCallback((url: string) => {
    if (!config) return false
    const n = url.replace(/\/$/, '')
    return config.watchedServers.some((u) => u.replace(/\/$/, '') === n)
  }, [config])

  const getServerStatus = useCallback((url: string) => {
    if (!config) return null
    const n = url.replace(/\/$/, '')
    return config.status[n] ?? null
  }, [config])

  return { config, checking, toggleWatched, updateInterval, checkNow, reload: load, isWatched, getServerStatus }
}
