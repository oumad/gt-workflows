/**
 * Security middleware and utilities to reduce exposure of credentials and mitigate common attacks.
 * - Never log Authorization header or any credential.
 * - Apply security-related response headers when possible.
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

/**
 * Security-related response headers. Use behind HTTPS in production for full effect.
 * HSTS is not set here so the app can run over HTTP in development; set it at the reverse proxy when using HTTPS.
 */
export function securityHeadersMiddleware(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
