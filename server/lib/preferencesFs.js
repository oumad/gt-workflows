import fs from 'fs/promises';
import path from 'path';

/** Sanitize username for use as filename (no path separators or reserved chars). */
function sanitizeUserId(userId) {
  if (typeof userId !== 'string' || !userId) return 'default';
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'default';
}

/**
 * Read preferences for a user from disk. Returns default object if file missing or invalid.
 */
export async function readPreferences(preferencesPath, userId) {
  const dir = preferencesPath;
  const file = path.join(dir, `${sanitizeUserId(userId)}.json`);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch {
    // file not found or invalid
  }
  return {};
}

/**
 * Write preferences for a user. Merges with existing and writes JSON to disk.
 */
export async function writePreferences(preferencesPath, userId, partial) {
  const dir = preferencesPath;
  const file = path.join(dir, `${sanitizeUserId(userId)}.json`);
  await fs.mkdir(dir, { recursive: true });
  const existing = await readPreferences(preferencesPath, userId);
  const merged = { ...existing, ...partial };
  await fs.writeFile(file, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
