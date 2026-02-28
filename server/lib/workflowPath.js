import path from 'path';

/** Workflow folder names: alphanumeric, dash, underscore only (no path traversal). */
const SAFE_WORKFLOW_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Allowed filename chars for uploads (basename only, no path separators). */
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

/**
 * Resolve and validate a workflow path from a route param (e.g. :name).
 * Returns { ok: true, workflowPath, workflowName } or { ok: false, error }.
 */
export function resolveWorkflowPath(workflowsPath, name) {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'Workflow name is required' };
  }
  const decoded = decodeURIComponent(name).trim();
  if (decoded.includes('..') || path.isAbsolute(decoded)) {
    return { ok: false, error: 'Invalid workflow name' };
  }
  if (!SAFE_WORKFLOW_NAME_REGEX.test(decoded)) {
    return { ok: false, error: 'Invalid workflow name' };
  }
  const root = path.resolve(workflowsPath);
  const workflowPath = path.resolve(workflowsPath, decoded);
  if (!workflowPath.startsWith(root + path.sep)) {
    return { ok: false, error: 'Invalid path' };
  }
  return { ok: true, workflowPath, workflowName: decoded };
}

/**
 * Validate a workflow name from request body (create/duplicate). Returns normalized name or error.
 */
export function validateWorkflowName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'Workflow name is required' };
  }
  const trimmed = name.trim();
  if (!SAFE_WORKFLOW_NAME_REGEX.test(trimmed)) {
    return { ok: false, error: 'Invalid workflow name' };
  }
  return { ok: true, workflowName: trimmed };
}

/**
 * Sanitize uploaded file originalname: use basename and allow only safe chars.
 * Returns safe filename or null if invalid.
 */
export function sanitizeFilename(originalname) {
  if (typeof originalname !== 'string' || !originalname.trim()) {
    return null;
  }
  const base = path.basename(originalname);
  if (!base || base === '.' || base === '..') {
    return null;
  }
  return SAFE_FILENAME_REGEX.test(base) ? base : 'file';
}
