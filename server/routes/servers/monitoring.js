import { Router } from 'express';
import { monitoringService } from '../../lib/monitoringService.js';

export function createMonitoringRouter() {
  const router = Router();

  router.get('/servers/monitoring', (req, res) => {
    res.json(monitoringService.getStatus());
  });

  router.patch('/servers/monitoring', async (req, res) => {
    try {
      const { watchedServers, intervalSeconds } = req.body ?? {};
      const update = {};
      if (Array.isArray(watchedServers)) {
        update.watchedServers = watchedServers.filter(
          (u) => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'))
        );
      }
      if (typeof intervalSeconds === 'number' && intervalSeconds >= 10 && intervalSeconds <= 3600) {
        update.intervalSeconds = intervalSeconds;
      }
      await monitoringService.updateConfig(update);
      res.json(monitoringService.getStatus());
    } catch (err) {
      console.error('[Monitoring] PATCH error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/servers/monitoring/check-now', async (req, res) => {
    try {
      await monitoringService.runChecksNow();
      res.json(monitoringService.getStatus());
    } catch (err) {
      console.error('[Monitoring] Check-now error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
