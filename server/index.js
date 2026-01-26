import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3011;
// Allow custom workflows path via environment variable, fallback to default location
const WORKFLOWS_PATH = process.env.GT_WORKFLOWS_PATH 
  ? path.resolve(process.env.GT_WORKFLOWS_PATH)
  : path.join(__dirname, '../data/gt-workflows');

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

// Health check endpoint for ComfyUI servers
// Based on ComfyUI API: https://github.com/Comfy-Org/ComfyUI/tree/master/comfy_api
// Tries multiple endpoints in order of reliability:
// 1. /object_info - Core API endpoint that returns node information (most reliable)
// 2. /system_stats - System statistics endpoint
// 3. /queue - Queue status endpoint
app.post('/api/servers/health-check', async (req, res) => {
  try {
    const { serverUrl } = req.body;
    
    if (!serverUrl) {
      return res.status(400).json({ error: 'Server URL is required' });
    }

    // Normalize server URL (remove trailing slash)
    const normalizedUrl = serverUrl.replace(/\/$/, '');
    
    // Try multiple ComfyUI endpoints as fallbacks
    // /system_stats is the most reliable GET endpoint (confirmed working)
    // /object_info requires POST, so we'll try GET first, then POST if needed
    // /queue is also a GET endpoint
    const endpoints = [
      { path: '/system_stats', name: 'system_stats', method: 'GET' },
      { path: '/queue', name: 'queue', method: 'GET' },
      { path: '/object_info', name: 'object_info', method: 'POST' },
    ];

    let lastError = null;
    let lastStatus = null;
    
    // Try endpoints sequentially with a small delay to avoid overwhelming the server
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      const healthCheckUrl = `${normalizedUrl}${endpoint.path}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout per endpoint
      
      try {
        // Add a small delay between endpoint attempts (except for the first one)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between endpoints
        }
        
        const fetchOptions = {
          method: endpoint.method,
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
          },
        };
        
        // Add body and Content-Type for POST requests
        if (endpoint.method === 'POST') {
          fetchOptions.headers['Content-Type'] = 'application/json';
          fetchOptions.body = JSON.stringify({});
        }
        
        const response = await fetch(healthCheckUrl, fetchOptions);
        
        clearTimeout(timeoutId);
        lastStatus = response.status;
        
        // Only log errors, not successful checks
        if (response.status >= 400) {
          console.log(`[Health Check] ${endpoint.name} returned ${response.status} for ${normalizedUrl}`);
        }
        
        // If we get a response with status < 500, the server is reachable
        // Status 200-299: Success
        // Status 400-499: Client errors (server is up, but endpoint might not exist or need auth)
        // Status 500+: Server errors (server might be having issues)
        if (response.status < 500) {
          // Server is responding - consider it healthy
          const isHealthy = response.status >= 200 && response.status < 400;
          
          // Success - no logging needed to reduce noise
          
          res.json({ 
            healthy: isHealthy, 
            serverUrl: normalizedUrl,
            status: response.status,
            endpoint: endpoint.name,
            timestamp: new Date().toISOString(),
            ...(response.status >= 400 && response.status < 500 ? {
              warning: `Endpoint returned ${response.status}, server may require authentication or endpoint may not be available`
            } : {})
          });
          return;
        } else {
          // Server error (5xx)
          lastError = `Server returned status ${response.status} from ${endpoint.name}`;
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          lastError = `Timeout checking ${endpoint.name} (3s timeout)`;
        } else {
          // Network errors, DNS failures, connection refused, etc.
          const errorMsg = fetchError.message || 'Connection failed';
          const errorCode = fetchError.code || '';
          // Only log actual errors, not transient network issues
          if (errorCode && (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND')) {
            console.error(`[Health Check] Connection error for ${normalizedUrl}: ${errorMsg}`);
          }
          // Check for common error types
          if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
            lastError = `Cannot connect to server: ${errorMsg}`;
          } else if (errorMsg.includes('fetch failed') || errorMsg.includes('network')) {
            lastError = `Network error: ${errorMsg}`;
          } else {
            lastError = `${endpoint.name}: ${errorMsg}`;
          }
        }
        // Continue to next endpoint
        continue;
      }
    }
    
    // If all endpoints failed, server is unhealthy
    res.json({ 
      healthy: false, 
      serverUrl: normalizedUrl,
      error: lastError || 'All health check endpoints failed',
      lastStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error checking server health:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download workflow as zip
app.get('/api/workflows/:name/download', async (req, res) => {
  let archive = null;
  
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
    
    // Verify workflow exists
    try {
      await fs.access(workflowPath);
    } catch {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    // Create zip archive
    archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });
    
    // Track if we've sent an error response
    let errorSent = false;
    
    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!errorSent && !res.headersSent) {
        errorSent = true;
        res.status(500).json({ error: `Failed to create archive: ${err.message}` });
      }
    });
    
    // Handle response errors
    res.on('error', (err) => {
      console.error('Response error:', err);
      if (archive) {
        archive.abort();
      }
    });
    
    // Wait for archive to finish
    const archivePromise = new Promise((resolve, reject) => {
      archive.on('end', () => {
        console.log(`Archive finalized. Total bytes: ${archive.pointer()}`);
        resolve(undefined);
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
    });
    
    // Set response headers
    const zipFilename = `${workflowName}.zip`;
    res.attachment(zipFilename);
    res.type('application/zip');
    
    // Pipe archive to response
    archive.pipe(res);
    
    // Read all files in the workflow directory
    const files = await fs.readdir(workflowPath, { withFileTypes: true });
    
    if (files.length === 0) {
      if (!errorSent && !res.headersSent) {
        errorSent = true;
        return res.status(400).json({ error: 'Workflow directory is empty' });
      }
    }
    
    // Add each file to the archive
    for (const file of files) {
      const filePath = path.join(workflowPath, file.name);
      
      try {
        if (file.isFile()) {
          // Verify file exists before adding
          try {
            await fs.access(filePath);
            // Add file to archive with its name (not full path)
            archive.file(filePath, { name: file.name });
          } catch (accessError) {
            console.warn(`File ${file.name} is not accessible, skipping:`, accessError.message);
          }
        } else if (file.isDirectory()) {
          // Add directory recursively
          archive.directory(filePath, file.name);
        }
      } catch (fileError) {
        console.error(`Error adding file ${file.name} to archive:`, fileError);
        // Continue with other files even if one fails
      }
    }
    
    // Finalize the archive and wait for it to complete
    archive.finalize();
    await archivePromise;
    
  } catch (error) {
    console.error('Error creating workflow zip:', error);
    if (archive) {
      archive.abort();
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to create workflow archive' });
    }
  }
});

// Serve static files from workflows directory (for icons)
app.use('/data/gt-workflows', express.static(WORKFLOWS_PATH));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Workflows directory: ${WORKFLOWS_PATH}`);
});

