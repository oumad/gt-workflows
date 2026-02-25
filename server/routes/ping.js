import { Router } from 'express';

export function createPingRouter(config) {
  const router = Router();
  const { auth, sessionMaxTime } = config;

  router.get('/ping', (req, res) => {
    const payload = { ok: true, authEnabled: auth.enabled };
    if (auth.enabled) {
      payload.sessionMaxTime = sessionMaxTime;
      if (req.authUsername) payload.username = req.authUsername;
    }
    res.json(payload);
  });

  return router;
}
