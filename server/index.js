import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3011;
const WORKFLOWS_PATH = path.join(__dirname, '../data/gt-workflows');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const workflowName = req.params.name || req.body.workflowName;
    if (!workflowName) {
      return cb(new Error('Workflow name is required'));
    }
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    try {
      await fs.mkdir(workflowPath, { recursive: true });
      cb(null, workflowPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Rename image files to icon.jpg, JSON workflow files to workflow.json
    let finalFilename = file.originalname;
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      // Always use .jpg for images since they're compressed to JPEG format
      finalFilename = 'icon.jpg';
    } else if (file.mimetype === 'application/json' || file.originalname.toLowerCase().endsWith('.json')) {
      // Rename JSON workflow files to workflow.json for consistency
      finalFilename = 'workflow.json';
    }
    cb(null, finalFilename);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper function to read params.json
async function readParamsJson(workflowPath) {
  const paramsPath = path.join(workflowPath, 'params.json');
  try {
    // Check if file exists first
    await fs.access(paramsPath);
    const content = await fs.readFile(paramsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // If file doesn't exist, return null instead of throwing
    if (error.code === 'ENOENT') {
      return null;
    }
    // For other errors, still throw
    throw new Error(`Failed to read params.json: ${error.message}`);
  }
}

// Helper function to find workflow JSON file
async function findWorkflowJson(workflowPath) {
  try {
    const files = await fs.readdir(workflowPath);
    const jsonFiles = files.filter(
      (f) => f.endsWith('.json') && f !== 'params.json' && !f.includes('node-parsers')
    );
    
    if (jsonFiles.length === 0) return null;
    
    // Prefer files with 'api' in the name, or just take the first one
    const apiFile = jsonFiles.find((f) => f.includes('api'));
    const workflowFile = apiFile || jsonFiles[0];
    
    const content = await fs.readFile(path.join(workflowPath, workflowFile), 'utf-8');
    return {
      filename: workflowFile,
      content: JSON.parse(content),
    };
  } catch (error) {
    return null;
  }
}

// List all workflows
app.get('/api/workflows/list', async (req, res) => {
  try {
        const entries = await fs.readdir(WORKFLOWS_PATH, { withFileTypes: true });
        const workflows = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const workflowPath = path.join(WORKFLOWS_PATH, entry.name);
                
        try {
          const params = await readParamsJson(workflowPath);
                    
          // Skip directories without params.json
          if (!params) {
                        continue;
          }
          
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
          // Skip workflows that can't be read
        }
      }
    }

        res.json(workflows);
  } catch (error) {
        console.error('Error listing workflows:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get workflow params
app.get('/api/workflows/:name/params', async (req, res) => {
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    
    const params = await readParamsJson(workflowPath);
    res.json(params);
  } catch (error) {
    console.error('Error fetching workflow params:', error);
    res.status(404).json({ error: error.message });
  }
});

// Get workflow JSON
app.get('/api/workflows/:name/workflow', async (req, res) => {
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    
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

// Save workflow params
app.put('/api/workflows/:name/params', async (req, res) => {
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    const paramsPath = path.join(workflowPath, 'params.json');
    
    // Verify workflow exists
    try {
      await fs.access(workflowPath);
    } catch {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Write params.json
    await fs.writeFile(paramsPath, JSON.stringify(req.body, null, 2), 'utf-8');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving workflow params:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new workflow
app.post('/api/workflows/create', async (req, res) => {
  try {
        const { name, params } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Workflow name is required' });
    }
    
    const workflowName = name.trim();
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
        
    // Check if workflow already exists
    try {
      await fs.access(workflowPath);
            return res.status(409).json({ error: 'Workflow already exists' });
    } catch {
      // Directory doesn't exist, which is what we want
    }
    
    // Create workflow directory
    await fs.mkdir(workflowPath, { recursive: true });
        
    // Create params.json
    const paramsPath = path.join(workflowPath, 'params.json');
    await fs.writeFile(paramsPath, JSON.stringify(params, null, 2), 'utf-8');
        
    // If it's a ComfyUI workflow, create a placeholder workflow.json
    if (params.parser === 'comfyui' && params.comfyui_config?.workflow) {
      const workflowFilePath = path.join(workflowPath, params.comfyui_config.workflow);
            const placeholderWorkflow = {
        _meta: {
          title: workflowName,
        },
      };
      await fs.writeFile(workflowFilePath, JSON.stringify(placeholderWorkflow, null, 2), 'utf-8');
          }
    
        res.json({ success: true, name: workflowName });
  } catch (error) {
        console.error('Error creating workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete workflow
app.delete('/api/workflows/:name', async (req, res) => {
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    
    // Verify workflow exists
    try {
      await fs.access(workflowPath);
    } catch {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Delete workflow directory recursively
    await fs.rm(workflowPath, { recursive: true, force: true });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload file to workflow directory
app.post('/api/workflows/:name/upload', upload.single('file'), async (req, res) => {
  try {
        const workflowName = decodeURIComponent(req.params.name);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
        
    // Verify workflow exists
    try {
      await fs.access(workflowPath);
    } catch {
            return res.status(404).json({ error: 'Workflow not found' });
    }
    
    if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
    }
    
        
    // Verify file actually exists on disk
    try {
      await fs.access(req.file.path);
          } catch (error) {
          }
    
    // Delete old files if they exist (icon or workflow)
    const params = await readParamsJson(workflowPath);
    
    // If this is an icon upload, delete the old icon file if it exists
    if (params?.icon && req.file.filename === 'icon.jpg') {
      const oldIconPath = path.join(workflowPath, params.icon.replace(/^\.\//, ''));
      try {
        await fs.unlink(oldIconPath);
      } catch (error) {
        // Ignore if file doesn't exist
        if (error.code !== 'ENOENT') {
          console.warn('Failed to delete old icon:', error.message);
        }
      }
    }
    
    // If this is a workflow JSON upload, delete the old workflow file if it exists
    if (req.file.filename === 'workflow.json' && params?.comfyui_config?.workflow) {
      const oldWorkflowPath = path.join(workflowPath, params.comfyui_config.workflow.replace(/^\.\//, ''));
            // Only delete if it's different from the new filename
      if (oldWorkflowPath !== req.file.path) {
        try {
          await fs.unlink(oldWorkflowPath);
                  } catch (error) {
          // Ignore if file doesn't exist
          if (error.code !== 'ENOENT') {
                        console.warn('Failed to delete old workflow file:', error.message);
          }
        }
      }
    }
    
    const filePath = path.relative(WORKFLOWS_PATH, req.file.path);
    const relativePath = filePath.replace(/\\/g, '/'); // Normalize path separators
    
        
    res.json({ 
      success: true, 
      filename: req.file.filename,
      path: relativePath,
      relativePath: `./${req.file.filename}` // Relative path format used in params.json
    });
  } catch (error) {
        console.error('Error uploading file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete file from workflow directory
app.delete('/api/workflows/:name/file/:filename', async (req, res) => {
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const filename = decodeURIComponent(req.params.filename);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    const filePath = path.join(workflowPath, filename);
    
    // Verify workflow exists
    try {
      await fs.access(workflowPath);
    } catch {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Verify file exists and is within workflow directory (security check)
    try {
      const resolvedPath = path.resolve(filePath);
      const resolvedWorkflowPath = path.resolve(workflowPath);
      if (!resolvedPath.startsWith(resolvedWorkflowPath)) {
        return res.status(403).json({ error: 'Invalid file path' });
      }
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      throw error;
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve static files from workflows directory (for icons)
app.use('/data/gt-workflows', express.static(WORKFLOWS_PATH));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

