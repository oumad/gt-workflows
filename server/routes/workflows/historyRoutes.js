import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import { resolveWorkflowPath } from '../../lib/workflowPath.js';
import {
  listHistory,
  getHistoryEntry,
  getHistoryFilePath,
  restoreFromHistory,
  deleteHistoryEntry,
  clearHistory,
} from '../../lib/workflowHistory.js';

export function createWorkflowsHistoryRouter({ workflowsPath, historyPath, admin }) {
  const router = Router();

  // List history entries for a workflow (newest first)
  router.get('/workflows/:name/history', async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const entries = await listHistory(historyPath, resolved.workflowName);
      res.json({ entries });
    } catch (error) {
      console.error('Error listing history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get a single history entry's metadata
  router.get('/workflows/:name/history/:ts', async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const entry = await getHistoryEntry(historyPath, resolved.workflowName, req.params.ts);
      res.json(entry);
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'History entry not found' });
      console.error('Error fetching history entry:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Serve a specific file from a history entry
  router.get('/workflows/:name/history/:ts/file/:filename', async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const filename = decodeURIComponent(req.params.filename);
      const filePath = getHistoryFilePath(historyPath, resolved.workflowName, req.params.ts, filename);
      try { await fs.access(filePath); } catch { return res.status(404).json({ error: 'File not found' }); }
      res.sendFile(path.resolve(filePath));
    } catch (error) {
      console.error('Error serving history file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore from a history entry (backs up current state first)
  router.post('/workflows/:name/history/:ts/restore', admin, async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      try { await fs.access(resolved.workflowPath); } catch { return res.status(404).json({ error: 'Workflow not found' }); }
      const result = await restoreFromHistory(historyPath, resolved.workflowPath, resolved.workflowName, req.params.ts);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'History entry not found' });
      console.error('Error restoring from history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a single history entry
  router.delete('/workflows/:name/history/:ts', admin, async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      await deleteHistoryEntry(historyPath, resolved.workflowName, req.params.ts);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting history entry:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear all history for a workflow
  router.delete('/workflows/:name/history', admin, async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      await clearHistory(historyPath, resolved.workflowName);
      res.json({ success: true });
    } catch (error) {
      console.error('Error clearing history:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
