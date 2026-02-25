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
