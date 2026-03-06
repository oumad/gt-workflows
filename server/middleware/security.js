/**
 * Security utilities to reduce exposure of credentials and mitigate common attacks.
 * - Never log Authorization header or any credential.
 * - Security response headers are set by helmet in app.js.
 */

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/**
 * Return a copy of headers with sensitive header values redacted (for any future request logging).
 * Use this before logging req.headers to avoid leaking credentials (MITM, log aggregation, etc.).
 */
export function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    out[key] = SENSITIVE_HEADERS.has(lower) ? '[REDACTED]' : value;
  }
  return out;
}
