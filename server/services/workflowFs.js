import fs from 'fs/promises';
import path from 'path';

/**
 * Read and parse params.json from a workflow directory. Returns null if file does not exist.
 */
export async function readParamsJson(workflowPath) {
  const paramsPath = path.join(workflowPath, 'params.json');
  try {
    await fs.access(paramsPath);
    const content = await fs.readFile(paramsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Failed to read params.json: ${error.message}`);
  }
}

/**
 * Find workflow JSON file in directory (excludes params.json and node-parsers). Returns { filename, content } or null.
 */
export async function findWorkflowJson(workflowPath) {
  try {
    const files = await fs.readdir(workflowPath);
    const jsonFiles = files.filter(
      (f) => f.endsWith('.json') && f !== 'params.json' && !f.includes('node-parsers')
    );
    if (jsonFiles.length === 0) return null;
    const apiFile = jsonFiles.find((f) => f.includes('api'));
    const workflowFile = apiFile || jsonFiles[0];
    const content = await fs.readFile(path.join(workflowPath, workflowFile), 'utf-8');
    return {
      filename: workflowFile,
      content: JSON.parse(content),
    };
  } catch {
    return null;
  }
}
