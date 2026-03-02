import { Router } from 'express';
import { readPreferences, writePreferences } from '../lib/preferencesFs.js';

export function createPreferencesRouter(config) {
  const { preferencesPath } = config;
  const router = Router();

  /** GET /api/preferences — return current user's preferences (file-based). */
  router.get('/preferences', async (req, res) => {
    const userId = req.authUsername || 'default';
    try {
      const prefs = await readPreferences(preferencesPath, userId);
      const monitoredServers = Array.isArray(prefs.monitoredServers) ? prefs.monitoredServers : [];
      const expandedCategories = Array.isArray(prefs.expandedCategories) ? prefs.expandedCategories : [];
      const workflowDetailUI =
        prefs.workflowDetailUI && typeof prefs.workflowDetailUI === 'object' ? prefs.workflowDetailUI : {};
      const workflowsInfo = Array.isArray(prefs.workflowsInfo) ? prefs.workflowsInfo : [];
      const serverAliases =
        prefs.serverAliases && typeof prefs.serverAliases === 'object' && !Array.isArray(prefs.serverAliases)
          ? prefs.serverAliases
          : {};
      res.json({
        anonymiseUsers: Boolean(prefs.anonymiseUsers),
        serversOpen: Boolean(prefs.serversOpen),
        userDetailsOpen: Boolean(prefs.userDetailsOpen),
        monitoredServers,
        expandedCategories,
        workflowDetailUI,
        workflowsInfo,
        serverAliases,
      });
    } catch (err) {
      console.error('Preferences read error:', err.message);
      res.status(500).json({ error: 'Failed to read preferences' });
    }
  });

  /** PATCH /api/preferences — merge body into current user's preferences and persist to file. */
  router.patch('/preferences', async (req, res) => {
    const userId = req.authUsername || 'default';
    const body = req.body || {};
    const partial = {};
    if (typeof body.anonymiseUsers === 'boolean') partial.anonymiseUsers = body.anonymiseUsers;
    if (typeof body.serversOpen === 'boolean') partial.serversOpen = body.serversOpen;
    if (typeof body.userDetailsOpen === 'boolean') partial.userDetailsOpen = body.userDetailsOpen;
    if (Array.isArray(body.monitoredServers)) {
      partial.monitoredServers = body.monitoredServers.filter((s) => typeof s === 'string' && s.trim());
    }
    if (Array.isArray(body.expandedCategories)) {
      partial.expandedCategories = body.expandedCategories.filter((s) => typeof s === 'string');
    }
    const DANGEROUS_KEYS = new Set(['__proto__', 'constructor']);
    if (body.workflowDetailUI != null && typeof body.workflowDetailUI === 'object' && !Array.isArray(body.workflowDetailUI)) {
      const sanitized = Object.create(null);
      for (const [wfName, val] of Object.entries(body.workflowDetailUI)) {
        if (DANGEROUS_KEYS.has(wfName)) continue;
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          sanitized[wfName] = Object.create(null);
          if (typeof val.showWorkflowJson === 'boolean') sanitized[wfName].showWorkflowJson = val.showWorkflowJson;
          if (typeof val.showParamsJson === 'boolean') sanitized[wfName].showParamsJson = val.showParamsJson;
          if (typeof val.lastTestRun === 'string' && val.lastTestRun.trim()) sanitized[wfName].lastTestRun = val.lastTestRun.trim();
          if (val.lastTestRunStatus === 'ok' || val.lastTestRunStatus === 'nok') sanitized[wfName].lastTestRunStatus = val.lastTestRunStatus;
          if (typeof val.lastAuditRun === 'string' && val.lastAuditRun.trim()) sanitized[wfName].lastAuditRun = val.lastAuditRun.trim();
          if (val.lastAuditRunStatus === 'ok' || val.lastAuditRunStatus === 'nok') sanitized[wfName].lastAuditRunStatus = val.lastAuditRunStatus;
        }
      }
      partial.workflowDetailUI = sanitized;
    }
    if (body.serverAliases != null && typeof body.serverAliases === 'object' && !Array.isArray(body.serverAliases)) {
      const sanitized = Object.create(null);
      for (const [key, val] of Object.entries(body.serverAliases)) {
        if (DANGEROUS_KEYS.has(key)) continue;
        if (typeof key === 'string' && typeof val === 'string' && val.trim()) {
          sanitized[key.trim()] = String(val).trim();
        }
      }
      partial.serverAliases = sanitized;
    }
    if (Array.isArray(body.workflowsInfo)) {
      partial.workflowsInfo = body.workflowsInfo
        .filter(
          (item) =>
            item != null &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            typeof item.name === 'string' &&
            typeof item.params === 'object' &&
            item.params !== null &&
            !Array.isArray(item.params)
        )
        .map((item) => {
          const params = item.params && typeof item.params === 'object' && !Array.isArray(item.params) ? item.params : {};
          return {
            name: String(item.name),
            folderPath: typeof item.folderPath === 'string' ? item.folderPath : undefined,
            params,
            hasWorkflowFile: typeof item.hasWorkflowFile === 'boolean' ? item.hasWorkflowFile : undefined,
            workflowFilePath: typeof item.workflowFilePath === 'string' ? item.workflowFilePath : undefined,
          };
        });
    }
    try {
      const merged = await writePreferences(preferencesPath, userId, partial);
      const monitoredServers = Array.isArray(merged.monitoredServers) ? merged.monitoredServers : [];
      const expandedCategories = Array.isArray(merged.expandedCategories) ? merged.expandedCategories : [];
      const workflowDetailUI =
        merged.workflowDetailUI && typeof merged.workflowDetailUI === 'object' ? merged.workflowDetailUI : {};
      const workflowsInfo = Array.isArray(merged.workflowsInfo) ? merged.workflowsInfo : [];
      const serverAliases =
        merged.serverAliases && typeof merged.serverAliases === 'object' ? merged.serverAliases : {};
      res.json({
        anonymiseUsers: Boolean(merged.anonymiseUsers),
        serversOpen: Boolean(merged.serversOpen),
        userDetailsOpen: Boolean(merged.userDetailsOpen),
        monitoredServers,
        expandedCategories,
        workflowDetailUI,
        workflowsInfo,
        serverAliases,
      });
    } catch (err) {
      console.error('Preferences write error:', err.message);
      res.status(500).json({ error: 'Failed to save preferences' });
    }
  });

  return router;
}
