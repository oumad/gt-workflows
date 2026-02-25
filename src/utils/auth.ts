const AUTH_STORAGE_KEY = 'gt-workflows-auth';
const AUTH_TIME_KEY = 'gt-workflows-auth-time';
const SESSION_MAX_KEY = 'gt-workflows-session-max';

const DEFAULT_SESSION_MAX_SECONDS = 86400; // 24 hours

export function getStoredAuth(): string | null {
  try {
    return sessionStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Store auth token and optional session max time (seconds). Records login timestamp for session expiry.
 */
export function setStoredAuth(b64Basic: string, sessionMaxTimeSeconds?: number): void {
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, b64Basic);
    sessionStorage.setItem(AUTH_TIME_KEY, String(Date.now()));
    if (sessionMaxTimeSeconds != null && sessionMaxTimeSeconds > 0) {
      sessionStorage.setItem(SESSION_MAX_KEY, String(sessionMaxTimeSeconds));
    }
  } catch {
    // Do not log the error object to avoid any risk of exposing credentials
    console.error('Failed to store auth');
  }
}

export function getStoredSessionMaxTime(): number {
  try {
    const v = sessionStorage.getItem(SESSION_MAX_KEY);
    if (v != null) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
  } catch {}
  return DEFAULT_SESSION_MAX_SECONDS;
}

/**
 * Returns true if the current session has exceeded SESSION_MAX_TIME (no activity since login).
 */
export function isSessionExpired(): boolean {
  try {
    const auth = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!auth) return true;
    const timeStr = sessionStorage.getItem(AUTH_TIME_KEY);
    if (!timeStr) return false; // no timestamp = legacy session, don't expire
    const loginTime = parseInt(timeStr, 10);
    if (Number.isNaN(loginTime)) return false;
    const maxSec = getStoredSessionMaxTime();
    return Date.now() - loginTime > maxSec * 1000;
  } catch {
    return true;
  }
}

export function clearStoredAuth(): void {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_TIME_KEY);
    sessionStorage.removeItem(SESSION_MAX_KEY);
  } catch {}
}

const AUTH_REQUIRED_EVENT = 'gt-workflows-authRequired';
const UNAUTHORIZED_FLAG_KEY = 'gt-workflows-unauthorized';

export function onAuthRequired(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener(AUTH_REQUIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
}

export function getUnauthorizedFlag(): boolean {
  try {
    return sessionStorage.getItem(UNAUTHORIZED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearUnauthorizedFlag(): void {
  try {
    sessionStorage.removeItem(UNAUTHORIZED_FLAG_KEY);
  } catch {}
}

function dispatchAuthRequired(): void {
  try {
    sessionStorage.setItem(UNAUTHORIZED_FLAG_KEY, '1');
  } catch {}
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

/**
 * Updates the session timestamp so SESSION_MAX_TIME is treated as idle timeout (extends on activity).
 */
function refreshSessionTime(): void {
  try {
    if (sessionStorage.getItem(AUTH_STORAGE_KEY))
      sessionStorage.setItem(AUTH_TIME_KEY, String(Date.now()));
  } catch {}
}

/**
 * Same as fetch but adds Basic auth header from sessionStorage when present.
 * On 401, clears stored auth and dispatches authRequired so the app can show the login screen.
 * On success (2xx), refreshes session timestamp for idle timeout.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const auth = getStoredAuth();
  const headers = new Headers(init?.headers);
  if (auth) {
    headers.set('Authorization', `Basic ${auth}`);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearStoredAuth();
    dispatchAuthRequired();
  } else if (response.ok) {
    refreshSessionTime();
  }
  return response;
}
