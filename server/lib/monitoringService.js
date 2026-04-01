import { readMonitoringConfig, writeMonitoringConfig } from './monitoringFs.js';

const CHECK_TIMEOUT_MS = 8_000;
const DISCORD_COLOR_RED = 0xE74C3C;

// Exponential backoff for alerts: 1 min → 2 → 4 → 8 → 16 → 32 → 60 (cap)
const BACKOFF_STEPS_MS = [1, 2, 4, 8, 16, 32, 60].map((m) => m * 60_000);

/** Lightweight health probe — tries /system_stats with a short timeout. */
async function probeServer(url) {
  const base = url.replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(`${base}/system_stats`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    // 2xx–4xx = server is up (even auth errors mean it's reachable); 5xx = broken
    const healthy = res.status >= 200 && res.status < 500;
    return { healthy, latencyMs, error: healthy ? null : `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timeout);
    return {
      healthy: false,
      latencyMs: null,
      error: err.name === 'AbortError' ? 'Timeout (8s)' : (err.message || 'Connection failed'),
    };
  }
}

class MonitoringService {
  constructor() {
    this.dataDir = null;
    this.appConfig = null;
    this.watchedServers = [];
    this.intervalSeconds = 60;
    this.timer = null;
    /** @type {Map<string, { healthy: boolean, lastCheck: string, latencyMs: number|null, error: string|null }>} */
    this.serverStatus = new Map();
    /**
     * Per-server alert state for exponential backoff.
     * @type {Map<string, { step: number, nextAlertAt: number }>}
     */
    this.alertState = new Map();
    /** Servers under maintenance (restarting) — alerts suppressed until expiry. @type {Map<string, number>} */
    this.maintenanceUntil = new Map();
    this.initialized = false;
  }

  async init(dataDir, appConfig) {
    this.dataDir = dataDir;
    this.appConfig = appConfig;
    try {
      const saved = await readMonitoringConfig(dataDir);
      this.watchedServers = Array.isArray(saved.watchedServers) ? saved.watchedServers : [];
      this.intervalSeconds = typeof saved.intervalSeconds === 'number' ? saved.intervalSeconds : 60;
    } catch (err) {
      console.error('[Monitoring] Failed to load config:', err.message);
    }
    this.initialized = true;
    this._restartTimer();
    if (this.watchedServers.length > 0) {
      console.log(`[Monitoring] Started — watching ${this.watchedServers.length} server(s) every ${this.intervalSeconds}s`);
      this._runChecks().catch((e) => console.error('[Monitoring] Initial check error:', e.message));
    }
  }

  _restartTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.watchedServers.length === 0) return;
    this.timer = setInterval(() => {
      this._runChecks().catch((e) => console.error('[Monitoring] Check error:', e.message));
    }, this.intervalSeconds * 1000);
  }

  async updateConfig({ watchedServers, intervalSeconds } = {}) {
    if (Array.isArray(watchedServers)) {
      this.watchedServers = watchedServers.map((u) => u.replace(/\/$/, ''));
      // Clean up stale state for removed servers
      const watched = new Set(this.watchedServers);
      for (const url of this.alertState.keys()) { if (!watched.has(url)) this.alertState.delete(url); }
      for (const url of this.serverStatus.keys()) { if (!watched.has(url)) this.serverStatus.delete(url); }
    }
    if (typeof intervalSeconds === 'number') {
      this.intervalSeconds = intervalSeconds;
    }
    if (this.dataDir) {
      await writeMonitoringConfig(this.dataDir, {
        watchedServers: this.watchedServers,
        intervalSeconds: this.intervalSeconds,
      }).catch((err) => console.error('[Monitoring] Failed to persist config:', err.message));
    }
    this._restartTimer();
    if (this.watchedServers.length > 0) {
      this._runChecks().catch((e) => console.error('[Monitoring] Post-update check error:', e.message));
    }
  }

  setMaintenance(url, durationMs) {
    const norm = url.replace(/\/$/, '');
    this.maintenanceUntil.set(norm, Date.now() + durationMs);
    // Also clear any existing alert state so recovery alert fires cleanly after restart
    this.alertState.delete(norm);
    console.log(`[Monitoring] Maintenance mode set for ${norm} (${durationMs / 1000}s)`);
  }

  clearMaintenance(url) {
    const norm = url.replace(/\/$/, '');
    this.maintenanceUntil.delete(norm);
  }

  async runChecksNow() {
    await this._runChecks({ force: true });
  }

  async _runChecks({ force = false } = {}) {
    if (this.watchedServers.length === 0) return;
    const results = await Promise.all(
      this.watchedServers.map(async (url) => ({ url, ...(await probeServer(url)) }))
    );

    const toAlert = [];
    const now = Date.now();
    for (const { url, healthy, latencyMs, error } of results) {
      this.serverStatus.set(url, {
        healthy,
        lastCheck: new Date().toISOString(),
        latencyMs: latencyMs ?? null,
        error: error ?? null,
      });

      // Clear expired maintenance
      const maintUntil = this.maintenanceUntil.get(url);
      if (maintUntil && now >= maintUntil) this.maintenanceUntil.delete(url);
      const inMaintenance = this.maintenanceUntil.has(url);

      if (healthy) {
        if (this.alertState.has(url)) {
          this.alertState.delete(url);
          console.log(`[Monitoring] Server recovered: ${url}`);
        }
        this.maintenanceUntil.delete(url);
      } else if (inMaintenance) {
        const secsLeft = Math.ceil((this.maintenanceUntil.get(url) - now) / 1000);
        console.log(`[Monitoring] DOWN but in maintenance (${secsLeft}s left): ${url}`);
      } else {
        const state = this.alertState.get(url);
        if (!state) {
          // First failure — alert immediately, schedule next at step 0
          console.warn(`[Monitoring] DOWN (first): ${url} — ${error}`);
          toAlert.push({ url, error });
          this.alertState.set(url, { step: 0, nextAlertAt: now + BACKOFF_STEPS_MS[0] });
        } else if (force || now >= state.nextAlertAt) {
          // Manual check (force) or backoff window elapsed — alert again, advance step
          const nextStep = Math.min(state.step + 1, BACKOFF_STEPS_MS.length - 1);
          const delay = BACKOFF_STEPS_MS[nextStep];
          console.warn(`[Monitoring] DOWN (${force ? 'forced' : `backoff step ${nextStep}`}): ${url} — ${error}`);
          toAlert.push({ url, error });
          state.step = nextStep;
          state.nextAlertAt = now + delay;
        } else {
          const secsLeft = Math.ceil((state.nextAlertAt - now) / 1000);
          console.log(`[Monitoring] DOWN (suppressed, next alert in ${secsLeft}s): ${url}`);
        }
      }
    }

    if (toAlert.length > 0) {
      console.warn(`[Monitoring] ${toAlert.length} server(s) down — sending alert`);
      await this._sendDiscordAlert(toAlert).catch((err) =>
        console.error('[Monitoring] Discord alert failed:', err.message)
      );
    }
  }

  async _sendDiscordAlert(unhealthyServers) {
    const webhookUrl = this.appConfig?.discordWebhookUrl;
    if (!webhookUrl) return;

    const appName = this.appConfig?.appName;
    const count = unhealthyServers.length;
    const embed = {
      title: `🔴 GT Coffee Maker — ${count} server${count > 1 ? 's' : ''} down`,
      description: `${count} ComfyUI server${count > 1 ? 's are' : ' is'} not responding.`,
      color: DISCORD_COLOR_RED,
      fields: unhealthyServers.map(({ url, error }) => ({
        name: url,
        value: error ? `\`${error}\`` : 'Not reachable',
        inline: false,
      })),
      timestamp: new Date().toISOString(),
    };
    if (appName) embed.footer = { text: appName };

    const payload = JSON.stringify({ embeds: [embed] });
    console.log(`[Monitoring] Sending Discord alert (${unhealthyServers.length} server(s))`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      if (res.ok) {
        console.log(`[Monitoring] Discord alert sent (HTTP ${res.status})`);
      } else {
        const msg = `Discord webhook returned HTTP ${res.status}`;
        console.error(`[Monitoring] ${msg}`);
        throw new Error(msg);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  getStatus() {
    const status = {};
    for (const [url, s] of this.serverStatus) status[url] = s;
    return {
      watchedServers: this.watchedServers,
      intervalSeconds: this.intervalSeconds,
      discordEnabled: !!(this.appConfig?.discordWebhookUrl),
      status,
      running: this.timer != null,
    };
  }
}

// Singleton — imported by both the API route and server/index.js
export const monitoringService = new MonitoringService();
