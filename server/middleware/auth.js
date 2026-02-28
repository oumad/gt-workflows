/**
 * HTTP Basic Auth middleware. Does not send WWW-Authenticate so the browser never shows a native Basic Auth popup.
 * Sets req.authUsername to the matched username so routes can return who is logged in.
 *
 * SECURITY: Never log req.headers.authorization, authHeader, decoded user/pass, or any credential.
 * Credentials must only be compared in memory and never appear in responses, logs, or errors.
 */
export function createBasicAuthMiddleware({ auth }) {
  if (!auth.enabled) {
    return (_req, _res, next) => next();
  }
  const credentials = auth.credentials || [];

  return function basicAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      const b64 = authHeader.slice(6);
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      const user = colon >= 0 ? decoded.slice(0, colon) : decoded;
      const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
      const matched = credentials.find((c) => c.user === user && c.pass === pass);
      if (!matched) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      req.authUsername = matched.user;
    } catch {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };
}

/**
 * Middleware that allows only admin when auth is enabled. Use for workflow write operations
 * (create, update, delete, duplicate, upload) so guests cannot mutate data via direct API calls.
 */
export function createRequireAdminMiddleware(config) {
  const { auth, adminUser } = config;
  if (!auth?.enabled || adminUser == null) {
    return (_req, _res, next) => next();
  }
  return function requireAdminMiddleware(req, res, next) {
    if (req.authUsername === adminUser) {
      return next();
    }
    return res.status(403).json({ error: 'Admin access required' });
  };
}

/**
 * When auth is enabled, restricts guest users to ping and job-stats API only. All other /api
 * and /data routes return 403 for guests so UI redirects are enforced server-side.
 */
export function createBlockGuestExceptStatsMiddleware(config) {
  const { auth, guestUser } = config;
  if (!auth?.enabled || guestUser == null) {
    return (_req, _res, next) => next();
  }
  return function blockGuestExceptStatsMiddleware(req, res, next) {
    if (req.authUsername !== guestUser) {
      return next();
    }
    // req.path is relative to mount: /api -> /ping, /workflows/create; /data -> /gt-workflows/...
    const path = req.path || '';
    const baseUrl = req.baseUrl || '';
    const allowed =
      baseUrl === '/api' && (path === '/ping' || path.startsWith('/stats'));
    if (allowed) {
      return next();
    }
    return res.status(403).json({ error: 'Guest access is limited to job stats' });
  };
}
