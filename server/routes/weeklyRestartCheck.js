import { Router } from 'express';
import { readWeeklyRestartCheckConfig, writeWeeklyRestartCheckConfig } from '../lib/weeklyRestartCheckFs.js';
import { weeklyRestartCheckService } from '../lib/weeklyRestartCheckService.js';

function buildResponse(cfg) {
  return {
    enabled: Boolean(cfg.enabled),
    dayOfWeek: typeof cfg.dayOfWeek === 'number' ? cfg.dayOfWeek : 1,
    hour: typeof cfg.hour === 'number' ? cfg.hour : 3,
    minute: typeof cfg.minute === 'number' ? cfg.minute : 0,
    delayMinutes: typeof cfg.delayMinutes === 'number' ? cfg.delayMinutes : 30,
  };
}

export function createWeeklyRestartCheckRouter(config) {
  const { dataDir } = config;
  const router = Router();

  /** GET /api/weekly-restart-check — return current config. */
  router.get('/weekly-restart-check', async (req, res) => {
    try {
      const cfg = await readWeeklyRestartCheckConfig(dataDir);
      res.json(buildResponse(cfg));
    } catch (err) {
      console.error('[WeeklyRestartCheck] Read error:', err.message);
      res.status(500).json({ error: 'Failed to read weekly restart check config' });
    }
  });

  /** PATCH /api/weekly-restart-check — update config. */
  router.patch('/weekly-restart-check', async (req, res) => {
    const body = req.body || {};
    try {
      const current = await readWeeklyRestartCheckConfig(dataDir);
      const updated = { ...current };

      if (typeof body.enabled === 'boolean') updated.enabled = body.enabled;
      if (typeof body.dayOfWeek === 'number' && body.dayOfWeek >= 0 && body.dayOfWeek <= 6) {
        updated.dayOfWeek = Math.floor(body.dayOfWeek);
      }
      if (typeof body.hour === 'number' && body.hour >= 0 && body.hour <= 23) {
        updated.hour = Math.floor(body.hour);
      }
      if (typeof body.minute === 'number' && body.minute >= 0 && body.minute <= 59) {
        updated.minute = Math.floor(body.minute);
      }
      if (typeof body.delayMinutes === 'number' && body.delayMinutes >= 1 && body.delayMinutes <= 180) {
        updated.delayMinutes = Math.floor(body.delayMinutes);
      }

      // Reset lastFiredForRestartIso when schedule changes OR when feature is being enabled,
      // so the next matching window always fires fresh
      const scheduleChanged =
        current.dayOfWeek !== updated.dayOfWeek ||
        current.hour !== updated.hour ||
        current.minute !== updated.minute;
      const justEnabled = !current.enabled && updated.enabled;
      if (scheduleChanged || justEnabled) updated.lastFiredForRestartIso = null;

      await writeWeeklyRestartCheckConfig(dataDir, updated);
      await weeklyRestartCheckService.reload();
      res.json(buildResponse(updated));
    } catch (err) {
      console.error('[WeeklyRestartCheck] Write error:', err.message);
      res.status(500).json({ error: 'Failed to save weekly restart check config' });
    }
  });

  /** POST /api/weekly-restart-check/test — force an immediate check+notify (admin only). */
  router.post('/weekly-restart-check/test', async (req, res) => {
    try {
      const result = await weeklyRestartCheckService.testNow();
      res.json(result);
    } catch (err) {
      console.error('[WeeklyRestartCheck] Test error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
