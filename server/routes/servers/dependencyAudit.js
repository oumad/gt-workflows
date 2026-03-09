import { Router } from 'express';

const AUDIT_TIMEOUT_MS = 180000; // matches last RETRY_TIMEOUTS_MS value

/** Resolve a human-readable category label for a model input based on class_type + field. */
function resolveDisplayCategory(classType, field) {
  const overrides = { ModelPatchLoader: { name: 'Model Patches' } };
  if (overrides[classType]?.[field]) return overrides[classType][field];
  const fieldMap = {
    ckpt_name: 'Checkpoints', checkpoint_name: 'Checkpoints',
    lora_name: 'LoRAs', vae_name: 'VAE',
    clip_name: 'Text Encoders (CLIP)', clip_name1: 'Text Encoders (CLIP)', clip_name2: 'Text Encoders (CLIP)',
    unet_name: 'Diffusion Models (UNET)', control_net_name: 'ControlNet',
  };
  return fieldMap[field] || field;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export function createDependencyAuditRouter() {
  const router = Router();

  router.post('/servers/dependency-audit', async (req, res) => {
    try {
      const { serverUrl, classTypes, modelInputs, fileInputs } = req.body;
      if (!serverUrl || typeof serverUrl !== 'string') return res.status(400).json({ error: 'Server URL is required' });
      if (!Array.isArray(classTypes)) return res.status(400).json({ error: 'classTypes must be an array' });
      const normalizedUrl = serverUrl.trim().replace(/\/$/, '');
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        return res.status(400).json({ error: 'Invalid server URL' });
      }

      const normalize = (p) => typeof p === 'string' ? p.replace(/\\/g, '/') : null;
      console.log(`[Dependency Audit] Starting for ${normalizedUrl}: ${classTypes.length} nodes, ${modelInputs?.length ?? 0} models, ${fileInputs?.length ?? 0} inputs`);

      let objectInfo = null;
      let nodeError = null;
      let bulkFailed = false;

      // Step 1: try bulk /object_info with retries on connection errors
      const RETRY_DELAYS = [0, 300, 300];
      for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        if (attempt > 0) {
          console.log(`[Dependency Audit] Retry ${attempt + 1}/${RETRY_DELAYS.length} for ${normalizedUrl}`);
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        }
        try {
          const response = await fetchWithTimeout(`${normalizedUrl}/object_info`, AUDIT_TIMEOUT_MS);
          if (response.ok) { objectInfo = await response.json(); nodeError = null; break; }
          let errDetail = '';
          try { const bodyText = await response.text(); if (bodyText) errDetail = ` — ${bodyText.slice(0, 200)}`; } catch { /* ignore */ }
          nodeError = `object_info returned HTTP ${response.status}${errDetail}`;
          console.warn(`[Dependency Audit] Bulk fetch failed (${response.status}) for ${normalizedUrl} — will try per-node queries`);
          if (response.status >= 500) bulkFailed = true;
          break;
        } catch (err) {
          if (err.name === 'AbortError') {
            nodeError = `Timeout fetching object_info (${AUDIT_TIMEOUT_MS / 1000}s)`;
            console.error(`[Dependency Audit] ${nodeError} for ${normalizedUrl}`);
            break;
          }
          nodeError = err.message || 'Failed to fetch object_info';
          console.error(`[Dependency Audit] Attempt ${attempt + 1} failed for ${normalizedUrl}:`, nodeError);
        }
      }

      // Step 2: if bulk failed with 5xx, query each node type individually
      let nodes;
      if (bulkFailed && classTypes.length > 0) {
        console.log(`[Dependency Audit] Falling back to per-node queries for ${classTypes.length} nodes on ${normalizedUrl}`);
        const uniqueTypes = [...new Set(classTypes)];
        const perNodeAvailable = new Map();
        let perNodeError = null;

        for (const classType of uniqueTypes) {
          try {
            const response = await fetchWithTimeout(`${normalizedUrl}/object_info/${encodeURIComponent(classType)}`, 10000);
            if (response.ok) {
              perNodeAvailable.set(classType, true);
              try {
                const nodeData = await response.json();
                if (!objectInfo) objectInfo = {};
                if (nodeData && typeof nodeData === 'object') Object.assign(objectInfo, nodeData);
              } catch { /* best-effort */ }
            } else if (response.status === 404) {
              perNodeAvailable.set(classType, false);
            } else {
              perNodeAvailable.set(classType, null);
              if (!perNodeError) perNodeError = `object_info/${classType} returned HTTP ${response.status}`;
            }
          } catch (err) {
            perNodeAvailable.set(classType, null);
            if (!perNodeError) perNodeError = err.name === 'AbortError'
              ? `Timeout checking node ${classType}`
              : (err.message || `Failed to check node ${classType}`);
          }
        }

        const checkedCount = [...perNodeAvailable.values()].filter((v) => v !== null).length;
        if (checkedCount > 0) {
          nodeError = perNodeError;
          console.log(`[Dependency Audit] Per-node fallback: ${checkedCount}/${uniqueTypes.length} nodes checked on ${normalizedUrl}`);
        }
        nodes = classTypes.map((name) => ({ name, available: perNodeAvailable.has(name) ? perNodeAvailable.get(name) : null }));
      } else {
        const registeredNodes = objectInfo ? new Set(Object.keys(objectInfo)) : null;
        nodes = classTypes.map((name) => ({ name, available: registeredNodes ? registeredNodes.has(name) : null }));
      }

      // Helper: extract valid file list from an object_info input definition
      const getValidFiles = (classType, field) => {
        if (!objectInfo?.[classType]) return null;
        const inputDef = objectInfo[classType].input?.required?.[field] || objectInfo[classType].input?.optional?.[field];
        if (!Array.isArray(inputDef) || inputDef.length === 0) return null;
        if (Array.isArray(inputDef[0])) return new Set(inputDef[0].map(normalize).filter(Boolean));
        if (inputDef[0] === 'COMBO' && inputDef[1]?.options && Array.isArray(inputDef[1].options)) {
          return new Set(inputDef[1].options.map(normalize).filter(Boolean));
        }
        return null;
      };

      // Resolve models
      const modelsResult = {};
      if (Array.isArray(modelInputs)) {
        for (const item of modelInputs) {
          if (!item || typeof item !== 'object') continue;
          const { classType, field, value } = item;
          if (typeof classType !== 'string' || typeof field !== 'string' || typeof value !== 'string' || !classType || !field || !value) continue;
          const validFiles = getValidFiles(classType, field);
          const available = validFiles ? validFiles.has(normalize(value)) : null;
          const category = resolveDisplayCategory(classType, field);
          if (!modelsResult[category]) modelsResult[category] = [];
          if (!modelsResult[category].some((m) => m.name === value)) modelsResult[category].push({ name: value, available });
        }
      }

      // Resolve input files
      const filesResult = [];
      if (Array.isArray(fileInputs)) {
        const seen = new Set();
        for (const item of fileInputs) {
          if (!item || typeof item !== 'object') continue;
          const { classType, field, value } = item;
          if (typeof classType !== 'string' || typeof field !== 'string' || typeof value !== 'string' || !classType || !field || !value) continue;
          if (seen.has(value)) continue;
          seen.add(value);
          const validFiles = getValidFiles(classType, field);
          filesResult.push({ name: value, available: validFiles ? validFiles.has(normalize(value)) : null });
        }
      }

      console.log(`[Dependency Audit] Completed for ${normalizedUrl}: ${nodes.length} nodes checked${nodeError ? ` (with error: ${nodeError})` : ''}`);
      res.json({
        serverUrl: normalizedUrl,
        timestamp: new Date().toISOString(),
        nodes,
        models: modelsResult,
        files: filesResult,
        ...(nodeError ? { nodeError } : {}),
      });
    } catch (error) {
      console.error('[Dependency Audit] Unexpected error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
