import { Router } from 'express';

export function createPingRouter(config) {
  const router = Router();
  const { auth, sessionMaxTime } = config;

  router.get('/ping', (_req, res) => {
    const payload = { ok: true };
    if (auth.enabled) payload.sessionMaxTime = sessionMaxTime;
    res.json(payload);
  });

  return router;
}
