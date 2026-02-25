export interface AppSettings {
  healthCheckInterval: number; // in seconds (deprecated - kept for backwards compatibility)
  healthCheckEnabled: boolean; // deprecated - kept for backwards compatibility
  monitoredServers: string[]; // List of ComfyUI server URLs to monitor
}

const DEFAULT_SETTINGS: AppSettings = {
  healthCheckInterval: 10, // Not used anymore - manual checks only
  healthCheckEnabled: false, // Manual checks only now
  monitoredServers: ['http://127.0.0.1:8188'], // Default to localhost
};

const SETTINGS_KEY = 'gt-workflows-settings';

export function getSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Ensure monitoredServers exists and is an array
        monitoredServers: parsed.monitoredServers && Array.isArray(parsed.monitoredServers) 
          ? parsed.monitoredServers 
          : DEFAULT_SETTINGS.monitoredServers,
      };
    }
  } catch {
    // Fall back to defaults
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Partial<AppSettings>): void {
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export function resetSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // Ignore storage errors
  }
}

