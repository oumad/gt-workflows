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
    if (body.workflowDetailUI != null && typeof body.workflowDetailUI === 'object' && !Array.isArray(body.workflowDetailUI)) {
      const sanitized = {};
      for (const [wfName, val] of Object.entries(body.workflowDetailUI)) {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          sanitized[wfName] = {};
          if (typeof val.showWorkflowJson === 'boolean') sanitized[wfName].showWorkflowJson = val.showWorkflowJson;
          if (typeof val.showParamsJson === 'boolean') sanitized[wfName].showParamsJson = val.showParamsJson;
        }
      }
      partial.workflowDetailUI = sanitized;
    }
    if (body.serverAliases != null && typeof body.serverAliases === 'object' && !Array.isArray(body.serverAliases)) {
      const sanitized = {};
      for (const [key, val] of Object.entries(body.serverAliases)) {
        if (typeof key === 'string' && typeof val === 'string' && val.trim()) {
          sanitized[key.trim()] = String(val).trim();
        }
      }
      partial.serverAliases = sanitized;
    }
    if (Array.isArray(body.workflowsInfo)) {
      partial.workflowsInfo = body.workflowsInfo
        .filter((item) => item != null && typeof item === 'object' && typeof item.name === 'string' && typeof item.params === 'object' && item.params !== null)
        .map((item) => ({
          name: String(item.name),
          folderPath: typeof item.folderPath === 'string' ? item.folderPath : undefined,
          params: item.params,
          hasWorkflowFile: typeof item.hasWorkflowFile === 'boolean' ? item.hasWorkflowFile : undefined,
          workflowFilePath: typeof item.workflowFilePath === 'string' ? item.workflowFilePath : undefined,
        }));
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
