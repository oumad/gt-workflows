import fs from 'fs/promises';
import path from 'path';

const EVENTS_FILE = 'events.json';

/** Simple promise-chaining lock so concurrent writes are serialized. */
let writeLock = Promise.resolve();

function withLock(fn) {
  const prev = writeLock;
  let release;
  writeLock = new Promise((r) => { release = r; });
  return prev.then(() => fn()).finally(() => release());
}

/**
 * Read all events from disk. Returns [] if file is missing or invalid.
 * @param {string} dataDir
 * @returns {Promise<object[]>}
 */
export async function readEvents(dataDir) {
  const file = path.join(dataDir, EVENTS_FILE);
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function _write(dataDir, events) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, EVENTS_FILE);
  const tmp = `${file}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(events, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } finally {
    try { await fs.unlink(tmp); } catch { /* already renamed */ }
  }
}

/**
 * Append a new event object to the store.
 * @param {string} dataDir
 * @param {object} event
 * @returns {Promise<object>} the added event
 */
export async function addEvent(dataDir, event) {
  return withLock(async () => {
    const events = await readEvents(dataDir);
    events.push(event);
    await _write(dataDir, events);
    return event;
  });
}

/**
 * Merge patch into the event with the given id.
 * @param {string} dataDir
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object|null>} updated event, or null if not found
 */
export async function updateEvent(dataDir, id, patch) {
  return withLock(async () => {
    const events = await readEvents(dataDir);
    const idx = events.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    events[idx] = { ...events[idx], ...patch };
    await _write(dataDir, events);
    return events[idx];
  });
}

/**
 * Remove an event by id.
 * @param {string} dataDir
 * @param {string} id
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
export async function deleteEvent(dataDir, id) {
  return withLock(async () => {
    const events = await readEvents(dataDir);
    const idx = events.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    events.splice(idx, 1);
    await _write(dataDir, events);
    return true;
  });
}
