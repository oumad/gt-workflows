import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';

const FILE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB

export function createUploadMiddleware(workflowsPath) {
  const storage = multer.diskStorage({
    destination: async (req, _file, cb) => {
      const workflowName = req.params.name || req.body.workflowName;
      if (!workflowName) {
        return cb(new Error('Workflow name is required'));
      }
      const workflowPath = path.join(workflowsPath, workflowName);
      try {
        await fs.mkdir(workflowPath, { recursive: true });
        cb(null, workflowPath);
      } catch (error) {
        cb(error);
      }
    },
    filename: async (req, file, cb) => {
      let finalFilename = file.originalname;
      if (file.mimetype && file.mimetype.startsWith('image/')) {
        finalFilename = 'icon.jpg';
        const workflowName = req.params.name || req.body.workflowName;
        if (workflowName) {
          try {
            const workflowPath = path.join(workflowsPath, workflowName);
            const iconPath = path.join(workflowPath, 'icon.jpg');
            try {
              await fs.access(iconPath);
              await fs.unlink(iconPath);
            } catch (err) {
              if (err.code !== 'ENOENT') {
                console.warn('Failed to delete old icon before upload:', err.message);
              }
            }
          } catch (err) {
            console.warn('Error during icon cleanup:', err.message);
          }
        }
      } else if (file.mimetype === 'application/json' || file.originalname.toLowerCase().endsWith('.json')) {
        finalFilename = 'workflow.json';
      }
      cb(null, finalFilename);
    },
  });

  return multer({
    storage,
    limits: { fileSize: FILE_SIZE_LIMIT },
  });
}
