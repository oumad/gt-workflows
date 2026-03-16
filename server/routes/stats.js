import { Router } from 'express';
import { getStatsQueue } from '../lib/queue.js';
import { toActivityJob, jobMatchesUser, anonymiseUserName } from '../lib/statsHelpers.js';

const USAGE_LIMIT_MIN = 100;
const USAGE_LIMIT_MAX = 2000;

/**
 * Fetch jobs in small batches, stopping early once a job's timestamp falls below cutoffMs.
 * Jobs are returned newest-first by Bull, so the first job older than cutoff means all
 * subsequent ones are also older — safe to abort.
 * @param {import('bull').Queue} queue
 * @param {string} type - 'failed' | 'completed'
 * @param {number} cutoffMs - stop when job timestamp < this (0 = no early exit)
 * @param {{ batchSize?: number, maxJobs?: number }} [opts]
 */
async function getJobsBatched(queue, type, cutoffMs, { batchSize = 200, maxJobs = 5000 } = {}) {
  const result = [];
  for (let start = 0; start < maxJobs; start += batchSize) {
    const batch = await queue.getJobs([type], start, start + batchSize - 1);
    if (!batch || batch.length === 0) break;
    for (const job of batch) {
      if (!job) continue;
      if (cutoffMs > 0) {
        const ts = job.finishedOn ?? job.processedOn ?? job.timestamp;
        if (ts != null && ts < cutoffMs) return result;
      }
      result.push(job);
    }
    if (batch.length < batchSize) break;
  }
  return result;
}

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

  router.get('/stats/doctor', async (req, res) => {
    if (!queue) {
      return res.json({ configured: false, message: 'Queue not configured.' });
    }
    try {
      const counts = await queue.getJobCounts();
      const totalFailed = counts.failed ?? 0;

      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const thisWeekStart = now - oneWeekMs;
      const prevWeekStart = thisWeekStart - oneWeekMs;

      const PERIOD_MS = {
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
      };
      const period = req.query.period || '1w';
      const periodCutoff = period === 'all' ? 0 : now - (PERIOD_MS[period] ?? PERIOD_MS['1w']);

      const WEEKLY_HISTORY_COUNT = 5;
      const weekBuckets = Array.from({ length: WEEKLY_HISTORY_COUNT }, () => 0);
      const weekBucketsTotal = Array.from({ length: WEEKLY_HISTORY_COUNT }, () => 0);

      const fiveWeeksAgo = now - 5 * oneWeekMs;
      // Early exit cutoff for failed jobs: stop fetching once jobs are older than the
      // selected period (and older than 5 weeks, since history only goes back that far).
      // For 'all' (periodCutoff=0): no time-based early exit — rely on maxJobs cap instead.
      const failedCutoff = periodCutoff > 0 ? Math.min(periodCutoff, fiveWeeksAgo) : 0;
      const [failedJobs, completedJobs] = await Promise.all([
        getJobsBatched(queue, 'failed', failedCutoff, { batchSize: 200, maxJobs: 5000 }),
        getJobsBatched(queue, 'completed', fiveWeeksAgo, { batchSize: 200, maxJobs: 2000 }),
      ]);

      for (const job of completedJobs) {
        if (!job) continue;
        const ts = job.finishedOn ?? job.processedOn ?? job.timestamp;
        if (ts == null) continue;
        const weeksAgo = Math.floor((now - ts) / oneWeekMs);
        if (weeksAgo >= 0 && weeksAgo < WEEKLY_HISTORY_COUNT) {
          weekBucketsTotal[weeksAgo]++;
        }
      }

      const byWorkflow = {};
      const byServer = {};
      const byUser = {};
      const byError = {};

      for (const job of failedJobs) {
        if (!job) continue;
        const ts = job.finishedOn ?? job.processedOn ?? job.timestamp;
        if (ts == null) continue;

        const weeksAgo = Math.floor((now - ts) / oneWeekMs);
        if (weeksAgo >= 0 && weeksAgo < WEEKLY_HISTORY_COUNT) {
          weekBuckets[weeksAgo]++;
        }

        if (ts >= periodCutoff) {
          const data = job.data || {};
          const workflow = data.workflow || {};
          const wfName = typeof workflow.name === 'string' ? workflow.name : null;
          const serverUrl = workflow.config?.comfyui_config?.serverUrl;
          const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : null;
          const userObj = data.executionContext?.context?.user;
          const userLabel = userObj ? (userObj.name || userObj.email || userObj.id || null) : null;

          if (wfName) byWorkflow[wfName] = (byWorkflow[wfName] || 0) + 1;
          if (server) byServer[server] = (byServer[server] || 0) + 1;
          if (userLabel) byUser[String(userLabel)] = (byUser[String(userLabel)] || 0) + 1;

          const reason = job.failedReason;
          if (reason && typeof reason === 'string') {
            const errorType = reason.split('\n')[0].trim().slice(0, 120) || 'Unknown error';
            byError[errorType] = (byError[errorType] || 0) + 1;
          }
        }
      }

      const toSorted = (map) =>
        Object.entries(map)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);

      const weeklyHistory = weekBuckets.map((count, i) => ({
        label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i} weeks ago`,
        count,
        total: count + weekBucketsTotal[i],
      }));

      res.json({
        configured: true,
        totalFailed,
        thisWeekFailed: weekBuckets[0],
        prevWeekFailed: weekBuckets[1],
        weeklyHistory,
        topWorkflows: toSorted(byWorkflow),
        topServers: toSorted(byServer),
        topUsers: toSorted(byUser),
        topErrors: toSorted(byError),
        period,
      });
    } catch (err) {
      console.error('Error fetching doctor stats:', err);
      res.status(500).json({ configured: true, error: err.message });
    }
  });

  router.get('/stats/doctor/failed-jobs', async (req, res) => {
    if (!queue) {
      return res.json({ configured: false, jobs: [], total: 0 });
    }
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 5), 100);
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

      const mapJob = (job) => {
        const data = job.data || {};
        const workflow = data.workflow || {};
        const wfName = typeof workflow.name === 'string' ? workflow.name : '';
        const serverUrl = workflow.config?.comfyui_config?.serverUrl;
        const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : '';
        const userObj = data.executionContext?.context?.user;
        const user = userObj ? (userObj.name || userObj.email || userObj.id || '') : '';
        return {
          id: String(job.id),
          name: wfName || job.name || '',
          server: server || '—',
          user: user ? String(user) : '—',
          failedReason: job.failedReason || null,
          stacktrace: Array.isArray(job.stacktrace) ? job.stacktrace : [],
          timestamp: job.timestamp ?? null,
          processedOn: job.processedOn ?? null,
          finishedOn: job.finishedOn ?? null,
          attemptsMade: job.attemptsMade ?? 0,
          data: data,
        };
      };

      if (search) {
        const allRaw = await getJobsBatched(queue, 'failed', 0, { batchSize: 200, maxJobs: 2000 });
        const allMapped = (allRaw || []).filter((j) => j != null).map(mapJob);
        const filtered = allMapped.filter((j) =>
          j.id.toLowerCase().includes(search) ||
          j.name.toLowerCase().includes(search) ||
          j.server.toLowerCase().includes(search) ||
          j.user.toLowerCase().includes(search) ||
          (j.failedReason && j.failedReason.toLowerCase().includes(search))
        );
        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const jobs = filtered.slice(start, start + pageSize);
        res.json({ configured: true, jobs, total, page, pageSize });
      } else {
        const counts = await queue.getJobCounts();
        const total = counts.failed ?? 0;
        const start = (page - 1) * pageSize;
        const raw = await queue.getJobs(['failed'], start, start + pageSize - 1);
        const jobs = (raw || []).filter((j) => j != null).map(mapJob);
        res.json({ configured: true, jobs, total, page, pageSize });
      }
    } catch (err) {
      console.error('Error fetching failed jobs:', err);
      res.status(500).json({ configured: true, error: err.message, jobs: [], total: 0 });
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
      const byServerWorkflow = {};
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
          if (wfName && typeof wfName === 'string') {
            if (!byServerWorkflow[normalized]) byServerWorkflow[normalized] = {};
            byServerWorkflow[normalized][wfName] = (byServerWorkflow[normalized][wfName] || 0) + 1;
          }
        }
      }
      const workflowUsage = Object.entries(byWorkflowName)
        .map(([name, { count, users }]) => ({ name, count, users: Array.from(users) }))
        .sort((a, b) => b.count - a.count);
      const serverUsage = Object.entries(byServer)
        .map(([server, count]) => ({ server, count }))
        .sort((a, b) => b.count - a.count);
      const serverWorkflows = Object.entries(byServerWorkflow).map(([server, wfMap]) => ({
        server,
        workflows: Object.entries(wfMap)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      }));
      const userActivity = Object.entries(byUser)
        .map(([user, count]) => ({ user, count }))
        .sort((a, b) => b.count - a.count);

      const payload = {
        configured: true,
        workflowUsage,
        serverUsage,
        serverWorkflows,
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
