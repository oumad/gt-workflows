import { Router } from 'express';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';

const LOGS_TIMEOUT_MS = 10000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const AUDIT_TIMEOUT_MS = 60000;
const TEST_WORKFLOW_TIMEOUT_MS = 120000;
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
          let errDetail = '';
          try {
            const bodyText = await response.text();
            if (bodyText) errDetail = ` — ${bodyText.slice(0, 200)}`;
          } catch { /* ignore */ }
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
          let errDetail = '';
          try {
            const bodyText = await response.text();
            if (bodyText) errDetail = ` — ${bodyText.slice(0, 300)}`;
          } catch { /* ignore */ }
          nodeError = `object_info returned HTTP ${response.status}${errDetail}`;
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

  // --- Test Workflow Execution (SSE) ---
  router.post('/servers/test-workflow', async (req, res) => {
    const { serverUrl, workflowJson } = req.body;
    if (!serverUrl || typeof serverUrl !== 'string') {
      return res.status(400).json({ error: 'Server URL is required' });
    }
    if (!workflowJson || typeof workflowJson !== 'object') {
      return res.status(400).json({ error: 'workflowJson is required' });
    }
    const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid server URL' });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send padding comment to prime any proxy buffers
    res.write(':ok\n\n');

    const clientId = randomUUID();
    let ws = null;
    let promptId = null;
    let closed = false;
    let timeoutTimer = null;

    const sendSSE = (event, data) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const cleanup = (reason) => {
      if (closed) return;
      closed = true;
      console.log(`[Test Workflow] Cleanup called: ${reason}`);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (ws && ws.readyState <= WebSocket.OPEN) {
        try { ws.close(); } catch { /* ignore */ }
      }
      try { res.end(); } catch { /* ignore */ }
    };

    // Overall timeout
    timeoutTimer = setTimeout(() => {
      sendSSE('error', { message: 'Test execution timed out (120s)' });
      cleanup('timeout');
    }, TEST_WORKFLOW_TIMEOUT_MS);

    // Client disconnect — use res.on('close') not req.on('close')
    // req 'close' fires when the request body stream ends (after express.json() consumes it),
    // res 'close' fires when the actual client connection drops.
    res.on('close', () => cleanup('client disconnected'));

    // Build WebSocket URL using URL parser (matches production gt-plugins pattern)
    const wsUrlObj = new URL(normalizedUrl);
    wsUrlObj.protocol = wsUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrlObj.pathname = '/ws';
    wsUrlObj.search = `clientId=${clientId}`;
    const wsUrl = wsUrlObj.toString();

    console.log(`[Test Workflow] Connecting WebSocket to ${wsUrl}`);

    try {
      ws = new WebSocket(wsUrl, []);
    } catch (err) {
      sendSSE('error', { message: `Failed to create WebSocket: ${err.message}` });
      cleanup('ws create error');
      return;
    }

    ws.on('error', (err) => {
      console.error(`[Test Workflow] WebSocket error:`, err.message);
      sendSSE('error', { message: `WebSocket error: ${err.message}` });
      cleanup('ws error');
    });

    ws.on('close', (code, reason) => {
      console.log(`[Test Workflow] WebSocket closed: code=${code} reason=${reason}`);
      if (!closed) {
        const reasonStr = reason?.toString?.() || '';
        const detail = reasonStr ? `: ${reasonStr}` : code ? ` (code ${code})` : '';
        sendSSE('error', { message: `WebSocket closed unexpectedly${detail}` });
        cleanup('ws closed');
      }
    });

    ws.on('open', async () => {
      console.log(`[Test Workflow] WebSocket connected, submitting prompt...`);
      sendSSE('connected', { clientId });

      // Submit workflow to /prompt (matches production gt-plugins pattern)
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 30000);
        const promptRes = await fetch(`${normalizedUrl}/prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'clientId': clientId,
          },
          body: JSON.stringify({ prompt: workflowJson, client_id: clientId }),
          signal: controller.signal,
        });
        clearTimeout(fetchTimeout);

        console.log(`[Test Workflow] /prompt response status: ${promptRes.status}`);

        if (!promptRes.ok) {
          let errBody;
          try { errBody = await promptRes.json(); } catch { errBody = {}; }
          const errMsg = typeof errBody.error === 'string'
            ? errBody.error
            : `Prompt submission failed (${promptRes.status})`;
          console.error(`[Test Workflow] /prompt error:`, errBody);
          sendSSE('error', {
            message: errMsg,
            details: errBody.node_errors || errBody.error || null,
          });
          cleanup('prompt error');
          return;
        }

        const result = await promptRes.json();
        promptId = result.prompt_id;
        console.log(`[Test Workflow] Got prompt_id: ${promptId}`);

        if (result.node_errors && Object.keys(result.node_errors).length > 0) {
          console.error(`[Test Workflow] node_errors:`, JSON.stringify(result.node_errors));
          const failedNodeIds = Object.keys(result.node_errors).join(', ');
          const firstErr = Object.values(result.node_errors)[0];
          const firstMsg = firstErr?.errors?.[0]?.message || firstErr?.message || null;
          const detail = firstMsg ? `: ${firstMsg}` : ` (nodes: ${failedNodeIds})`;
          sendSSE('error', {
            message: `Workflow validation failed${detail}`,
            node_errors: result.node_errors,
          });
          cleanup('node errors');
          return;
        }

        sendSSE('queued', { prompt_id: promptId });

      } catch (err) {
        console.error(`[Test Workflow] Failed to submit prompt:`, err);
        sendSSE('error', { message: `Failed to submit prompt: ${err.message}` });
        cleanup('prompt fetch error');
        return;
      }
    });

    ws.on('message', (rawData) => {
      if (closed) return;
      let msg;
      try { msg = JSON.parse(rawData.toString()); } catch { return; }

      const { type, data } = msg;
      if (!type || !data) return;

      // Only process events for our prompt
      if (data.prompt_id && promptId && data.prompt_id !== promptId) return;

      switch (type) {
        case 'executing':
          if (data.node === null) {
            // Execution complete
            sendSSE('completed', { prompt_id: promptId });
            cleanup('completed');
          } else {
            sendSSE('executing', { node: data.node, prompt_id: data.prompt_id });
          }
          break;
        case 'progress':
          sendSSE('progress', { node: data.node, value: data.value, max: data.max });
          break;
        case 'execution_cached':
          sendSSE('cached', { nodes: data.nodes || [] });
          break;
        case 'executed':
          sendSSE('node_done', {
            node: data.node,
            hasImages: !!(data.output?.images?.length),
          });
          break;
        case 'execution_error':
          sendSSE('error', {
            message: data.exception_message || 'Execution error',
            node_id: data.node_id,
            node_type: data.node_type,
            traceback: data.traceback || null,
          });
          cleanup('execution error');
          break;
        case 'status':
          if (data.status?.exec_info?.queue_remaining != null) {
            sendSSE('status', { queue_remaining: data.status.exec_info.queue_remaining });
          }
          break;
        default:
          break;
      }
    });
  });

  // --- Cancel Test Workflow ---
  router.post('/servers/test-workflow/cancel', async (req, res) => {
    try {
      const { serverUrl } = req.body;
      if (!serverUrl || typeof serverUrl !== 'string') {
        return res.status(400).json({ error: 'Server URL is required' });
      }
      const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${normalizedUrl}/interrupt`, {
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      res.json({ success: response.ok, status: response.status });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to cancel' });
    }
  });

  return router;
}
