import path from 'path';
import fs from 'fs/promises';
import { Router } from 'express';
import archiver from 'archiver';
import { resolveWorkflowPath } from '../../lib/workflowPath.js';

export function createWorkflowsFileRouter({ workflowsPath, readParamsJson, upload, admin }) {
  const router = Router();

  router.post('/workflows/:name/upload', admin, upload.single('file'), async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      try { await fs.access(resolved.workflowPath); } catch { return res.status(404).json({ error: 'Workflow not found' }); }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const workflowPath = resolved.workflowPath;
      const workflowPrefix = path.resolve(workflowPath) + path.sep;
      const params = await readParamsJson(workflowPath);
      if (req.file.filename === 'icon.jpg' && params?.icon) {
        const oldIconPath = path.resolve(workflowPath, params.icon.replace(/^\.\//, ''));
        if (oldIconPath.startsWith(workflowPrefix) && oldIconPath !== req.file.path) {
          try { await fs.unlink(oldIconPath); } catch (err) { if (err.code !== 'ENOENT') console.warn('Failed to delete old icon file:', err.message); }
        } else if (!oldIconPath.startsWith(workflowPrefix)) {
          console.warn('Skipped deleting old icon: path outside workflow directory');
        }
      }
      if (req.file.filename === 'workflow.json' && params?.comfyui_config?.workflow) {
        const oldWorkflowPath = path.resolve(workflowPath, params.comfyui_config.workflow.replace(/^\.\//, ''));
        if (oldWorkflowPath.startsWith(workflowPrefix) && oldWorkflowPath !== req.file.path) {
          try { await fs.unlink(oldWorkflowPath); } catch (err) { if (err.code !== 'ENOENT') console.warn('Failed to delete old workflow file:', err.message); }
        } else if (!oldWorkflowPath.startsWith(workflowPrefix)) {
          console.warn('Skipped deleting old workflow file: path outside workflow directory');
        }
      }
      const filePath = path.relative(workflowsPath, req.file.path);
      res.json({ success: true, filename: req.file.filename, path: filePath.replace(/\\/g, '/'), relativePath: `./${req.file.filename}` });
    } catch (error) {
      console.error('Error uploading file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/workflows/:name/file/:filename', async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const filename = decodeURIComponent(req.params.filename);
      if (!filename || filename.includes('..') || path.isAbsolute(filename)) return res.status(400).json({ error: 'Invalid filename' });
      const filePath = path.join(resolved.workflowPath, filename);
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(path.resolve(resolved.workflowPath))) return res.status(403).json({ error: 'Invalid file path' });
      try { await fs.access(filePath); } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
        throw err;
      }
      res.sendFile(resolvedPath);
    } catch (error) {
      console.error('Error serving workflow file:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/workflows/:name/file/:filename', admin, async (req, res) => {
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      const filename = decodeURIComponent(req.params.filename);
      if (!filename || filename.includes('..') || path.isAbsolute(filename)) return res.status(400).json({ error: 'Invalid filename' });
      try { await fs.access(resolved.workflowPath); } catch { return res.status(404).json({ error: 'Workflow not found' }); }
      const filePath = path.join(resolved.workflowPath, filename);
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(path.resolve(resolved.workflowPath))) return res.status(403).json({ error: 'Invalid file path' });
      try {
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

  router.get('/workflows/:name/download', admin, async (req, res) => {
    let archive = null;
    try {
      const resolved = resolveWorkflowPath(workflowsPath, req.params.name);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      try { await fs.access(resolved.workflowPath); } catch { return res.status(404).json({ error: 'Workflow not found' }); }
      archive = archiver('zip', { zlib: { level: 9 } });
      let errorSent = false;
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!errorSent && !res.headersSent) { errorSent = true; res.status(500).json({ error: `Failed to create archive: ${err.message}` }); }
      });
      res.on('error', (err) => { console.error('Response error:', err); if (archive) archive.abort(); });
      const archivePromise = new Promise((resolve, reject) => { archive.on('end', () => resolve(undefined)); archive.on('error', reject); });
      res.attachment(`${resolved.workflowName}.zip`);
      res.type('application/zip');
      archive.pipe(res);
      const files = await fs.readdir(resolved.workflowPath, { withFileTypes: true });
      if (files.length === 0) { if (!errorSent && !res.headersSent) { errorSent = true; return res.status(400).json({ error: 'Workflow directory is empty' }); } }
      for (const file of files) {
        const filePath = path.join(resolved.workflowPath, file.name);
        try {
          if (file.isFile()) {
            try { await fs.access(filePath); archive.file(filePath, { name: file.name }); } catch (e) { console.warn(`File ${file.name} not accessible, skipping:`, e.message); }
          } else if (file.isDirectory()) {
            archive.directory(filePath, file.name);
          }
        } catch (fileError) { console.error(`Error adding file ${file.name} to archive:`, fileError); }
      }
      archive.finalize();
      await archivePromise;
    } catch (error) {
      console.error('Error creating workflow zip:', error);
      if (archive) archive.abort();
      if (!res.headersSent) res.status(500).json({ error: error.message || 'Failed to create workflow archive' });
    }
  });

  return router;
}
