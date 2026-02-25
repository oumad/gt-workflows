import { Router } from 'express';

const LOGS_TIMEOUT_MS = 10000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const HEALTH_CHECK_ENDPOINTS = [
  { path: '/system_stats', name: 'system_stats', method: 'GET' },
  { path: '/queue', name: 'queue', method: 'GET' },
  { path: '/object_info', name: 'object_info', method: 'POST' },
];

export function createServersRouter() {
  const router = Router();

  router.get('/servers/logs', async (req, res) => {
    try {
      const rawUrl = req.query.url;
      if (!rawUrl || typeof rawUrl !== 'string') {
        return res.status(400).json({ error: 'Server URL (url) is required' });
      }
      const base = rawUrl.trim().replace(/\/$/, '');
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid server URL' });
      }
      const urlsToTry = [`${base}/internal/logs/raw`, `${base}/internal/logs`];
      let lastError = null;
      for (const logUrl of urlsToTry) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), LOGS_TIMEOUT_MS);
          const response = await fetch(logUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: { Accept: 'text/plain, text/html, */*' },
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            lastError = `Logs endpoint returned ${response.status}`;
            continue;
          }
          const contentType = response.headers.get('content-type') || '';
          const text = await response.text();
          const isHtml = contentType.includes('text/html');
          return res.json({ content: text, contentType: isHtml ? 'text/html' : 'text/plain' });
        } catch (err) {
          lastError = err.message || 'Failed to fetch logs';
          continue;
        }
      }
      res.status(502).json({ error: lastError || 'Could not load logs' });
    } catch (error) {
      console.error('Error fetching server logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/servers/health-check', async (req, res) => {
    try {
      const { serverUrl } = req.body;
      if (!serverUrl) {
        return res.status(400).json({ error: 'Server URL is required' });
      }
      const normalizedUrl = serverUrl.replace(/\/$/, '');
      let lastError = null;
      let lastStatus = null;

      for (let i = 0; i < HEALTH_CHECK_ENDPOINTS.length; i++) {
        const endpoint = HEALTH_CHECK_ENDPOINTS[i];
        const healthCheckUrl = `${normalizedUrl}${endpoint.path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

        try {
          if (i > 0) {
            await new Promise((r) => setTimeout(r, 100));
          }
          const fetchOptions = {
            method: endpoint.method,
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          };
          if (endpoint.method === 'POST') {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify({});
          }
          const response = await fetch(healthCheckUrl, fetchOptions);
          clearTimeout(timeoutId);
          lastStatus = response.status;
          if (response.status >= 400) {
            console.log(`[Health Check] ${endpoint.name} returned ${response.status} for ${normalizedUrl}`);
          }
          if (response.status < 500) {
            const isHealthy = response.status >= 200 && response.status < 400;
            return res.json({
              healthy: isHealthy,
              serverUrl: normalizedUrl,
              status: response.status,
              endpoint: endpoint.name,
              timestamp: new Date().toISOString(),
              ...(response.status >= 400 && response.status < 500
                ? { warning: `Endpoint returned ${response.status}, server may require authentication or endpoint may not be available` }
                : {}),
            });
          }
          lastError = `Server returned status ${response.status} from ${endpoint.name}`;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            lastError = `Timeout checking ${endpoint.name} (3s timeout)`;
          } else {
            const errorMsg = fetchError.message || 'Connection failed';
            const errorCode = fetchError.code || '';
            if (errorCode && (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND')) {
              console.error(`[Health Check] Connection error for ${normalizedUrl}: ${errorMsg}`);
            }
            if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
              lastError = `Cannot connect to server: ${errorMsg}`;
            } else if (errorMsg.includes('fetch failed') || errorMsg.includes('network')) {
              lastError = `Network error: ${errorMsg}`;
            } else {
              lastError = `${endpoint.name}: ${errorMsg}`;
            }
          }
        }
      }

      res.json({
        healthy: false,
        serverUrl: normalizedUrl,
        error: lastError || 'All health check endpoints failed',
        lastStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error checking server health:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
