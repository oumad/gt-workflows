/**
 * HTTP Basic Auth middleware. Does not send WWW-Authenticate so the browser never shows a native Basic Auth popup.
 */
export function createBasicAuthMiddleware({ auth }) {
  if (!auth.enabled) {
    return (_req, _res, next) => next();
  }
  const { user: AUTH_USER, pass: AUTH_PASS } = auth;

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
      if (user !== AUTH_USER || pass !== AUTH_PASS) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };
}
