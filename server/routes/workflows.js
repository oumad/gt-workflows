import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import archiver from 'archiver';

export function createWorkflowsRouter({ workflowsPath, readParamsJson, findWorkflowJson, upload }) {
  const router = Router();

  router.get('/workflows/list', async (_req, res) => {
    try {
      const entries = await fs.readdir(workflowsPath, { withFileTypes: true });
      const workflows = [];
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const workflowPath = path.join(workflowsPath, entry.name);
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
      res.json(workflows);
    } catch (error) {
      console.error('Error listing workflows:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/params', async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const workflowPath = path.join(workflowsPath, workflowName);
      const params = await readParamsJson(workflowPath);
      res.json(params);
    } catch (error) {
      console.error('Error fetching workflow params:', error);
      res.status(404).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/workflow', async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const workflowPath = path.join(workflowsPath, workflowName);
      const workflowData = await findWorkflowJson(workflowPath);
      if (!workflowData) {
        return res.status(404).json({ error: 'Workflow JSON file not found' });
      }
      res.json(workflowData.content);
    } catch (error) {
      console.error('Error fetching workflow JSON:', error);
      res.status(404).json({ error: error.message });
    }
  });

  router.put('/workflows/:name/params', async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const workflowPath = path.join(workflowsPath, workflowName);
      const paramsPath = path.join(workflowPath, 'params.json');
      try {
        await fs.access(workflowPath);
      } catch {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      await fs.writeFile(paramsPath, JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving workflow params:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/workflows/create', async (req, res) => {
    try {
      const { name, params } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Workflow name is required' });
      }
      const workflowName = name.trim();
      const workflowPath = path.join(workflowsPath, workflowName);
      try {
        await fs.access(workflowPath);
        return res.status(409).json({ error: 'Workflow already exists' });
      } catch {
        // Directory doesn't exist, which is what we want
      }
      await fs.mkdir(workflowPath, { recursive: true });
      const paramsPath = path.join(workflowPath, 'params.json');
      await fs.writeFile(paramsPath, JSON.stringify(params, null, 2), 'utf-8');
      if (params.parser === 'comfyui' && params.comfyui_config?.workflow) {
        const workflowFilePath = path.join(workflowPath, params.comfyui_config.workflow);
        const placeholderWorkflow = { _meta: { title: workflowName } };
        await fs.writeFile(workflowFilePath, JSON.stringify(placeholderWorkflow, null, 2), 'utf-8');
      }
      res.json({ success: true, name: workflowName });
    } catch (error) {
      console.error('Error creating workflow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/workflows/:name/duplicate', async (req, res) => {
    try {
      const sourceWorkflowName = decodeURIComponent(req.params.name);
      const { newName } = req.body;
      if (!newName || !newName.trim()) {
        return res.status(400).json({ error: 'New workflow name is required' });
      }
      const sourceWorkflowPath = path.join(workflowsPath, sourceWorkflowName);
      const newWorkflowName = newName.trim();
      const newWorkflowPath = path.join(workflowsPath, newWorkflowName);
      try {
        await fs.access(sourceWorkflowPath);
      } catch {
        return res.status(404).json({ error: 'Source workflow not found' });
      }
      try {
        await fs.access(newWorkflowPath);
        return res.status(409).json({ error: 'Workflow with that name already exists' });
      } catch {
        // ok
      }
      const sourceParams = await readParamsJson(sourceWorkflowPath);
      if (!sourceParams) {
        return res.status(400).json({ error: 'Source workflow params.json not found' });
      }
      await fs.mkdir(newWorkflowPath, { recursive: true });
      const files = await fs.readdir(sourceWorkflowPath, { withFileTypes: true });
      for (const file of files) {
        const sourcePath = path.join(sourceWorkflowPath, file.name);
        const destPath = path.join(newWorkflowPath, file.name);
        if (file.isFile()) {
          await fs.copyFile(sourcePath, destPath);
        } else if (file.isDirectory()) {
          await fs.cp(sourcePath, destPath, { recursive: true });
        }
      }
      const updatedParams = { ...sourceParams };
      if (updatedParams.label === sourceWorkflowName) {
        updatedParams.label = newWorkflowName;
      }
      const paramsPath = path.join(newWorkflowPath, 'params.json');
      await fs.writeFile(paramsPath, JSON.stringify(updatedParams, null, 2), 'utf-8');
      res.json({ success: true, name: newWorkflowName });
    } catch (error) {
      console.error('Error duplicating workflow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/workflows/:name', async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const workflowPath = path.join(workflowsPath, workflowName);
      try {
        await fs.access(workflowPath);
      } catch {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      await fs.rm(workflowPath, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/workflows/:name/upload', upload.single('file'), async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const workflowPath = path.join(workflowsPath, workflowName);
      try {
        await fs.access(workflowPath);
      } catch {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      try {
        await fs.access(req.file.path);
      } catch {
        // ignore
      }
      const params = await readParamsJson(workflowPath);
      if (req.file.filename === 'icon.jpg' && params?.icon) {
        const oldIconPath = path.join(workflowPath, params.icon.replace(/^\.\//, ''));
        const newIconPath = req.file.path;
        if (oldIconPath !== newIconPath) {
          try {
            await fs.unlink(oldIconPath);
          } catch (err) {
            if (err.code !== 'ENOENT') console.warn('Failed to delete old icon file:', err.message);
          }
        }
      }
      if (req.file.filename === 'workflow.json' && params?.comfyui_config?.workflow) {
        const oldWorkflowPath = path.join(workflowPath, params.comfyui_config.workflow.replace(/^\.\//, ''));
        if (oldWorkflowPath !== req.file.path) {
          try {
            await fs.unlink(oldWorkflowPath);
          } catch (err) {
            if (err.code !== 'ENOENT') console.warn('Failed to delete old workflow file:', err.message);
          }
        }
      }
      const filePath = path.relative(workflowsPath, req.file.path);
      const relativePath = filePath.replace(/\\/g, '/');
      res.json({
        success: true,
        filename: req.file.filename,
        path: relativePath,
        relativePath: `./${req.file.filename}`,
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/file/:filename', async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const filename = decodeURIComponent(req.params.filename);
      if (!filename || filename.includes('..') || path.isAbsolute(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const workflowPath = path.join(workflowsPath, workflowName);
      const filePath = path.join(workflowPath, filename);
      const resolvedPath = path.resolve(filePath);
      const resolvedWorkflowPath = path.resolve(workflowPath);
      if (!resolvedPath.startsWith(resolvedWorkflowPath)) {
        return res.status(403).json({ error: 'Invalid file path' });
      }
      try {
        await fs.access(filePath);
      } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
        throw err;
      }
      res.sendFile(resolvedPath);
    } catch (error) {
      console.error('Error serving workflow file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/workflows/:name/file/:filename', async (req, res) => {
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const filename = decodeURIComponent(req.params.filename);
      const workflowPath = path.join(workflowsPath, workflowName);
      const filePath = path.join(workflowPath, filename);
      try {
        await fs.access(workflowPath);
      } catch {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      try {
        const resolvedPath = path.resolve(filePath);
        const resolvedWorkflowPath = path.resolve(workflowPath);
        if (!resolvedPath.startsWith(resolvedWorkflowPath)) {
          return res.status(403).json({ error: 'Invalid file path' });
        }
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
        throw error;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/download', async (req, res) => {
    let archive = null;
    try {
      const workflowName = decodeURIComponent(req.params.name);
      const workflowPath = path.join(workflowsPath, workflowName);
      try {
        await fs.access(workflowPath);
      } catch {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      archive = archiver('zip', { zlib: { level: 9 } });
      let errorSent = false;
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!errorSent && !res.headersSent) {
          errorSent = true;
          res.status(500).json({ error: `Failed to create archive: ${err.message}` });
        }
      });
      res.on('error', (err) => {
        console.error('Response error:', err);
        if (archive) archive.abort();
      });
      const archivePromise = new Promise((resolve, reject) => {
        archive.on('end', () => resolve(undefined));
        archive.on('error', reject);
      });
      const zipFilename = `${workflowName}.zip`;
      res.attachment(zipFilename);
      res.type('application/zip');
      archive.pipe(res);
      const files = await fs.readdir(workflowPath, { withFileTypes: true });
      if (files.length === 0) {
        if (!errorSent && !res.headersSent) {
          errorSent = true;
          return res.status(400).json({ error: 'Workflow directory is empty' });
        }
      }
      for (const file of files) {
        const filePath = path.join(workflowPath, file.name);
        try {
          if (file.isFile()) {
            try {
              await fs.access(filePath);
              archive.file(filePath, { name: file.name });
            } catch (accessError) {
              console.warn(`File ${file.name} is not accessible, skipping:`, accessError.message);
            }
          } else if (file.isDirectory()) {
            archive.directory(filePath, file.name);
          }
        } catch (fileError) {
          console.error(`Error adding file ${file.name} to archive:`, fileError);
        }
      }
      archive.finalize();
      await archivePromise;
    } catch (error) {
      console.error('Error creating workflow zip:', error);
      if (archive) archive.abort();
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Failed to create workflow archive' });
      }
    }
  });

  return router;
}
