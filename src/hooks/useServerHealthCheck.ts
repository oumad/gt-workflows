import { useState, useRef, useCallback } from 'react';

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

export function useServerHealthCheck(
  serverUrls: string[],
  options: UseServerHealthCheckOptions = {}
) {
  const { enabled = true } = options;
  const [healthStatuses, setHealthStatuses] = useState<Map<string, ServerHealthStatus>>(new Map());
  const [isChecking, setIsChecking] = useState(false);
  const checkingServersRef = useRef<Set<string>>(new Set());

  // Check health of a single server
  const checkServerHealth = useCallback(async (serverUrl: string): Promise<ServerHealthStatus> => {
    try {
      const response = await fetch('/api/servers/health-check', {
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
      if (!response.ok && !data.healthy) {
        console.error(`[Frontend] Health check failed for ${serverUrl}:`, data.error || response.statusText);
      }

      return {
        serverUrl,
        healthy: data.healthy === true,
        error: data.error,
        lastChecked: data.timestamp || new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Frontend] Health check error for ${serverUrl}:`, errorMessage, error);
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
      console.log('[Health Check] Skipping - enabled:', enabled, 'serverUrls.length:', serverUrls.length)
      return
    }

    // Get unique server URLs
    const uniqueServers = Array.from(new Set(serverUrls.filter(Boolean)));
    
    if (uniqueServers.length === 0) {
      console.log('[Health Check] No valid servers to check')
      return
    }

    console.log('[Health Check] Starting checks for', uniqueServers.length, 'server(s):', uniqueServers)

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

  return {
    healthStatuses: Array.from(healthStatuses.values()),
    getHealthStatus,
    isChecking,
    checkAllServers,
  };
}

