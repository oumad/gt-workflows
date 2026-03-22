import fs from 'fs/promises';
import path from 'path';

// Filesystem-safe ISO timestamp: 2026-03-18T14-30-00-123Z
const toSafeTimestamp = (d = new Date()) =>
  d.toISOString().replace(/:/g, '-');
// Validate timestamp dir name format
const SAFE_TS_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/**
 * Get the history directory for a specific workflow.
 * History is stored outside the workflow dir: <historyPath>/<workflowName>/
 */
function workflowHistoryDir(historyPath, workflowName) {
  return path.join(historyPath, workflowName);
}

/**
 * Back up one or more files from a workflow directory before they are modified.
 * Silently skips files that don't exist (nothing to back up).
 * @param {string} historyPath   Root history directory (e.g. data/workflow-history)
 * @param {string} workflowPath  Absolute path to the workflow folder
 * @param {string} workflowName  Workflow name (used as history subfolder)
 * @param {string[]} filenames   Basenames to back up (e.g. ['params.json'])
 * @param {string} action        Human-readable label (e.g. 'Params saved')
 * @returns {Promise<string|null>} The backup timestamp key, or null if nothing was backed up
 */
export async function backupFiles(historyPath, workflowPath, workflowName, filenames, action) {
  const backedUp = [];
  const ts = toSafeTimestamp();
  const entryDir = path.join(workflowHistoryDir(historyPath, workflowName), ts);

  for (const filename of filenames) {
    const src = path.join(workflowPath, filename);
    try {
      await fs.access(src);
    } catch {
      continue; // file doesn't exist, skip
    }
    if (backedUp.length === 0) {
      await fs.mkdir(entryDir, { recursive: true });
    }
    await fs.copyFile(src, path.join(entryDir, filename));
    backedUp.push(filename);
  }

  if (backedUp.length === 0) return null;

  const meta = { timestamp: ts, iso: new Date().toISOString(), action, files: backedUp };
  await fs.writeFile(path.join(entryDir, '_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  return ts;
}

/**
 * Back up ALL files in a workflow directory (used before full workflow deletion).
 */
export async function backupAllFiles(historyPath, workflowPath, workflowName, action) {
  const entries = await fs.readdir(workflowPath, { withFileTypes: true });
  const filenames = entries
    .filter((e) => e.isFile())
    .map((e) => e.name);
  if (filenames.length === 0) return null;
  return backupFiles(historyPath, workflowPath, workflowName, filenames, action);
}

/**
 * List history entries for a workflow, newest first.
 * @returns {Promise<Array<{timestamp, iso, action, files}>>}
 */
export async function listHistory(historyPath, workflowName) {
  const root = workflowHistoryDir(historyPath, workflowName);
  let dirs;
  try {
    dirs = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const entries = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !SAFE_TS_REGEX.test(d.name)) continue;
    try {
      const metaPath = path.join(root, d.name, '_meta.json');
      const raw = await fs.readFile(metaPath, 'utf-8');
      entries.push(JSON.parse(raw));
    } catch {
      // corrupted entry, skip
    }
  }
  entries.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
  return entries;
}

/**
 * Get a single history entry's metadata.
 */
export async function getHistoryEntry(historyPath, workflowName, timestamp) {
  if (!SAFE_TS_REGEX.test(timestamp)) throw new Error('Invalid timestamp format');
  const metaPath = path.join(workflowHistoryDir(historyPath, workflowName), timestamp, '_meta.json');
  const raw = await fs.readFile(metaPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Get the absolute path to a file in a history entry (for serving).
 */
export function getHistoryFilePath(historyPath, workflowName, timestamp, filename) {
  if (!SAFE_TS_REGEX.test(timestamp)) throw new Error('Invalid timestamp format');
  if (!filename || filename.includes('..') || path.isAbsolute(filename) || filename === '_meta.json') {
    throw new Error('Invalid filename');
  }
  return path.join(workflowHistoryDir(historyPath, workflowName), timestamp, filename);
}

/**
 * Restore files from a history entry. Backs up current files first.
 * @returns {Promise<{restoredFiles: string[], backupTimestamp: string|null}>}
 */
export async function restoreFromHistory(historyPath, workflowPath, workflowName, timestamp) {
  if (!SAFE_TS_REGEX.test(timestamp)) throw new Error('Invalid timestamp format');
  const entryDir = path.join(workflowHistoryDir(historyPath, workflowName), timestamp);
  const metaRaw = await fs.readFile(path.join(entryDir, '_meta.json'), 'utf-8');
  const meta = JSON.parse(metaRaw);

  // Back up current versions of the files we're about to overwrite
  const backupTs = await backupFiles(historyPath, workflowPath, workflowName, meta.files, `Before restore from ${timestamp}`);

  // Copy backed-up files back to the workflow directory
  for (const filename of meta.files) {
    const src = path.join(entryDir, filename);
    const dest = path.join(workflowPath, filename);
    await fs.copyFile(src, dest);
  }

  return { restoredFiles: meta.files, backupTimestamp: backupTs };
}

/**
 * Delete a single history entry.
 */
export async function deleteHistoryEntry(historyPath, workflowName, timestamp) {
  if (!SAFE_TS_REGEX.test(timestamp)) throw new Error('Invalid timestamp format');
  const entryDir = path.join(workflowHistoryDir(historyPath, workflowName), timestamp);
  await fs.rm(entryDir, { recursive: true, force: true });
}

/**
 * Delete all history for a workflow.
 */
export async function clearHistory(historyPath, workflowName) {
  const root = workflowHistoryDir(historyPath, workflowName);
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
