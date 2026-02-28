import fs from 'fs/promises';
import path from 'path';

/** Per-file lock so concurrent writes for the same user are serialized. */
const fileLocks = new Map();

/** Sanitize username for use as filename (no path separators or reserved chars). */
function sanitizeUserId(userId) {
  if (typeof userId !== 'string' || !userId) return 'default';
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'default';
}

/**
 * Run fn with an exclusive lock for the given file path. Callers for the same path are queued.
 */
async function withFileLock(filePath, fn) {
  const prev = fileLocks.get(filePath);
  const work = prev ? prev.then(() => fn()) : fn();
  const wrapped = Promise.resolve(work).then((r) => r);
  fileLocks.set(filePath, wrapped);
  try {
    return await wrapped;
  } finally {
    if (fileLocks.get(filePath) === wrapped) {
      fileLocks.delete(filePath);
    }
  }
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
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // file not found or invalid
  }
  return {};
}

/**
 * Write preferences for a user. Merges with existing and writes atomically (temp file + rename).
 * Serializes writes per user file so concurrent updates are not lost.
 */
export async function writePreferences(preferencesPath, userId, partial) {
  const dir = preferencesPath;
  const file = path.join(dir, `${sanitizeUserId(userId)}.json`);
  await fs.mkdir(dir, { recursive: true });

  return withFileLock(file, async () => {
    const existing = await readPreferences(preferencesPath, userId);
    const merged = { ...existing, ...partial };
    const tmpFile = `${file}.tmp`;
    try {
      await fs.writeFile(tmpFile, JSON.stringify(merged, null, 2), 'utf8');
      await fs.rename(tmpFile, file);
    } finally {
      try {
        await fs.unlink(tmpFile);
      } catch {
        // ignore if temp already renamed or missing
      }
    }
    return merged;
  });
}
