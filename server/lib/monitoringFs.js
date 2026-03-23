import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG = { watchedServers: [], intervalSeconds: 60 };

export async function readMonitoringConfig(dataDir) {
  const file = path.join(dataDir, 'monitoring.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // file missing or invalid
  }
  return { ...DEFAULT_CONFIG };
}

export async function writeMonitoringConfig(dataDir, config) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'monitoring.json');
  const tmp = `${file}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
