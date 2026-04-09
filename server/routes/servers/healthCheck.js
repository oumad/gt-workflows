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
        const firstRunning = Array.isArray(data.queue_running) ? data.queue_running[0] : null
        const runningJobName = firstRunning
          ? (firstRunning[3]?.extra_pnginfo?.workflow?.name || firstRunning[3]?.workflow_name || null)
          : null
        res.json({
          running: Array.isArray(data.queue_running) ? data.queue_running.length : 0,
          pending: Array.isArray(data.queue_pending) ? data.queue_pending.length : 0,
          runningJobName: runningJobName || null,
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

  /** Full ComfyUI queue with job details (IDs + prompt names where available). */
  router.get('/servers/comfy-queue', async (req, res) => {
    const rawUrl = req.query.url
    if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).json({ error: 'url is required' })
    const base = rawUrl.trim().replace(/\/$/, '')
    if (!base.startsWith('http://') && !base.startsWith('https://')) return res.status(400).json({ error: 'Invalid URL' })
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 6000)
    try {
      const r = await fetch(`${base}/queue`, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      clearTimeout(tid)
      if (!r.ok) return res.status(502).json({ error: `ComfyUI returned ${r.status}` })
      const data = await r.json()

      const mapEntry = (entry, idx) => {
        // ComfyUI queue entry: [number, prompt_id, prompt_obj, extra_data, outputs_to_execute]
        const promptId = Array.isArray(entry) ? String(entry[1] ?? '') : ''
        const promptObj = Array.isArray(entry) ? entry[2] : null
        // Try to extract a human-readable name from the prompt (GT stores workflow name in extra_pnginfo)
        let name = ''
        if (Array.isArray(entry) && entry[3]) {
          name = entry[3]?.extra_pnginfo?.workflow?.name || entry[3]?.workflow_name || ''
        }
        return { promptId, name: name || null, position: idx + 1 }
      }

      res.json({
        running: (data.queue_running || []).map((e, i) => mapEntry(e, i)),
        pending: (data.queue_pending || []).map((e, i) => mapEntry(e, i)),
      })
    } catch (err) {
      clearTimeout(tid)
      if (err.name === 'AbortError') return res.status(504).json({ error: 'Timed out' })
      res.status(502).json({ error: err.message || 'Failed to fetch queue' })
    }
  })

  /** Interrupt the currently running job on a ComfyUI server. */
  router.post('/servers/comfy-interrupt', async (req, res) => {
    const { serverUrl } = req.body
    if (!serverUrl || typeof serverUrl !== 'string') return res.status(400).json({ error: 'serverUrl is required' })
    const base = serverUrl.trim().replace(/\/$/, '')
    if (!base.startsWith('http://') && !base.startsWith('https://')) return res.status(400).json({ error: 'Invalid URL' })
    // Try both /interrupt and /api/interrupt (different ComfyUI versions use different paths)
    const endpoints = [`${base}/interrupt`, `${base}/api/interrupt`]
    let lastErr = null
    for (const url of endpoints) {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 5000)
      try {
        const r = await fetch(url, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        clearTimeout(tid)
        if (r.ok || r.status === 200) return res.json({ ok: true, status: r.status })
        lastErr = `HTTP ${r.status}`
      } catch (err) {
        clearTimeout(tid)
        lastErr = err.name === 'AbortError' ? 'Timed out' : (err.message || 'Failed')
      }
    }
    res.status(502).json({ ok: false, error: lastErr || 'Failed to interrupt' })
  })

  /** Delete specific pending jobs from a ComfyUI server's queue. */
  router.post('/servers/comfy-queue-delete', async (req, res) => {
    const { serverUrl, ids } = req.body
    if (!serverUrl || typeof serverUrl !== 'string') return res.status(400).json({ error: 'serverUrl is required' })
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] is required' })
    const base = serverUrl.trim().replace(/\/$/, '')
    if (!base.startsWith('http://') && !base.startsWith('https://')) return res.status(400).json({ error: 'Invalid URL' })
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 5000)
    try {
      const r = await fetch(`${base}/queue`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: ids }),
      })
      clearTimeout(tid)
      res.json({ ok: r.ok, status: r.status })
    } catch (err) {
      clearTimeout(tid)
      res.status(502).json({ error: err.message || 'Failed to delete from queue' })
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

  /** Free ComfyUI VRAM/models via POST /free. Supports { unload_models, free_memory }. */
  router.post('/servers/free', async (req, res) => {
    const { serverUrl, unloadModels, freeMemory } = req.body;
    if (!serverUrl || typeof serverUrl !== 'string') {
      return res.status(400).json({ error: 'serverUrl is required' });
    }
    const base = serverUrl.trim().replace(/\/$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid server URL' });
    }
    const body = JSON.stringify({
      unload_models: unloadModels === true,
      free_memory: freeMemory === true,
    });
    // Try /free then /api/free (version differences)
    const endpoints = [`${base}/free`, `${base}/api/free`];
    let lastErr = null;
    for (const url of endpoints) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch(url, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        clearTimeout(tid);
        if (r.ok || r.status === 200) return res.json({ ok: true });
        lastErr = `HTTP ${r.status}`;
      } catch (err) {
        clearTimeout(tid);
        lastErr = err.name === 'AbortError' ? 'Timed out' : (err.message || 'Failed');
      }
    }
    res.status(502).json({ ok: false, error: lastErr || 'Failed to call /free' });
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
