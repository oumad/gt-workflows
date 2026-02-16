import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import archiver from 'archiver';
import Queue from 'bull';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root so auth env vars are found when running via npm run dev:all
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = 3011;

// Optional Bull queue for workflow job stats (read-only). Same Redis + queue name as Workflow Studio.
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_HOST;
const BULL_QUEUE_NAME = process.env.BULL_QUEUE_NAME || 'workflow-studio-comfyui-process-queue';
let statsQueue = null;
if (REDIS_URL) {
  try {
    statsQueue = new Queue(BULL_QUEUE_NAME, REDIS_URL);
  } catch (err) {
    console.warn('[Stats] Bull queue init failed:', err.message);
  }
}
// Allow custom workflows path via environment variable, fallback to default location
const WORKFLOWS_PATH = process.env.GT_WORKFLOWS_PATH 
  ? path.resolve(process.env.GT_WORKFLOWS_PATH)
  : path.join(__dirname, '../data/gt-workflows');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Optional HTTP Basic Auth (set GT_WF_AUTH_USER and GT_WF_AUTH_PASSWORD in env)
const AUTH_USER = process.env.GT_WF_AUTH_USER;
const AUTH_PASS = process.env.GT_WF_AUTH_PASSWORD;
const AUTH_ENABLED = typeof AUTH_USER === 'string' && AUTH_USER.length > 0 && typeof AUTH_PASS === 'string';
// Session timeout in seconds (default 24h). Only sent to client when auth is enabled.
const SESSION_MAX_TIME = Math.max(60, parseInt(process.env.SESSION_MAX_TIME, 10) || 86400);

// Do not send WWW-Authenticate so the browser never shows a native Basic Auth popup; the app uses its own login page.
function basicAuthMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const b64 = authHeader.slice(6);
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const user = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
    if (user !== AUTH_USER || pass !== AUTH_PASS) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

app.use('/api', basicAuthMiddleware);
app.use('/data', basicAuthMiddleware);

// Lightweight ping for auth check (no Redis/workflows needed). When auth is enabled, returns sessionMaxTime for client-side session expiry.
app.get('/api/ping', (req, res) => {
  const payload = { ok: true };
  if (AUTH_ENABLED) payload.sessionMaxTime = SESSION_MAX_TIME;
  res.json(payload);
});

// Proxy ComfyUI server logs (must be before /api/workflows/:name to avoid route conflict)
app.get('/api/servers/logs', async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({ error: 'Server URL (url) is required' });
    }
    const base = rawUrl.trim().replace(/\/$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid server URL' });
    }
    const urlsToTry = [`${base}/internal/logs/raw`, `${base}/internal/logs`];
    let lastError = null;
    for (const logUrl of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(logUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'text/plain, text/html, */*' },
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          lastError = `Logs endpoint returned ${response.status}`;
          continue;
        }
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        const isHtml = contentType.includes('text/html');
        return res.json({ content: text, contentType: isHtml ? 'text/html' : 'text/plain' });
      } catch (err) {
        lastError = err.message || 'Failed to fetch logs';
        continue;
      }
    }
    res.status(502).json({ error: lastError || 'Could not load logs' });
  } catch (error) {
    console.error('Error fetching server logs:', error);
    res.status(500).json({ error: error.message });
  }
});

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
  filename: async (req, file, cb) => {
    // Rename image files to icon.jpg, JSON workflow files to workflow.json
    let finalFilename = file.originalname;
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      // Always use .jpg for images since they're compressed to JPEG format
      finalFilename = 'icon.jpg';
      
      // Delete old icon.jpg file if it exists to ensure proper replacement
      const workflowName = req.params.name || req.body.workflowName;
      if (workflowName) {
        try {
          const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
          const iconPath = path.join(workflowPath, 'icon.jpg');
          try {
            await fs.access(iconPath);
            // File exists, delete it so multer can save the new one
            await fs.unlink(iconPath);
          } catch (error) {
            // Ignore if file doesn't exist - that's fine
            if (error.code !== 'ENOENT') {
              console.warn('Failed to delete old icon before upload:', error.message);
            }
          }
        } catch (error) {
          // Ignore errors in cleanup - continue with upload
          console.warn('Error during icon cleanup:', error.message);
        }
      }
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

// Duplicate workflow
app.post('/api/workflows/:name/duplicate', async (req, res) => {
  try {
    const sourceWorkflowName = decodeURIComponent(req.params.name);
    const { newName } = req.body;
    
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'New workflow name is required' });
    }
    
    const sourceWorkflowPath = path.join(WORKFLOWS_PATH, sourceWorkflowName);
    const newWorkflowName = newName.trim();
    const newWorkflowPath = path.join(WORKFLOWS_PATH, newWorkflowName);
    
    // Verify source workflow exists
    try {
      await fs.access(sourceWorkflowPath);
    } catch {
      return res.status(404).json({ error: 'Source workflow not found' });
    }
    
    // Check if new workflow already exists
    try {
      await fs.access(newWorkflowPath);
      return res.status(409).json({ error: 'Workflow with that name already exists' });
    } catch {
      // Directory doesn't exist, which is what we want
    }
    
    // Read source workflow params
    const sourceParams = await readParamsJson(sourceWorkflowPath);
    if (!sourceParams) {
      return res.status(400).json({ error: 'Source workflow params.json not found' });
    }
    
    // Create new workflow directory
    await fs.mkdir(newWorkflowPath, { recursive: true });
    
    // Copy all files from source to new workflow
    const files = await fs.readdir(sourceWorkflowPath, { withFileTypes: true });
    
    for (const file of files) {
      const sourcePath = path.join(sourceWorkflowPath, file.name);
      const destPath = path.join(newWorkflowPath, file.name);
      
      if (file.isFile()) {
        // Copy file
        await fs.copyFile(sourcePath, destPath);
      } else if (file.isDirectory()) {
        // Copy directory recursively
        await fs.cp(sourcePath, destPath, { recursive: true });
      }
    }
    
    // Update params.json with new workflow name (update label if it matches the old name)
    const updatedParams = { ...sourceParams };
    if (updatedParams.label === sourceWorkflowName) {
      updatedParams.label = newWorkflowName;
    }
    
    // Write updated params.json
    const paramsPath = path.join(newWorkflowPath, 'params.json');
    await fs.writeFile(paramsPath, JSON.stringify(updatedParams, null, 2), 'utf-8');
    
    res.json({ success: true, name: newWorkflowName });
  } catch (error) {
    console.error('Error duplicating workflow:', error);
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
    
    // If this is an icon upload, delete any old icon file referenced in params if it's different
    // Note: icon.jpg is already deleted in the filename callback before multer saves
    if (req.file.filename === 'icon.jpg' && params?.icon) {
      const oldIconPath = path.join(workflowPath, params.icon.replace(/^\.\//, ''));
      const newIconPath = req.file.path;
      // Only delete if it's a different file (not the same as the new icon.jpg)
      if (oldIconPath !== newIconPath) {
        try {
          await fs.unlink(oldIconPath);
        } catch (error) {
          // Ignore if file doesn't exist
          if (error.code !== 'ENOENT') {
            console.warn('Failed to delete old icon file:', error.message);
          }
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

// Get file from workflow directory (for authenticated image display; <img> cannot send auth headers)
app.get('/api/workflows/:name/file/:filename', async (req, res) => {
  try {
    const workflowName = decodeURIComponent(req.params.name);
    const filename = decodeURIComponent(req.params.filename);
    if (!filename || filename.includes('..') || path.isAbsolute(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const workflowPath = path.join(WORKFLOWS_PATH, workflowName);
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

// --- Helper: map Bull job to activity job (id, name, user, server, processedOn, finishedOn, timestamp). Used for queue?list=1, activity, and usage includeJobs. ---
function toActivityJob(job) {
  if (!job) return null;
  const data = job.data || {};
  const workflow = data.workflow || {};
  const wfName = workflow.name;
  const serverUrl = workflow.config?.comfyui_config?.serverUrl;
  const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : '';
  const userObj = data.executionContext?.context?.user;
  const processedOn = job.processedOn != null ? job.processedOn : undefined;
  const finishedOn = job.finishedOn != null ? job.finishedOn : undefined;
  const timestamp = job.timestamp != null ? job.timestamp : undefined;
  let user = '';
  if (userObj) {
    user = userObj.name || userObj.email || userObj.id || '';
  }
  return {
    id: String(job.id),
    name: typeof wfName === 'string' ? wfName : (job.name || ''),
    user: String(user || '—'),
    server: server || '—',
    processedOn: processedOn,
    finishedOn: finishedOn,
    timestamp: timestamp,
  };
}

// --- Queue stats (read-only). Same endpoint as job stats; ?list=1 adds active/waiting job lists for Activity tab. ---
app.get('/api/stats/queue', async (req, res) => {
  const queue = statsQueue;
  if (!queue) {
    return res.json({
      configured: false,
      message: 'Set REDIS_URL (and optionally BULL_QUEUE_NAME) to see queue stats.',
      counts: null,
      ...(req.query.list ? { active: [], waiting: [] } : {}),
    });
  }
  try {
    const counts = await queue.getJobCounts();
    const payload = {
      configured: true,
      counts: {
        waiting: counts.waiting ?? counts.wait ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      },
    };
    if (req.query.list) {
      const [activeRaw, waitingRaw] = await Promise.all([
        queue.getJobs(['active'], 0, 9999),
        queue.getJobs(['waiting'], 0, 9999),
      ]);
      payload.active = (activeRaw || []).filter((j) => j != null).map(toActivityJob).filter(Boolean);
      payload.waiting = (waitingRaw || []).filter((j) => j != null).map(toActivityJob).filter(Boolean);
    }
    res.json(payload);
  } catch (err) {
    console.error('Error fetching queue counts:', err);
    res.status(500).json({
      configured: true,
      error: err.message,
      counts: null,
      ...(req.query.list ? { active: [], waiting: [] } : {}),
    });
  }
});

// --- Job logs for Activity tab (Bull job logs by job id). ---
app.get('/api/stats/job/:jobId/logs', async (req, res) => {
  const queue = statsQueue;
  if (!queue) {
    return res.status(503).json({ error: 'Queue not configured (REDIS_URL).' });
  }
  const jobId = req.params.jobId;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID required.' });
  }
  try {
    const result = await queue.getJobLogs(jobId, 0, -1, true);
    res.json({ logs: result.logs || [], count: result.count || 0 });
  } catch (err) {
    console.error('Error fetching job logs:', err);
    res.status(500).json({ error: err.message || 'Failed to load job logs' });
  }
});

// --- Activity tab: active and waiting job lists (same queue as job stats). ---
app.get('/api/stats/activity', async (req, res) => {
  if (!statsQueue) {
    return res.json({
      configured: false,
      active: [],
      waiting: [],
      message: 'Set REDIS_URL (and optionally BULL_QUEUE_NAME) to see activity.',
    });
  }
  try {
    const [activeRaw, waitingRaw] = await Promise.all([
      statsQueue.getJobs(['active']),
      statsQueue.getJobs(['waiting']),
    ]);
    const active = (activeRaw || []).filter((j) => j != null).map(toActivityJob).filter(Boolean);
    const waiting = (waitingRaw || []).filter((j) => j != null).map(toActivityJob).filter(Boolean);
    res.json({
      configured: true,
      active,
      waiting,
    });
  } catch (err) {
    console.error('Error fetching activity jobs:', err);
    res.status(500).json({
      configured: true,
      active: [],
      waiting: [],
      error: err.message,
    });
  }
});

function jobMatchesUser(job, userFilter) {
  if (!userFilter) return true;
  const user = job?.data?.executionContext?.context?.user;
  if (!user) return false;
  const label = user.name || user.email || user.id;
  return label && String(label) === String(userFilter);
}

app.get('/api/stats/usage', async (req, res) => {
  const queue = statsQueue;
  if (!queue) {
    return res.json({
      configured: false,
      message: 'Set REDIS_URL (and optionally BULL_QUEUE_NAME) to see workflow usage.',
      workflowUsage: [],
      serverUsage: [],
      userActivity: [],
    });
  }
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 100), 2000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const from = req.query.from ? new Date(req.query.from).getTime() : null;
    const to = req.query.to ? new Date(req.query.to).getTime() : null;
    const userFilter = typeof req.query.user === 'string' && req.query.user.trim() ? req.query.user.trim() : null;
    const scanLimit = Math.min(Math.max(parseInt(req.query.scanLimit, 10) || 10000, 1000), 20000);
    const includeJobs = req.query.includeJobs === '1' || req.query.includeJobs === 'true';

    let jobs;
    let totalScanned = null;
    const timeRange = from != null && to != null && !Number.isNaN(from) && !Number.isNaN(to);

    if (timeRange) {
      const chunkSize = Math.min(limit, 2000);
      const raw = await queue.getJobs(['completed'], offset, offset + chunkSize - 1);
      const rawFiltered = (raw || []).filter((j) => j != null);
      totalScanned = offset + rawFiltered.length;
      jobs = rawFiltered.filter((job) => {
        const ts = job.finishedOn ?? job.processedOn ?? job.timestamp;
        if (ts == null) return false;
        if (ts < from || ts > to) return false;
        return jobMatchesUser(job, userFilter);
      });
    } else {
      const raw = await queue.getJobs(['completed'], offset, offset + limit - 1);
      jobs = (raw || []).filter((j) => j != null);
      if (userFilter) {
        jobs = jobs.filter((job) => jobMatchesUser(job, userFilter));
      }
    }

    const byWorkflowName = {};
    const byServer = {};
    const byUser = {};
    for (const job of jobs) {
      if (!job) continue;
      const data = job.data || {};
      const workflow = data.workflow;
      const wfName = workflow?.name;
      const user = data.executionContext?.context?.user;
      let userLabel = null;
      if (user) {
        userLabel = user.name || user.email || user.id || 'Unknown';
        if (typeof userLabel === 'string' && userLabel !== 'Unknown') {
          byUser[userLabel] = (byUser[userLabel] || 0) + 1;
        } else if (user.id) {
          userLabel = user.id;
          byUser[user.id] = (byUser[user.id] || 0) + 1;
        }
      }
      if (wfName && typeof wfName === 'string') {
        if (!byWorkflowName[wfName]) {
          byWorkflowName[wfName] = { count: 0, users: new Set() };
        }
        byWorkflowName[wfName].count += 1;
        if (userLabel) byWorkflowName[wfName].users.add(String(userLabel));
      }
      const serverUrl = workflow?.config?.comfyui_config?.serverUrl;
      if (serverUrl && typeof serverUrl === 'string') {
        const normalized = serverUrl.replace(/\/$/, '');
        byServer[normalized] = (byServer[normalized] || 0) + 1;
      }
    }
    const workflowUsage = Object.entries(byWorkflowName)
      .map(([name, { count, users }]) => ({
        name,
        count,
        users: Array.from(users),
      }))
      .sort((a, b) => b.count - a.count);
    const serverUsage = Object.entries(byServer)
      .map(([server, count]) => ({ server, count }))
      .sort((a, b) => b.count - a.count);
    const userActivity = Object.entries(byUser)
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count);

    const payload = {
      configured: true,
      workflowUsage,
      serverUsage,
      userActivity,
      jobsSampled: jobs.length,
    };
    if (timeRange) {
      payload.from = req.query.from;
      payload.to = req.query.to;
      payload.totalScanned = totalScanned;
    } else {
      payload.offset = offset;
      payload.limit = limit;
    }
    if (userFilter) payload.userFilter = userFilter;
    if (includeJobs) {
      payload.jobs = jobs.map((j) => toActivityJob(j)).filter(Boolean);
    }
    res.json(payload);
  } catch (err) {
    console.error('Error fetching workflow usage:', err);
    res.status(500).json({
      configured: true,
      error: err.message,
      workflowUsage: [],
      serverUsage: [],
      userActivity: [],
    });
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

const HOST = process.env.HOST || '0.0.0.0'; // Allow connections from network by default

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`Server accessible from network at http://<your-ip>:${PORT}`);
  }
  console.log(`Workflows directory: ${WORKFLOWS_PATH}`);
});

