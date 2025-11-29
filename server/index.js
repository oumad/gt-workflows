import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3011;
const WORKFLOWS_PATH = path.join(__dirname, '../data/gt-workflows');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// Serve static files from workflows directory (for icons)
app.use('/data/gt-workflows', express.static(WORKFLOWS_PATH));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

