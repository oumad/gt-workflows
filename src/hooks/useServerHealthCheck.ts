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

  // Check health of a single server
  const checkServerHealth = useCallback(async (serverUrl: string): Promise<ServerHealthStatus> => {
    try {
      const response = await fetchWithAuth('/api/servers/health-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ serverUrl }),
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

    // Check servers sequentially with a small delay to avoid overwhelming the server
    // This prevents "fetch failed" errors from too many concurrent requests
    const results: ServerHealthStatus[] = [];
    for (let i = 0; i < serversToCheck.length; i++) {
      const url = serversToCheck[i];
      const result = await checkServerHealth(url);
      results.push(result);
      
      // Add a small delay between checks (except for the last one)
      if (i < serversToCheck.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
      }
    }

    // Update statuses
    setHealthStatuses((prev) => {
      const newMap = new Map(prev);
      results.forEach((result) => {
        newMap.set(result.serverUrl, result);
      });
      return newMap;
    });

    // Remove from checking set
    serversToCheck.forEach((url) => checkingServersRef.current.delete(url));
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
    const result = await checkServerHealth(serverUrl)
    checkingServersRef.current.delete(serverUrl)
    setHealthStatuses((prev) => {
      const newMap = new Map(prev)
      newMap.set(serverUrl, result)
      return newMap
    })
  }, [checkServerHealth])

  return {
    healthStatuses: Array.from(healthStatuses.values()),
    getHealthStatus,
    isChecking,
    checkAllServers,
    checkServer,
  };
}

