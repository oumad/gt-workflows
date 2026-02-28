import { Router } from 'express';
import { getStatsQueue } from '../lib/queue.js';
import { toActivityJob, jobMatchesUser, anonymiseUserName } from '../lib/statsHelpers.js';

const USAGE_LIMIT_MIN = 100;
const USAGE_LIMIT_MAX = 2000;

function shouldAnonymiseUsers(config, req) {
  return config.anonymiseJobStatsUsers && config.guestUser && req.authUsername === config.guestUser;
}

export function createStatsRouter(config) {
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

  router.get('/stats/usage', async (req, res) => {
    if (!queue) {
      return res.json({
        configured: false,
        message: 'Set REDIS_URL (and optionally BULL_QUEUE_NAME) to see workflow usage.',
        workflowUsage: [],
        serverUsage: [],
        userActivity: [],
      });
    }
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, USAGE_LIMIT_MIN), USAGE_LIMIT_MAX);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const from = req.query.from ? new Date(req.query.from).getTime() : null;
      const to = req.query.to ? new Date(req.query.to).getTime() : null;
      const anonymise = shouldAnonymiseUsers(config, req);
      let userFilter = typeof req.query.user === 'string' && req.query.user.trim() ? req.query.user.trim() : null;
      const includeJobs = req.query.includeJobs === '1' || req.query.includeJobs === 'true';

      let jobs;
      let totalScanned = null;
      const timeRange = from != null && to != null && !Number.isNaN(from) && !Number.isNaN(to);

      const jobMatchesUserFilter = (job, filter) => {
        if (anonymise) {
          const user = job?.data?.executionContext?.context?.user;
          const label = user ? (user.name || user.email || user.id) : null;
          return label && anonymiseUserName(String(label)) === filter;
        }
        return jobMatchesUser(job, filter);
      };

      if (timeRange) {
        const chunkSize = Math.min(limit, 2000);
        const raw = await queue.getJobs(['completed'], offset, offset + chunkSize - 1);
        const rawFiltered = (raw || []).filter((j) => j != null);
        totalScanned = offset + rawFiltered.length;
        jobs = rawFiltered.filter((job) => {
          const ts = job.finishedOn ?? job.processedOn ?? job.timestamp;
          if (ts == null) return false;
          if (ts < from || ts > to) return false;
          return !userFilter || jobMatchesUserFilter(job, userFilter);
        });
      } else {
        const raw = await queue.getJobs(['completed'], offset, offset + limit - 1);
        jobs = (raw || []).filter((j) => j != null);
        if (userFilter) {
          jobs = jobs.filter((job) => jobMatchesUserFilter(job, userFilter));
        }
      }

      const byWorkflowName = {};
      const byServer = {};
      const byUser = {};
      for (const job of jobs) {
        if (!job) continue;
        const data = job.data || {};
        const workflow = data.workflow;
        const wfName = workflow?.name;
        const user = data.executionContext?.context?.user;
        let userLabel = null;
        if (user) {
          userLabel = user.name || user.email || user.id || 'Unknown';
          if (typeof userLabel === 'string' && userLabel !== 'Unknown') {
            if (!anonymise) byUser[userLabel] = (byUser[userLabel] || 0) + 1;
          } else if (user.id) {
            userLabel = user.id;
            if (!anonymise) byUser[user.id] = (byUser[user.id] || 0) + 1;
          }
        }
        const keyForUser = anonymise && userLabel ? anonymiseUserName(String(userLabel)) : userLabel;
        if (anonymise && keyForUser) {
          byUser[keyForUser] = (byUser[keyForUser] || 0) + 1;
        }
        if (wfName && typeof wfName === 'string') {
          if (!byWorkflowName[wfName]) {
            byWorkflowName[wfName] = { count: 0, users: new Set() };
          }
          byWorkflowName[wfName].count += 1;
          if (keyForUser) byWorkflowName[wfName].users.add(String(keyForUser));
        }
        const serverUrl = workflow?.config?.comfyui_config?.serverUrl;
        if (serverUrl && typeof serverUrl === 'string') {
          const normalized = serverUrl.replace(/\/$/, '');
          byServer[normalized] = (byServer[normalized] || 0) + 1;
        }
      }
      const workflowUsage = Object.entries(byWorkflowName)
        .map(([name, { count, users }]) => ({ name, count, users: Array.from(users) }))
        .sort((a, b) => b.count - a.count);
      const serverUsage = Object.entries(byServer)
        .map(([server, count]) => ({ server, count }))
        .sort((a, b) => b.count - a.count);
      const userActivity = Object.entries(byUser)
        .map(([user, count]) => ({ user, count }))
        .sort((a, b) => b.count - a.count);

      const payload = {
        configured: true,
        workflowUsage,
        serverUsage,
        userActivity,
        jobsSampled: jobs.length,
      };
      if (timeRange) {
        payload.from = req.query.from;
        payload.to = req.query.to;
        payload.totalScanned = totalScanned;
      } else {
        payload.offset = offset;
        payload.limit = limit;
      }
      if (userFilter) payload.userFilter = userFilter;
      if (includeJobs) {
        payload.jobs = jobs.map((j) => toActivityJob(j, anonymise)).filter(Boolean);
      }
      res.json(payload);
    } catch (err) {
      console.error('Error fetching workflow usage:', err);
      res.status(500).json({
        configured: true,
        error: err.message,
        workflowUsage: [],
        serverUsage: [],
        userActivity: [],
      });
    }
  });

  return router;
}
