import { Router } from 'express';

export function createPingRouter(config) {
  const router = Router();
  const { auth, sessionMaxTime, adminUser } = config;

  router.get('/ping', (req, res) => {
    const payload = { ok: true, authEnabled: auth.enabled };
    if (auth.enabled) {
      payload.sessionMaxTime = sessionMaxTime;
      if (req.authUsername) {
        payload.username = req.authUsername;
        payload.role = req.authUsername === adminUser ? 'admin' : 'guest';
      }
    }
    res.json(payload);
  });

  return router;
}
