import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import { resolveWorkflowPath, validateWorkflowName } from '../../lib/workflowPath.js';

export function createWorkflowsCrudRouter({ workflowsPath, readParamsJson, findWorkflowJson, admin }) {
  const router = Router();

  router.get('/workflows/list', async (req, res) => {
    try {
      const root = path.resolve(workflowsPath);
      const entries = await fs.readdir(workflowsPath, { withFileTypes: true });
      const workflows = [];
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const workflowPath = path.join(workflowsPath, entry.name);
          if (!path.resolve(workflowPath).startsWith(root + path.sep)) continue;
          try {
            const params = await readParamsJson(workflowPath);
            if (!params) continue;
            const workflowData = await findWorkflowJson(workflowPath);
            workflows.push({
              name: entry.name,
              folderPath: `data/gt-workflows/${entry.name}`,
              params,
              hasWorkflowFile: !!workflowData,
              workflowFilePath: workflowData?.filename,
            });
          } catch (error) {
            console.error(`Error reading workflow ${entry.name}:`, error);
          }
        }
      }
      const total = workflows.length;
      const limitNum = Math.min(Math.max(0, parseInt(req.query.limit, 10) || 0), 500);
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const paged = limitNum > 0 ? workflows.slice((pageNum - 1) * limitNum, pageNum * limitNum) : workflows;
      const pages = limitNum > 0 ? Math.ceil(total / limitNum) : 1;
      res.json({ workflows: paged, total, page: pageNum, limit: limitNum, pages });
    } catch (error) {
      console.error('Error listing workflows:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/params', async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const params = await readParamsJson(resolved.workflowPath);
      if (!params) return res.status(404).json({ error: 'Workflow not found' });
      res.json(params);
    } catch (error) {
      console.error('Error fetching workflow params:', error);
      res.status(404).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/workflow', async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const workflowData = await findWorkflowJson(resolved.workflowPath);
      if (!workflowData) return res.status(404).json({ error: 'Workflow JSON file not found' });
      res.json(workflowData.content);
    } catch (error) {
      console.error('Error fetching workflow JSON:', error);
      res.status(404).json({ error: error.message });
    }
  });

  router.put('/workflows/:name/params', admin, async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      try { await fs.access(resolved.workflowPath); } catch { return res.status(404).json({ error: 'Workflow not found' }); }
      const paramsPath = path.join(resolved.workflowPath, 'params.json');
      const tmpPath = `${paramsPath}.tmp`;
      try {
        await fs.writeFile(tmpPath, JSON.stringify(req.body, null, 2), 'utf-8');
        await fs.rename(tmpPath, paramsPath);
      } finally {
        try { await fs.unlink(tmpPath); } catch { /* already renamed or missing */ }
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving workflow params:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/workflows/create', admin, async (req, res) => {
    try {
      const { name, params } = req.body;
      const validated = validateWorkflowName(name);
      if (!validated.ok) return res.status(400).json({ error: validated.error });
      const workflowName = validated.workflowName;
      const workflowPath = path.join(workflowsPath, workflowName);
      const root = path.resolve(workflowsPath);
      if (!path.resolve(workflowPath).startsWith(root + path.sep)) return res.status(400).json({ error: 'Invalid workflow name' });
      try { await fs.access(workflowPath); return res.status(409).json({ error: 'Workflow already exists' }); } catch { /* doesn't exist, good */ }
      await fs.mkdir(workflowPath, { recursive: true });
      await fs.writeFile(path.join(workflowPath, 'params.json'), JSON.stringify(params, null, 2), 'utf-8');
      if (params.parser === 'comfyui' && params.comfyui_config?.workflow) {
        const workflowFilePath = path.join(workflowPath, params.comfyui_config.workflow);
        await fs.writeFile(workflowFilePath, JSON.stringify({ _meta: { title: workflowName } }, null, 2), 'utf-8');
      }
      res.json({ success: true, name: workflowName });
    } catch (error) {
      console.error('Error creating workflow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/workflows/:name/duplicate', admin, async (req, res) => {
    try {
      const sourceResolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!sourceResolved.ok) return res.status(400).json({ error: sourceResolved.error });
      const newValidated = validateWorkflowName(req.body?.newName);
      if (!newValidated.ok) return res.status(400).json({ error: newValidated.error || 'New workflow name is required' });
      const newWorkflowPath = path.resolve(workflowsPath, newValidated.workflowName);
      if (!newWorkflowPath.startsWith(path.resolve(workflowsPath) + path.sep)) return res.status(400).json({ error: 'Invalid workflow name' });
      try { await fs.access(sourceResolved.workflowPath); } catch { return res.status(404).json({ error: 'Source workflow not found' }); }
      try { await fs.access(newWorkflowPath); return res.status(409).json({ error: 'Workflow with that name already exists' }); } catch { /* ok */ }
      const sourceParams = await readParamsJson(sourceResolved.workflowPath);
      if (!sourceParams) return res.status(400).json({ error: 'Source workflow params.json not found' });
      await fs.mkdir(newWorkflowPath, { recursive: true });
      const files = await fs.readdir(sourceResolved.workflowPath, { withFileTypes: true });
      for (const file of files) {
        const srcPath = path.join(sourceResolved.workflowPath, file.name);
        const destPath = path.join(newWorkflowPath, file.name);
        if (file.isFile()) await fs.copyFile(srcPath, destPath);
        else if (file.isDirectory()) await fs.cp(srcPath, destPath, { recursive: true });
      }
      const updatedParams = { ...sourceParams };
      if (updatedParams.label === sourceResolved.workflowName) updatedParams.label = newValidated.workflowName;
      await fs.writeFile(path.join(newWorkflowPath, 'params.json'), JSON.stringify(updatedParams, null, 2), 'utf-8');
      res.json({ success: true, name: newValidated.workflowName });
    } catch (error) {
      console.error('Error duplicating workflow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/workflows/:name', admin, async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      try { await fs.access(resolved.workflowPath); } catch { return res.status(404).json({ error: 'Workflow not found' }); }
      await fs.rm(resolved.workflowPath, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
