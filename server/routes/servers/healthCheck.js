import { Router } from 'express';

const LOGS_TIMEOUT_MS = 10000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const HEALTH_CHECK_ENDPOINTS = [
  { path: '/system_stats', name: 'system_stats', method: 'GET' },
  { path: '/queue', name: 'queue', method: 'GET' },
  { path: '/object_info', name: 'object_info', method: 'POST' },
];

function parseGpuName(rawName) {
  if (!rawName || typeof rawName !== 'string') return undefined;
  // e.g. "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" -> "NVIDIA GeForce RTX 4090"
  const cleaned = rawName.replace(/^[^:]+:\d+\s+/, '').replace(/\s*:[^:]*$/, '').trim();
  return cleaned || undefined;
}

export function createHealthCheckRouter() {
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
          if (!response.ok) { lastError = `Logs endpoint returned ${response.status}`; continue; }
          const contentType = response.headers.get('content-type') || '';
          const text = await response.text();
          return res.json({ content: text, contentType: contentType.includes('text/html') ? 'text/html' : 'text/plain' });
        } catch (err) {
          lastError = err.message || 'Failed to fetch logs';
        }
      }
      res.status(502).json({ error: lastError || 'Could not load logs' });
    } catch (error) {
      console.error('Error fetching server logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/servers/queue-depth', async (req, res) => {
    try {
      const rawUrl = req.query.url
      if (!rawUrl || typeof rawUrl !== 'string') {
        return res.status(400).json({ error: 'Server URL (url) is required' })
      }
      const base = rawUrl.trim().replace(/\/$/, '')
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid server URL' })
      }
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      try {
        const response = await fetch(`${base}/queue`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        clearTimeout(timeoutId)
        if (!response.ok) {
          return res.status(502).json({ error: `Server returned ${response.status}` })
        }
        const data = await response.json()
        res.json({
          running: Array.isArray(data.queue_running) ? data.queue_running.length : 0,
          pending: Array.isArray(data.queue_pending) ? data.queue_pending.length : 0,
        })
      } catch (fetchError) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          return res.status(504).json({ error: 'Request timed out' })
        }
        res.status(502).json({ error: fetchError.message || 'Failed to fetch queue' })
      }
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.post('/servers/health-check', async (req, res) => {
    try {
      const { serverUrl } = req.body;
      if (!serverUrl || typeof serverUrl !== 'string') {
        return res.status(400).json({ error: 'Server URL is required' });
      }
      const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid server URL' });
      }
      let lastError = null;
      let lastStatus = null;

      for (let i = 0; i < HEALTH_CHECK_ENDPOINTS.length; i++) {
        const endpoint = HEALTH_CHECK_ENDPOINTS[i];
        const healthCheckUrl = `${normalizedUrl}${endpoint.path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
        try {
          if (i > 0) await new Promise((r) => setTimeout(r, 100));
          const fetchOptions = {
            method: endpoint.method,
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          };
          if (endpoint.method === 'POST') {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify({});
          }
          const startMs = Date.now();
          const response = await fetch(healthCheckUrl, fetchOptions);
          clearTimeout(timeoutId);
          const latencyMs = Date.now() - startMs;
          lastStatus = response.status;
          if (response.status >= 400) {
            console.log(`[Health Check] ${endpoint.name} returned ${response.status} for ${normalizedUrl}`);
          }
          if (response.status < 500) {
            const isHealthy = response.status >= 200 && response.status < 400;
            let systemInfo = null;
            if (endpoint.name === 'system_stats' && isHealthy) {
              try {
                const statsData = await response.json();
                const device = Array.isArray(statsData.devices) ? statsData.devices[0] : null;
                systemInfo = {
                  comfyVersion: typeof statsData.system?.comfyui_version === 'string' ? statsData.system.comfyui_version : undefined,
                  gpuName: device ? parseGpuName(device.name) : undefined,
                  vramTotal: typeof device?.vram_total === 'number' ? device.vram_total : undefined,
                  vramFree: typeof device?.vram_free === 'number' ? device.vram_free : undefined,
                };
              } catch { /* ignore parse errors */ }
            }
            return res.json({
              healthy: isHealthy,
              serverUrl: normalizedUrl,
              status: response.status,
              endpoint: endpoint.name,
              timestamp: new Date().toISOString(),
              latencyMs,
              ...(systemInfo ? { systemInfo } : {}),
              ...(response.status >= 400 && response.status < 500
                ? { warning: `Endpoint returned ${response.status}, server may require authentication or endpoint may not be available` }
                : {}),
            });
          }
          let errDetail = '';
          try { const bodyText = await response.text(); if (bodyText) errDetail = ` — ${bodyText.slice(0, 200)}`; } catch { /* ignore */ }
          lastError = `${endpoint.name} returned HTTP ${response.status}${errDetail}`;
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

  router.post('/servers/restart', async (req, res) => {
    try {
      const { serverUrl } = req.body;
      if (!serverUrl || typeof serverUrl !== 'string') {
        return res.status(400).json({ error: 'Server URL is required' });
      }
      const base = serverUrl.trim().replace(/\/$/, '');
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid server URL' });
      }
      // ComfyUI Manager reboot endpoint (no /api/ prefix)
      const rebootUrl = `${base}/manager/reboot`;
      console.log(`[Restart] Sending reboot to ${rebootUrl}`);
      // Put server in maintenance mode for 5 min to suppress monitoring alerts
      const { monitoringService } = await import('../../lib/monitoringService.js');
      monitoringService.setMaintenance(base, 5 * 60_000);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(rebootUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        console.log(`[Restart] ${base} responded with HTTP ${response.status}`);
        if (!response.ok) {
          monitoringService.clearMaintenance(base);
          const body = await response.text().catch(() => '');
          console.error(`[Restart] Reboot failed for ${base}: HTTP ${response.status} — ${body.slice(0, 200)}`);
          return res.status(502).json({ error: `ComfyUI returned HTTP ${response.status}`, detail: body.slice(0, 200) });
        }
        return res.json({ ok: true, status: response.status });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          monitoringService.clearMaintenance(base);
          console.error(`[Restart] Timed out waiting for ${base}`);
          return res.status(504).json({ error: 'Request timed out after 120s' });
        }
        const msg = fetchErr.message || '';
        // Connection reset/closed is expected — the server is restarting
        if (msg.includes('ECONNRESET') || msg.includes('socket hang up') || msg.includes('UND_ERR_SOCKET')) {
          console.log(`[Restart] ${base} closed connection — likely restarting`);
          return res.json({ ok: true, status: 0, note: 'Connection closed — server is restarting' });
        }
        monitoringService.clearMaintenance(base);
        console.error(`[Restart] Fetch error for ${base}: ${msg}`);
        return res.status(502).json({ error: msg || 'Failed to reach server' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
