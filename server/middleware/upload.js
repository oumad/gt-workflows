import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import { resolveWorkflowPath, sanitizeFilename } from '../lib/workflowPath.js';

const FILE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB

export function createUploadMiddleware(workflowsPath) {
  const resolvedRoot = path.resolve(workflowsPath);

  const storage = multer.diskStorage({
    destination: async (req, _file, cb) => {
      const rawName = req.params.name || req.body?.workflowName;
      if (!rawName) {
        return cb(new Error('Workflow name is required'));
      }
      const resolved = resolveWorkflowPath(workflowsPath, rawName);
      if (!resolved.ok) {
        return cb(new Error(resolved.error || 'Invalid workflow name'));
      }
      const workflowPath = resolved.workflowPath;
      if (!workflowPath.startsWith(resolvedRoot + path.sep)) {
        return cb(new Error('Invalid path'));
      }
      try {
        await fs.mkdir(workflowPath, { recursive: true });
        cb(null, workflowPath);
      } catch (error) {
        cb(error);
      }
    },
    filename: async (req, file, cb) => {
      let finalFilename;
      if (file.mimetype && file.mimetype.startsWith('image/')) {
        finalFilename = 'icon.jpg';
        const rawName = req.params.name || req.body?.workflowName;
        if (rawName) {
          const resolved = resolveWorkflowPath(workflowsPath, rawName);
          if (resolved.ok && resolved.workflowPath.startsWith(resolvedRoot + path.sep)) {
            try {
              const iconPath = path.join(resolved.workflowPath, 'icon.jpg');
              await fs.access(iconPath);
              await fs.unlink(iconPath);
            } catch (err) {
              if (err.code !== 'ENOENT') {
                console.warn('Failed to delete old icon before upload:', err.message);
              }
            }
          }
        }
      } else if (file.mimetype === 'application/json' || (file.originalname && file.originalname.toLowerCase().endsWith('.json'))) {
        finalFilename = 'workflow.json';
      } else {
        const safe = sanitizeFilename(file.originalname);
        finalFilename = safe || 'file';
      }
      cb(null, finalFilename);
    },
  });

  return multer({
    storage,
    limits: { fileSize: FILE_SIZE_LIMIT },
  });
}
