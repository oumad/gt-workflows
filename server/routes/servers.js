import { Router } from 'express';

const LOGS_TIMEOUT_MS = 10000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const AUDIT_TIMEOUT_MS = 60000;
const HEALTH_CHECK_ENDPOINTS = [
  { path: '/system_stats', name: 'system_stats', method: 'GET' },
  { path: '/queue', name: 'queue', method: 'GET' },
  { path: '/object_info', name: 'object_info', method: 'POST' },
];

/** Resolve a human-readable category label for a model input based on class_type + field. */
function resolveDisplayCategory(classType, field) {
  // Node-specific overrides
  const overrides = {
    ModelPatchLoader: { name: 'Model Patches' },
  };
  if (overrides[classType]?.[field]) return overrides[classType][field];

  // Field-name based mapping
  const fieldMap = {
    ckpt_name: 'Checkpoints',
    checkpoint_name: 'Checkpoints',
    lora_name: 'LoRAs',
    vae_name: 'VAE',
    clip_name: 'Text Encoders (CLIP)',
    clip_name1: 'Text Encoders (CLIP)',
    clip_name2: 'Text Encoders (CLIP)',
    unet_name: 'Diffusion Models (UNET)',
    control_net_name: 'ControlNet',
  };
  return fieldMap[field] || field;
}

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

  router.post('/servers/dependency-audit', async (req, res) => {
    try {
      const { serverUrl, classTypes, modelInputs, fileInputs } = req.body;
      if (!serverUrl || typeof serverUrl !== 'string') {
        return res.status(400).json({ error: 'Server URL is required' });
      }
      if (!Array.isArray(classTypes)) {
        return res.status(400).json({ error: 'classTypes must be an array' });
      }
      const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid server URL' });
      }

      const normalize = (p) => typeof p === 'string' ? p.replace(/\\/g, '/') : null;

      // --- Fetch /object_info (used for both node check and model resolution) ---
      let objectInfo = null;
      let nodeError = null;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
        const response = await fetch(`${normalizedUrl}/object_info`, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          objectInfo = await response.json();
        } else {
          nodeError = `object_info returned ${response.status}`;
        }
      } catch (err) {
        nodeError = err.name === 'AbortError' ? 'Timeout fetching object_info' : (err.message || 'Failed to fetch object_info');
      }

      const registeredNodes = objectInfo ? new Set(Object.keys(objectInfo)) : null;
      const nodes = classTypes.map((name) => ({
        name,
        available: registeredNodes ? registeredNodes.has(name) : null,
      }));

      // --- Helper: extract valid file list from an object_info input definition ---
      // Handles two ComfyUI formats:
      //   Old: [[ "file1", "file2", ... ], ...]
      //   New: [ "COMBO", { options: ["file1", "file2", ...] } ]
      const getValidFiles = (classType, field) => {
        if (!objectInfo?.[classType]) return null;
        const nodeInfo = objectInfo[classType];
        const inputDef = nodeInfo.input?.required?.[field] || nodeInfo.input?.optional?.[field];
        if (!Array.isArray(inputDef) || inputDef.length === 0) return null;
        // Old format: first element is an array of values
        if (Array.isArray(inputDef[0])) {
          return new Set(inputDef[0].map(normalize).filter(Boolean));
        }
        // New format: ["COMBO", { options: [...] }]
        if (inputDef[0] === 'COMBO' && inputDef[1]?.options && Array.isArray(inputDef[1].options)) {
          return new Set(inputDef[1].options.map(normalize).filter(Boolean));
        }
        return null;
      };

      // --- Resolve models using object_info dropdown values ---
      const modelsResult = {};
      if (Array.isArray(modelInputs)) {
        for (const item of modelInputs) {
          if (!item || typeof item !== 'object') continue;
          const { classType, field, value } = item;
          if (typeof classType !== 'string' || typeof field !== 'string' || typeof value !== 'string' || !classType || !field || !value) continue;

          let available = null;
          const validFiles = getValidFiles(classType, field);
          if (validFiles) {
            available = validFiles.has(normalize(value));
          }

          // Determine display category from field name
          const category = resolveDisplayCategory(classType, field);
          if (!modelsResult[category]) modelsResult[category] = [];
          // Avoid duplicate entries within same category
          if (!modelsResult[category].some((m) => m.name === value)) {
            modelsResult[category].push({ name: value, available });
          }
        }
      }

      // --- Resolve input files using object_info dropdown values ---
      const filesResult = [];
      if (Array.isArray(fileInputs)) {
        const seen = new Set();
        for (const item of fileInputs) {
          if (!item || typeof item !== 'object') continue;
          const { classType, field, value } = item;
          if (typeof classType !== 'string' || typeof field !== 'string' || typeof value !== 'string' || !classType || !field || !value) continue;
          if (seen.has(value)) continue;
          seen.add(value);

          let available = null;
          const validFiles = getValidFiles(classType, field);
          if (validFiles) {
            available = validFiles.has(normalize(value));
          }
          filesResult.push({ name: value, available });
        }
      }

      res.json({
        serverUrl: normalizedUrl,
        timestamp: new Date().toISOString(),
        nodes,
        models: modelsResult,
        files: filesResult,
        ...(nodeError ? { nodeError } : {}),
      });
    } catch (error) {
      console.error('Error auditing dependencies:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
