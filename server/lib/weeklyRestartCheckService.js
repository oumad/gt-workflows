import fs from 'fs/promises';
import path from 'path';
import { readWeeklyRestartCheckConfig, writeWeeklyRestartCheckConfig } from './weeklyRestartCheckFs.js';
import { sendDiscordWebhook } from './discordWebhook.js';

const CHECK_INTERVAL_MS = 60_000; // check every minute
const FIRE_WINDOW_MS = 10 * 60_000; // 10-minute window after delay expires
const PROBE_TIMEOUT_MS = 8_000;
const DISCORD_COLOR_GREEN = 0x2ECC71;
const DISCORD_COLOR_ORANGE = 0xE67E22;

/** Collect all monitoredServers across all user preference files. */
async function getAllMonitoredServers(preferencesPath) {
  try {
    const files = await fs.readdir(preferencesPath);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const serverSets = await Promise.all(
      jsonFiles.map(async (file) => {
        try {
          const raw = await fs.readFile(path.join(preferencesPath, file), 'utf8');
          const prefs = JSON.parse(raw);
          return Array.isArray(prefs.monitoredServers) ? prefs.monitoredServers : [];
        } catch { return []; }
      })
    );
    // Union all servers, deduplicate by normalized URL
    const seen = new Set();
    return serverSets.flat().filter((s) => {
      if (typeof s !== 'string' || !s.trim()) return false;
      const norm = s.replace(/\/$/, '');
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });
  } catch { return []; }
}

/** Compute the most recent occurrence of (dayOfWeek, hour, minute) as a local Date. */
function getLastRestartTime(dayOfWeek, hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  const todayDow = now.getDay();
  let daysBack = (todayDow - dayOfWeek + 7) % 7;

  // If today is the right day but we haven't reached the restart time yet, look back 7 days
  if (daysBack === 0 && now < target) daysBack = 7;

  target.setDate(target.getDate() - daysBack);
  return target;
}

/** Lightweight health probe — reuses the same logic as monitoringService. */
async function probeServer(url) {
  const base = url.replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${base}/system_stats`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const healthy = res.status >= 200 && res.status < 500;
    return { url, healthy, latencyMs, error: healthy ? null : `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timeout);
    return {
      url,
      healthy: false,
      latencyMs: null,
      error: err.name === 'AbortError' ? 'Timeout (8s)' : (err.message || 'Connection failed'),
    };
  }
}

class WeeklyRestartCheckService {
  constructor() {
    this.dataDir = null;
    this.appConfig = null;
    this.timer = null;
  }

  init(dataDir, appConfig) {
    this.dataDir = dataDir;
    this.appConfig = appConfig;
    this.timer = setInterval(() => {
      this._check().catch((err) =>
        console.error('[WeeklyRestartCheck] Check error:', err.message)
      );
    }, CHECK_INTERVAL_MS);
    console.log('[WeeklyRestartCheck] Started — checking every minute');
  }

  async reload() {
    // Next tick will pick up the new file; no action needed.
  }

  /** Force an immediate check+notify, bypassing the time window and lastFiredForRestartIso guard. */
  async testNow() {
    if (!this.dataDir) throw new Error('Service not initialized');
    const cfg = await readWeeklyRestartCheckConfig(this.dataDir);
    const preferencesPath = this.appConfig?.preferencesPath;
    let servers = [];
    if (preferencesPath) {
      servers = await getAllMonitoredServers(preferencesPath);
    }

    console.log(`[WeeklyRestartCheck] TEST — probing ${servers.length} server(s), webhook=${!!this.appConfig?.discordWebhookUrl}`);

    if (servers.length === 0) {
      return { ok: false, reason: 'No monitored servers in preferences' };
    }

    const results = await Promise.all(servers.map(probeServer));
    const unhealthy = results.filter((r) => !r.healthy);
    const healthy = results.filter((r) => r.healthy);

    await this._sendDiscordNotification(unhealthy, healthy);
    return { ok: true, healthy: healthy.length, unhealthy: unhealthy.length, servers: results };
  }

  async _check() {
    if (!this.dataDir) return;

    const cfg = await readWeeklyRestartCheckConfig(this.dataDir);
    if (!cfg.enabled) return;

    const restartTime = getLastRestartTime(cfg.dayOfWeek, cfg.hour, cfg.minute);
    const checkTime = new Date(restartTime.getTime() + cfg.delayMinutes * 60_000);
    const now = Date.now();

    // Are we within the fire window?
    if (now < checkTime.getTime() || now >= checkTime.getTime() + FIRE_WINDOW_MS) return;

    // Already fired for this restart slot?
    const restartIso = restartTime.toISOString();
    if (cfg.lastFiredForRestartIso === restartIso) return;

    console.log(`[WeeklyRestartCheck] Firing post-restart health check (restart was ${restartIso})`);

    // Mark as fired immediately to avoid double-send if checks are slow
    await writeWeeklyRestartCheckConfig(this.dataDir, { ...cfg, lastFiredForRestartIso: restartIso });

    // Read monitored servers from all user preference files
    const preferencesPath = this.appConfig?.preferencesPath;
    let servers = [];
    if (preferencesPath) {
      try {
        servers = await getAllMonitoredServers(preferencesPath);
      } catch (err) {
        console.error('[WeeklyRestartCheck] Failed to read preferences:', err.message);
      }
    }

    if (servers.length === 0) {
      console.log('[WeeklyRestartCheck] No monitored servers in preferences — skipping health checks');
      return;
    }

    console.log(`[WeeklyRestartCheck] Probing ${servers.length} server(s)…`);
    const results = await Promise.all(servers.map(probeServer));
    const unhealthy = results.filter((r) => !r.healthy);
    const healthy = results.filter((r) => r.healthy);

    console.log(
      `[WeeklyRestartCheck] Health check complete: ${healthy.length} healthy, ${unhealthy.length} unhealthy`
    );

    await this._sendDiscordNotification(unhealthy, healthy).catch((err) =>
      console.error('[WeeklyRestartCheck] Discord notification failed:', err.message)
    );
  }

  async _sendDiscordNotification(unhealthy, healthy) {
    const webhookUrl = this.appConfig?.discordWebhookUrl;
    if (!webhookUrl) {
      console.log('[WeeklyRestartCheck] No Discord webhook configured — skipping notification');
      return;
    }

    const appName = this.appConfig?.appName;
    let embed;

    if (unhealthy.length === 0) {
      embed = {
        title: '✅ Everything OK after weekly restart',
        description: `All ${healthy.length} server${healthy.length > 1 ? 's' : ''} recovered successfully.`,
        color: DISCORD_COLOR_GREEN,
        fields: healthy.map(({ url, latencyMs }) => ({
          name: url,
          value: latencyMs != null ? `Online — ${latencyMs}ms` : 'Online',
          inline: false,
        })),
        timestamp: new Date().toISOString(),
      };
    } else {
      embed = {
        title: `⚠️ Error after weekly restart — ${unhealthy.length} server${unhealthy.length > 1 ? 's' : ''} did not recover`,
        description: `${healthy.length > 0 ? `${healthy.length} server${healthy.length > 1 ? 's' : ''} OK, but ` : ''}${unhealthy.length} did not recover.`,
        color: DISCORD_COLOR_ORANGE,
        fields: [
          ...healthy.map(({ url, latencyMs }) => ({
            name: `✅ ${url}`,
            value: latencyMs != null ? `Online — ${latencyMs}ms` : 'Online',
            inline: false,
          })),
          ...unhealthy.map(({ url, error }) => ({
            name: `❌ ${url}`,
            value: error ? `\`${error}\`` : 'Not reachable',
            inline: false,
          })),
        ],
        timestamp: new Date().toISOString(),
      };
    }

    if (appName) embed.footer = { text: appName };

    const payload = JSON.stringify({ embeds: [embed] });
    console.log('[WeeklyRestartCheck] Sending Discord notification');

    await sendDiscordWebhook(webhookUrl, payload);
    console.log('[WeeklyRestartCheck] Discord notification sent');
  }
}

// Singleton — initialized in server/index.js
export const weeklyRestartCheckService = new WeeklyRestartCheckService();
