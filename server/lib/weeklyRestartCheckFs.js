import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG = {
  enabled: false,
  dayOfWeek: 1, // 0=Sunday, 1=Monday, ..., 6=Saturday
  hour: 3,
  minute: 0,
  delayMinutes: 30,
  lastFiredForRestartIso: null,
};

export async function readWeeklyRestartCheckConfig(dataDir) {
  const file = path.join(dataDir, 'weeklyRestartCheck.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch {
    // file missing or invalid
  }
  return { ...DEFAULT_CONFIG };
}

export async function writeWeeklyRestartCheckConfig(dataDir, config) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'weeklyRestartCheck.json');
  const tmp = `${file}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
