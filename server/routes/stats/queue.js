import { Router } from 'express';
import { getStatsQueue } from '../../lib/queue.js';
import { toActivityJob, shouldAnonymiseUsers } from '../../lib/statsHelpers.js';

export function createQueueRouter(config) {
  const router = Router();
  const queue = getStatsQueue();

  router.get('/stats/queue', async (req, res) => {
    if (!queue) {
      return res.json({
        configured: false,
        message: 'Set REDIS_URL (and optionally BULL_QUEUE_NAME) to see queue stats.',
        counts: null,
        ...(req.query.list ? { active: [], waiting: [] } : {}),
      });
    }
    try {
      const counts = await queue.getJobCounts();
      const payload = {
        configured: true,
        counts: {
          waiting: counts.waiting ?? counts.wait ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        },
      };
      if (req.query.list) {
        const anonymise = shouldAnonymiseUsers(config, req);
        const [activeRaw, waitingRaw] = await Promise.all([
          queue.getJobs(['active'], 0, 9999),
          queue.getJobs(['waiting'], 0, 9999),
        ]);
        payload.active = (activeRaw || []).filter((j) => j != null).map((j) => toActivityJob(j, anonymise)).filter(Boolean);
        payload.waiting = (waitingRaw || []).filter((j) => j != null).map((j) => toActivityJob(j, anonymise)).filter(Boolean);
      }
      res.json(payload);
    } catch (err) {
      console.error('Error fetching queue counts:', err);
      res.status(500).json({
        configured: true,
        error: err.message,
        counts: null,
        ...(req.query.list ? { active: [], waiting: [] } : {}),
      });
    }
  });

  router.get('/stats/job/:jobId/logs', async (req, res) => {
    if (!queue) {
      return res.status(503).json({ error: 'Queue not configured (REDIS_URL).' });
    }
    const jobId = req.params.jobId;
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID required.' });
    }
    try {
      const result = await queue.getJobLogs(jobId, 0, -1, true);
      res.json({ logs: result.logs || [], count: result.count || 0 });
    } catch (err) {
      console.error('Error fetching job logs:', err);
      res.status(500).json({ error: err.message || 'Failed to load job logs' });
    }
  });

  /**
   * Build a map of ComfyUI promptId → Bull jobId for active jobs on a given server.
   * Reads each active job's logs and parses "workflow initialized with id <uuid>".
   */
  router.get('/stats/prompt-map', async (req, res) => {
    if (!queue) return res.json({ map: [] });
    const server = req.query.server;
    if (!server || typeof server !== 'string') return res.status(400).json({ error: 'server is required' });
    const norm = (s) => (s || '').replace(/\/$/, '');
    try {
      const activeJobs = await queue.getJobs(['active']);
      const serverJobs = (activeJobs || []).filter((j) => {
        const url = j?.data?.workflow?.config?.comfyui_config?.serverUrl;
        return typeof url === 'string' && norm(url) === norm(server);
      });
      const map = [];
      const PROMPT_ID_RE = /workflow initialized with id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
      for (const job of serverJobs) {
        try {
          const result = await queue.getJobLogs(job.id, 0, 100, true);
          for (const line of (result.logs || [])) {
            const m = line.match(PROMPT_ID_RE);
            if (m) { map.push({ promptId: m[1], bullJobId: String(job.id) }); break; }
          }
        } catch { /* skip jobs whose logs can't be read */ }
      }
      res.json({ map });
    } catch (err) {
      res.status(500).json({ error: err.message, map: [] });
    }
  });

  router.get('/stats/job/:jobId/data', async (req, res) => {
    if (!queue) return res.status(503).json({ error: 'Queue not configured (REDIS_URL).' });
    const { jobId } = req.params;
    if (!jobId) return res.status(400).json({ error: 'Job ID required.' });
    try {
      const job = await queue.getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found.' });
      res.json({
        id: String(job.id),
        name: job.name,
        status: await job.getState(),
        timestamp: job.timestamp ?? null,
        processedOn: job.processedOn ?? null,
        finishedOn: job.finishedOn ?? null,
        failedReason: job.failedReason ?? null,
        data: job.data ?? null,
      });
    } catch (err) {
      console.error('Error fetching job data:', err);
      res.status(500).json({ error: err.message || 'Failed to load job data' });
    }
  });

  return router;
}
