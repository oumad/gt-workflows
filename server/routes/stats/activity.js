import { Router } from 'express';
import { getStatsQueue } from '../../lib/queue.js';
import { toActivityJob, shouldAnonymiseUsers, getJobsBatched } from '../../lib/statsHelpers.js';

export function createActivityRouter(config) {
  const router = Router();
  const queue = getStatsQueue();

  router.get('/stats/activity', async (req, res) => {
    if (!queue) {
      return res.json({
        configured: false,
        active: [],
        waiting: [],
        message: 'Set REDIS_URL (and optionally BULL_QUEUE_NAME) to see activity.',
      });
    }
    try {
      const anonymise = shouldAnonymiseUsers(config, req);
      const [activeRaw, waitingRaw] = await Promise.all([
        queue.getJobs(['active']),
        queue.getJobs(['waiting']),
      ]);
      const active = (activeRaw || []).filter((j) => j != null).map((j) => toActivityJob(j, anonymise)).filter(Boolean);
      const waiting = (waitingRaw || []).filter((j) => j != null).map((j) => toActivityJob(j, anonymise)).filter(Boolean);
      res.json({ configured: true, active, waiting });
    } catch (err) {
      console.error('Error fetching activity jobs:', err);
      res.status(500).json({
        configured: true,
        active: [],
        waiting: [],
        error: err.message,
      });
    }
  });

  /**
   * Fetch failed jobs in a time range for Time View analytics (failure rate, heatmap).
   * Returns ActivityJob-shaped objects with `failedReason`.
   */
  router.get('/stats/failed-range', async (req, res) => {
    if (!queue) {
      return res.json({ configured: false, jobs: [] });
    }
    try {
      const from = req.query.from ? new Date(req.query.from).getTime() : null;
      const to = req.query.to ? new Date(req.query.to).getTime() : null;
      if (from == null || to == null || Number.isNaN(from) || Number.isNaN(to)) {
        return res.status(400).json({ error: 'from and to query params required (ISO dates).' });
      }
      const anonymise = shouldAnonymiseUsers(config, req);
      const maxJobs = Math.min(parseInt(req.query.maxJobs, 10) || 50000, 200000);
      const chunkSize = Math.min(parseInt(req.query.limit, 10) || 2000, 2000);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const batch = await getJobsBatched(queue, 'failed', from, { batchSize: 200, maxJobs: Math.min(chunkSize, maxJobs) });
      const jobs = [];
      let reachedRangeStart = false;
      for (const job of batch) {
        if (!job) continue;
        const ts = job.finishedOn ?? job.processedOn ?? job.timestamp;
        if (ts == null) continue;
        if (ts < from) { reachedRangeStart = true; break; }
        if (ts > to) continue;
        const mapped = toActivityJob(job, anonymise);
        if (mapped) jobs.push(mapped);
      }
      res.json({
        configured: true,
        jobs,
        totalScanned: offset + batch.length,
        reachedRangeStart,
      });
    } catch (err) {
      console.error('Error fetching failed-range:', err);
      res.status(500).json({ configured: true, error: err.message, jobs: [] });
    }
  });

  return router;
}
