import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchWithAuth } from '@/utils/auth'

export interface ServerHealthStatus {
  serverUrl: string;
  healthy: boolean | null; // null = checking, true = healthy, false = unhealthy
  error?: string;
  lastChecked?: string;
}

interface UseServerHealthCheckOptions {
  checkInterval?: number; // in seconds, default 6
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
  const checkingServersRef = useRef<Set<string>>(new Set());

  // Keep module-level cache in sync with state
  useEffect(() => {
    for (const [k, v] of healthStatuses) {
      healthStatusCache.set(k, v)
    }
  }, [healthStatuses])

  const HEALTH_CHECK_TIMEOUT_MS = 15000; // 15s per server so one slow server doesn't block Check All

  // Check health of a single server (optional signal for timeout/abort)
  const checkServerHealth = useCallback(async (serverUrl: string, signal?: AbortSignal): Promise<ServerHealthStatus> => {
    try {
      const response = await fetchWithAuth('/api/servers/health-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ serverUrl }),
        signal,
      });

      // Always try to parse the response, even if status is not ok
      // The backend returns health status in the body regardless of HTTP status
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        // If we can't parse JSON, it's a real error
        throw new Error(`Failed to parse response: ${response.statusText}`);
      }

      // Backend always returns 200 with health status in body
      // But check response.ok just in case
      return {
        serverUrl,
        healthy: data.healthy === true,
        error: data.error,
        lastChecked: data.timestamp || new Date().toISOString(),
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

  // Check all unique servers
  const checkAllServers = useCallback(async () => {
    if (!enabled || serverUrls.length === 0) {
      return
    }

    const uniqueServers = Array.from(new Set(serverUrls.filter(Boolean)));
    if (uniqueServers.length === 0) {
      return
    }

    // Filter out servers that are currently being checked
    const serversToCheck = uniqueServers.filter(
      (url) => !checkingServersRef.current.has(url)
    );

    if (serversToCheck.length === 0) return;

    setIsChecking(true);

    // Mark servers as being checked
    serversToCheck.forEach((url) => checkingServersRef.current.add(url));

    // Set status to checking for servers being checked
    setHealthStatuses((prev) => {
      const newMap = new Map(prev);
      serversToCheck.forEach((url) => {
        if (!newMap.has(url) || newMap.get(url)?.healthy !== null) {
          newMap.set(url, {
            serverUrl: url,
            healthy: null, // checking
          });
        }
      });
      return newMap;
    });

    // Run checks with limited concurrency (4 at a time) and per-request timeout so one slow server doesn't hang the UI
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
              error: isTimeout ? `Request timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : errorMessage,
              lastChecked: new Date().toISOString(),
            });
            return newMap;
          });
        } finally {
          checkingServersRef.current.delete(url);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, serversToCheck.length) }, () => runOne()));

    setIsChecking(false);
  }, [serverUrls, enabled, checkServerHealth]);

  // Manual health checks only - no automatic polling
  // Users can trigger checks manually via checkAllServers function

  // Get health status for a specific server
  const getHealthStatus = useCallback(
    (serverUrl: string): ServerHealthStatus | undefined => {
      return healthStatuses.get(serverUrl);
    },
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
          error: isTimeout ? `Request timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : (err instanceof Error ? err.message : 'Unknown error'),
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
    checkAllServers,
    checkServer,
  };
}

