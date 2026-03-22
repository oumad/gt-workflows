import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchWithAuth } from '@/utils/auth'

export interface ServerSystemInfo {
  comfyVersion?: string
  gpuName?: string
  vramTotal?: number
  vramFree?: number
}

export interface ServerHealthStatus {
  serverUrl: string;
  healthy: boolean | null; // null = checking, true = healthy, false = unhealthy
  error?: string;
  lastChecked?: string;
  latencyMs?: number;
  systemInfo?: ServerSystemInfo;
}

export interface CheckProgress {
  checked: number
  total: number
}

interface UseServerHealthCheckOptions {
  enabled?: boolean;
}

// Module-level cache — survives component unmount/remount (tab switches)
const healthStatusCache = new Map<string, ServerHealthStatus>()

export function useServerHealthCheck(
  serverUrls: string[],
  options: UseServerHealthCheckOptions = {}
) {
  const { enabled = true } = options;
  const [healthStatuses, setHealthStatuses] = useState<Map<string, ServerHealthStatus>>(
    () => new Map(healthStatusCache)
  );
  const [isChecking, setIsChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<CheckProgress | null>(null);
  const checkingServersRef = useRef<Set<string>>(new Set());
  const checkedCountRef = useRef(0);

  // Keep module-level cache in sync with state
  useEffect(() => {
    for (const [k, v] of healthStatuses) {
      healthStatusCache.set(k, v)
    }
  }, [healthStatuses])

  const HEALTH_CHECK_TIMEOUT_MS = 15000;

  const checkServerHealth = useCallback(async (serverUrl: string, signal?: AbortSignal): Promise<ServerHealthStatus> => {
    try {
      const response = await fetchWithAuth('/api/servers/health-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl }),
        signal,
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Failed to parse response: ${response.statusText}`);
      }
      return {
        serverUrl,
        healthy: data.healthy === true,
        error: data.error,
        lastChecked: data.timestamp || new Date().toISOString(),
        latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
        systemInfo: data.systemInfo ?? undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        serverUrl,
        healthy: false,
        error: errorMessage,
        lastChecked: new Date().toISOString(),
      };
    }
  }, []);

  const checkAllServers = useCallback(async () => {
    if (!enabled || serverUrls.length === 0) return

    const uniqueServers = Array.from(new Set(serverUrls.filter(Boolean)));
    if (uniqueServers.length === 0) return

    const serversToCheck = uniqueServers.filter(url => !checkingServersRef.current.has(url));
    if (serversToCheck.length === 0) return;

    setIsChecking(true);
    checkedCountRef.current = 0;
    setCheckProgress({ checked: 0, total: serversToCheck.length });

    serversToCheck.forEach((url) => checkingServersRef.current.add(url));

    setHealthStatuses((prev) => {
      const newMap = new Map(prev);
      serversToCheck.forEach((url) => {
        if (!newMap.has(url) || newMap.get(url)?.healthy !== null) {
          newMap.set(url, { serverUrl: url, healthy: null });
        }
      });
      return newMap;
    });

    const CONCURRENCY = 4;
    let nextIndex = 0;

    const runOne = async (): Promise<void> => {
      while (nextIndex < serversToCheck.length) {
        const url = serversToCheck[nextIndex++];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
        try {
          const result = await checkServerHealth(url, controller.signal);
          clearTimeout(timeoutId);
          setHealthStatuses((prev) => {
            const newMap = new Map(prev);
            newMap.set(result.serverUrl, result);
            return newMap;
          });
        } catch (err) {
          clearTimeout(timeoutId);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          const isTimeout = err instanceof Error && err.name === 'AbortError';
          setHealthStatuses((prev) => {
            const newMap = new Map(prev);
            newMap.set(url, {
              serverUrl: url,
              healthy: false,
              error: isTimeout ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : errorMessage,
              lastChecked: new Date().toISOString(),
            });
            return newMap;
          });
        } finally {
          checkingServersRef.current.delete(url);
          checkedCountRef.current += 1;
          setCheckProgress({ checked: checkedCountRef.current, total: serversToCheck.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, serversToCheck.length) }, () => runOne()));

    setIsChecking(false);
    setCheckProgress(null);
  }, [serverUrls, enabled, checkServerHealth]);

  const getHealthStatus = useCallback(
    (serverUrl: string): ServerHealthStatus | undefined => healthStatuses.get(serverUrl),
    [healthStatuses]
  );

  const checkServer = useCallback(async (serverUrl: string): Promise<void> => {
    if (checkingServersRef.current.has(serverUrl)) return
    checkingServersRef.current.add(serverUrl)
    setHealthStatuses((prev) => {
      const newMap = new Map(prev)
      newMap.set(serverUrl, { serverUrl, healthy: null })
      return newMap
    })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)
    try {
      const result = await checkServerHealth(serverUrl, controller.signal)
      clearTimeout(timeoutId)
      setHealthStatuses((prev) => {
        const newMap = new Map(prev)
        newMap.set(serverUrl, result)
        return newMap
      })
    } catch (err) {
      clearTimeout(timeoutId)
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      setHealthStatuses((prev) => {
        const newMap = new Map(prev)
        newMap.set(serverUrl, {
          serverUrl,
          healthy: false,
          error: isTimeout ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : (err instanceof Error ? err.message : 'Unknown error'),
          lastChecked: new Date().toISOString(),
        })
        return newMap
      })
    } finally {
      checkingServersRef.current.delete(serverUrl)
    }
  }, [checkServerHealth])

  return {
    healthStatuses: Array.from(healthStatuses.values()),
    getHealthStatus,
    isChecking,
    checkProgress,
    checkAllServers,
    checkServer,
  };
}
