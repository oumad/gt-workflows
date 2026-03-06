import { Router } from 'express';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';

const RETRY_TIMEOUTS_MS = [60000, 120000, 180000];
const TEST_WORKFLOW_TIMEOUT_MS = RETRY_TIMEOUTS_MS.reduce((a, b) => a + b, 0) + 90_000;

/**
 * Attempt to connect a WebSocket to ComfyUI and submit the workflow prompt.
 * Resolves with { ws, promptId } on success. Rejects on error; err.noRetry=true skips retries.
 */
function tryConnectAndSubmit(wsUrl, normalizedUrl, workflowJson, clientId, connectionTimeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;

    const settle = (fn, val) => { if (settled) return; settled = true; fn(val); };

    const connectionTimer = setTimeout(() => {
      settle(reject, new Error(`Connection timed out after ${connectionTimeoutMs / 1000}s`));
      try { ws?.close(); } catch { /* ignore */ }
    }, connectionTimeoutMs);

    try {
      ws = new WebSocket(wsUrl, []);
    } catch (err) {
      clearTimeout(connectionTimer);
      return reject(err);
    }

    ws.on('error', (err) => { clearTimeout(connectionTimer); settle(reject, err); });

    ws.on('open', async () => {
      clearTimeout(connectionTimer);
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 30000);
        const promptRes = await fetch(`${normalizedUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'clientId': clientId },
          body: JSON.stringify({ prompt: workflowJson, client_id: clientId }),
          signal: controller.signal,
        });
        clearTimeout(fetchTimeout);
        console.log(`[Test Workflow] /prompt response status: ${promptRes.status}`);

        if (!promptRes.ok) {
          let errBody;
          try { errBody = await promptRes.json(); } catch { errBody = {}; }
          const msg = typeof errBody.error === 'string' ? errBody.error : `Prompt submission failed (${promptRes.status})`;
          console.error('[Test Workflow] /prompt error:', errBody);
          const err = Object.assign(new Error(msg), {
            noRetry: promptRes.status < 500,
            details: errBody.node_errors || errBody.error || null,
          });
          try { ws.close(); } catch { /* ignore */ }
          return settle(reject, err);
        }

        const result = await promptRes.json();
        console.log(`[Test Workflow] Got prompt_id: ${result.prompt_id}`);

        if (result.node_errors && Object.keys(result.node_errors).length > 0) {
          console.error('[Test Workflow] node_errors:', JSON.stringify(result.node_errors));
          const firstErr = Object.values(result.node_errors)[0];
          const firstMsg = firstErr?.errors?.[0]?.message || firstErr?.message || null;
          const failedIds = Object.keys(result.node_errors).join(', ');
          const detail = firstMsg ? `: ${firstMsg}` : ` (nodes: ${failedIds})`;
          const err = Object.assign(new Error(`Workflow validation failed${detail}`), { noRetry: true, details: result.node_errors });
          try { ws.close(); } catch { /* ignore */ }
          return settle(reject, err);
        }

        settle(resolve, { ws, promptId: result.prompt_id });
      } catch (err) {
        try { ws.close(); } catch { /* ignore */ }
        settle(reject, err);
      }
    });
  });
}

export function createTestWorkflowRouter() {
  const router = Router();

  router.post('/servers/test-workflow', async (req, res) => {
    const { serverUrl, workflowJson } = req.body;
    if (!serverUrl || typeof serverUrl !== 'string') return res.status(400).json({ error: 'Server URL is required' });
    if (!workflowJson || typeof workflowJson !== 'object') return res.status(400).json({ error: 'workflowJson is required' });
    const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid server URL' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(':ok\n\n');

    const clientId = randomUUID();
    let ws = null;
    let promptId = null;
    let closed = false;
    let timeoutTimer = null;

    const sendSSE = (event, data) => { if (closed) return; res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

    const cleanup = (reason) => {
      if (closed) return;
      closed = true;
      console.log(`[Test Workflow] Cleanup called: ${reason}`);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (ws && ws.readyState <= WebSocket.OPEN) { try { ws.close(); } catch { /* ignore */ } }
      try { res.end(); } catch { /* ignore */ }
    };

    timeoutTimer = setTimeout(() => { sendSSE('error', { message: 'Test execution timed out (120s)' }); cleanup('timeout'); }, TEST_WORKFLOW_TIMEOUT_MS);
    res.on('close', () => cleanup('client disconnected'));

    const wsUrlObj = new URL(normalizedUrl);
    wsUrlObj.protocol = wsUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrlObj.pathname = '/ws';
    wsUrlObj.search = `clientId=${clientId}`;
    const wsUrl = wsUrlObj.toString();
    console.log(`[Test Workflow] Connecting WebSocket to ${wsUrl}`);

    let lastErr = null;
    for (let attempt = 0; attempt < RETRY_TIMEOUTS_MS.length; attempt++) {
      if (closed) return;
      if (attempt > 0) {
        console.log(`[Test Workflow] Retry attempt ${attempt + 1}/${RETRY_TIMEOUTS_MS.length} (timeout: ${RETRY_TIMEOUTS_MS[attempt] / 1000}s)`);
        sendSSE('status', { retrying: attempt + 1, total: RETRY_TIMEOUTS_MS.length });
        await new Promise((r) => setTimeout(r, 500));
        if (closed) return;
      }
      try {
        const result = await tryConnectAndSubmit(wsUrl, normalizedUrl, workflowJson, clientId, RETRY_TIMEOUTS_MS[attempt]);
        ws = result.ws; promptId = result.promptId; lastErr = null; break;
      } catch (err) {
        lastErr = err;
        console.log(`[Test Workflow] Attempt ${attempt + 1} failed: ${err.message}`);
        if (err.noRetry) break;
      }
    }

    if (closed) return;
    if (!ws || lastErr) {
      sendSSE('error', { message: lastErr?.message || 'Failed to connect', ...(lastErr?.details != null ? { details: lastErr.details } : {}) });
      cleanup('connection failed');
      return;
    }

    sendSSE('connected', { clientId });
    sendSSE('queued', { prompt_id: promptId });
    ws.removeAllListeners();

    ws.on('error', (err) => { console.error('[Test Workflow] WebSocket runtime error:', err.message); sendSSE('error', { message: `WebSocket error: ${err.message}` }); cleanup('ws error'); });
    ws.on('close', (code, reason) => {
      console.log(`[Test Workflow] WebSocket closed: code=${code} reason=${reason}`);
      if (!closed) {
        const reasonStr = reason?.toString?.() || '';
        const detail = reasonStr ? `: ${reasonStr}` : code ? ` (code ${code})` : '';
        sendSSE('error', { message: `WebSocket closed unexpectedly${detail}` });
        cleanup('ws closed');
      }
    });

    ws.on('message', (rawData) => {
      if (closed) return;
      let msg;
      try { msg = JSON.parse(rawData.toString()); } catch { return; }
      const { type, data } = msg;
      if (!type || !data) return;
      if (data.prompt_id && promptId && data.prompt_id !== promptId) return;

      switch (type) {
        case 'executing':
          if (data.node === null) { sendSSE('completed', { prompt_id: promptId }); cleanup('completed'); }
          else sendSSE('executing', { node: data.node, prompt_id: data.prompt_id });
          break;
        case 'progress': sendSSE('progress', { node: data.node, value: data.value, max: data.max }); break;
        case 'execution_cached': sendSSE('cached', { nodes: data.nodes || [] }); break;
        case 'executed': sendSSE('node_done', { node: data.node, hasImages: !!(data.output?.images?.length) }); break;
        case 'execution_error':
          sendSSE('error', { message: data.exception_message || 'Execution error', node_id: data.node_id, node_type: data.node_type, traceback: data.traceback || null });
          cleanup('execution error');
          break;
        case 'status':
          if (data.status?.exec_info?.queue_remaining != null) sendSSE('status', { queue_remaining: data.status.exec_info.queue_remaining });
          break;
      }
    });
  });

  router.post('/servers/test-workflow/cancel', async (req, res) => {
    try {
      const { serverUrl } = req.body;
      if (!serverUrl || typeof serverUrl !== 'string') return res.status(400).json({ error: 'Server URL is required' });
      const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${normalizedUrl}/interrupt`, { method: 'POST', signal: controller.signal });
      clearTimeout(timeoutId);
      res.json({ success: response.ok, status: response.status });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to cancel' });
    }
  });

  return router;
}
