import { Router } from 'express';
import { getStatsQueue } from '../lib/queue.js';
import { toActivityJob, jobMatchesUser, anonymiseUserName } from '../lib/statsHelpers.js';

const USAGE_LIMIT_MIN = 100;
const USAGE_LIMIT_MAX = 2000;

/** Extract the best available timestamp from a Bull job. */
function getJobTs(job) {
  return job?.finishedOn ?? job?.processedOn ?? job?.timestamp ?? null;
}

/** Generic in-memory stats cache factory. */
function makeStatsCache(ttlMs = 90_000, maxSize = 30) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.ts > ttlMs) { store.delete(key); return null; }
      return entry.data;
    },
    set(key, data) {
      if (store.size >= maxSize) store.delete(store.keys().next().value);
      store.set(key, { data, ts: Date.now() });
    },
  };
}

const doctorStatsCache = makeStatsCache();
const completedStatsCache = makeStatsCache();

function getCachedDoctorStats(key) { return doctorStatsCache.get(key); }
function setCachedDoctorStats(key, data) { doctorStatsCache.set(key, data); }

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
      const hideAborted = req.query.hideAborted === '1';
      const force = req.query.force === '1';
      const period = req.query.period || '1w';

      const cacheKey = `${period}:${hideAborted ? 1 : 0}`;
      if (!force) {
        const cached = getCachedDoctorStats(cacheKey);
        if (cached) return res.json(cached);
      }

      const counts = await queue.getJobCounts();

      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

      const PERIOD_MS = {
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
      };
      const periodCutoff = period === 'all' ? 0 : now - (PERIOD_MS[period] ?? PERIOD_MS['1w']);

      const WEEKLY_HISTORY_COUNT = 5;
      const weekBuckets = Array.from({ length: WEEKLY_HISTORY_COUNT }, () => 0);
      const weekBucketsTotal = Array.from({ length: WEEKLY_HISTORY_COUNT }, () => 0);

      const fiveWeeksAgo = now - 5 * oneWeekMs;
      // Early exit cutoff: stop fetching once jobs are older than the selected period and 5-week history window.
      // For 'all' (periodCutoff=0): no time-based early exit — rely on maxJobs cap instead.
      const failedCutoff = periodCutoff > 0 ? Math.min(periodCutoff, fiveWeeksAgo) : 0;
      const [rawFailedJobs, completedJobs] = await Promise.all([
        getJobsBatched(queue, 'failed', failedCutoff, { batchSize: 200, maxJobs: 5000 }),
        getJobsBatched(queue, 'completed', fiveWeeksAgo, { batchSize: 200, maxJobs: 2000 }),
      ]);

      const isAborted = (job) => job?.failedReason && job.failedReason.toLowerCase().includes('abort');
      const failedJobs = hideAborted ? rawFailedJobs.filter((j) => !isAborted(j)) : rawFailedJobs;
      // Count failures within the selected period only (not all-time Bull counter, which ignores period)
      let totalFailed;
      if (period === 'all' && !hideAborted) {
        totalFailed = counts.failed ?? 0;
      } else {
        totalFailed = failedJobs.filter((j) => {
          if (periodCutoff === 0) return true;
          const ts = getJobTs(j);
          return ts != null && ts >= periodCutoff;
        }).length;
      }

      for (const job of completedJobs) {
        if (!job) continue;
        const ts = getJobTs(job);
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
        const ts = getJobTs(job);
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

      const responseData = {
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
      };

      setCachedDoctorStats(cacheKey, responseData);
      return res.json(responseData);
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
      const hideAborted = req.query.hideAborted === '1';
      const filterWorkflow = typeof req.query.workflow === 'string' ? req.query.workflow : '';
      const filterServer = typeof req.query.server === 'string' ? req.query.server : '';
      const filterUser = typeof req.query.user === 'string' ? req.query.user : '';
      const filterError = typeof req.query.error === 'string' ? req.query.error : '';

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

      const needsScan = search || hideAborted || filterWorkflow || filterServer || filterUser || filterError;
      if (needsScan) {
        const maxJobs = search ? 1000 : 2000;
        const allRaw = await getJobsBatched(queue, 'failed', 0, { batchSize: 200, maxJobs });
        let allMapped = (allRaw || []).filter((j) => j != null).map(mapJob);
        if (search) {
          allMapped = allMapped.filter((j) =>
            j.id.toLowerCase().includes(search) ||
            j.name.toLowerCase().includes(search) ||
            j.server.toLowerCase().includes(search) ||
            j.user.toLowerCase().includes(search) ||
            (j.failedReason && j.failedReason.toLowerCase().includes(search))
          );
        }
        if (filterWorkflow) allMapped = allMapped.filter((j) => j.name === filterWorkflow);
        if (filterServer) allMapped = allMapped.filter((j) => j.server === filterServer);
        if (filterUser) allMapped = allMapped.filter((j) => j.user === filterUser);
        if (filterError) allMapped = allMapped.filter((j) => j.failedReason && j.failedReason.toLowerCase().includes(filterError.toLowerCase()));
        if (hideAborted) {
          allMapped = allMapped.filter((j) => !(j.failedReason && j.failedReason.toLowerCase().includes('abort')));
        }
        const total = allMapped.length;
        const start = (page - 1) * pageSize;
        const jobs = allMapped.slice(start, start + pageSize);
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

  router.get('/stats/completed', async (req, res) => {
    if (!queue) return res.json({ configured: false, message: 'Queue not configured.' });
    try {
      const force = req.query.force === '1';
      const period = req.query.period || '1w';
      const cacheKey = period;
      if (!force) {
        const cached = completedStatsCache.get(cacheKey);
        if (cached) return res.json(cached);
      }

      const counts = await queue.getJobCounts();
      const totalCompleted = counts.completed ?? 0;

      const now = Date.now();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const PERIOD_MS = {
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
      };
      const periodCutoff = period === 'all' ? 0 : now - (PERIOD_MS[period] ?? PERIOD_MS['1w']);

      const WEEKLY_HISTORY_COUNT = 5;
      const weekBuckets = Array.from({ length: WEEKLY_HISTORY_COUNT }, () => 0);

      const fiveWeeksAgo = now - 5 * oneWeekMs;
      const cutoff = periodCutoff > 0 ? Math.min(periodCutoff, fiveWeeksAgo) : 0;
      // Smaller scan caps for short periods — no point scanning 5k jobs to find last-hour data
      const PERIOD_MAX_JOBS = { '1h': 500, '1d': 1500, '1w': 3000, '1m': 5000, 'all': 5000 };
      const maxCompletedJobs = PERIOD_MAX_JOBS[period] ?? 3000;
      const completedJobs = await getJobsBatched(queue, 'completed', cutoff, { batchSize: 200, maxJobs: maxCompletedJobs });

      const byWorkflow = {};
      const byServer = {};
      const byUser = {};

      for (const job of completedJobs) {
        if (!job) continue;
        const ts = getJobTs(job);
        if (ts == null) continue;

        const weeksAgo = Math.floor((now - ts) / oneWeekMs);
        if (weeksAgo >= 0 && weeksAgo < WEEKLY_HISTORY_COUNT) weekBuckets[weeksAgo]++;

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
        }
      }

      const toSorted = (map) =>
        Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

      const weeklyHistory = weekBuckets.map((count, i) => ({
        label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i} weeks ago`,
        count,
      }));

      const responseData = {
        configured: true,
        totalCompleted,
        weeklyHistory,
        topWorkflows: toSorted(byWorkflow),
        topServers: toSorted(byServer),
        topUsers: toSorted(byUser),
        period,
      };

      completedStatsCache.set(cacheKey, responseData);
      return res.json(responseData);
    } catch (err) {
      console.error('Error fetching completed stats:', err);
      res.status(500).json({ configured: true, error: err.message });
    }
  });

  router.get('/stats/completed/jobs', async (req, res) => {
    if (!queue) return res.json({ configured: false, jobs: [], total: 0 });
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 5), 100);
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
      const sortBy = typeof req.query.sort === 'string' ? req.query.sort : '';
      const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

      // Filters
      const filterUser = typeof req.query.filterUser === 'string' ? req.query.filterUser.trim() : '';
      const filterServer = typeof req.query.filterServer === 'string' ? req.query.filterServer.trim() : '';
      const filterWorkflow = typeof req.query.filterWorkflow === 'string' ? req.query.filterWorkflow.trim() : '';
      const hasFilters = !!(filterUser || filterServer || filterWorkflow);

      const mapJob = (job) => {
        const data = job.data || {};
        const workflow = data.workflow || {};
        const wfName = typeof workflow.name === 'string' ? workflow.name : '';
        const serverUrl = workflow.config?.comfyui_config?.serverUrl;
        const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : '';
        const userObj = data.executionContext?.context?.user;
        const user = userObj ? (userObj.name || userObj.email || userObj.id || '') : '';
        const processedOn = job.processedOn ?? null;
        const finishedOn = job.finishedOn ?? null;
        return {
          id: String(job.id),
          name: wfName || job.name || '',
          server: server || '—',
          user: user ? String(user) : '—',
          timestamp: job.timestamp ?? null,
          processedOn,
          finishedOn,
          duration: (processedOn != null && finishedOn != null) ? finishedOn - processedOn : null,
        };
      };

      const getSortValue = (job, key) => {
        if (key === 'generation') return job.duration ?? -1;
        if (key === 'total') {
          return (job.finishedOn != null && job.timestamp != null) ? job.finishedOn - job.timestamp : -1;
        }
        if (key === 'finished') return job.finishedOn ?? -1;
        return 0;
      };

      const needsFullSort = sortBy === 'generation' || sortBy === 'total';

      // Direct job ID lookup — search any state (completed, failed, etc.)
      const isIdSearch = search && /^\d+$/.test(search);
      if (isIdSearch) {
        const job = await queue.getJob(search);
        if (job) {
          const mapped = mapJob(job);
          mapped.status = await job.getState();
          res.json({ configured: true, jobs: [mapped], total: 1, page: 1, pageSize });
        } else {
          res.json({ configured: true, jobs: [], total: 0, page: 1, pageSize });
        }
      } else if (search || needsFullSort || hasFilters) {
        // Fetch jobs for text search, custom sort, or filters (Redis sorted set is only ordered by finishedOn)
        const maxJobs = search ? 10000 : 5000;
        const allRaw = await getJobsBatched(queue, 'completed', 0, { batchSize: 200, maxJobs });
        let allMapped = (allRaw || []).filter((j) => j != null).map(mapJob);

        if (search) {
          allMapped = allMapped.filter((j) =>
            j.id.toLowerCase().includes(search) ||
            j.name.toLowerCase().includes(search) ||
            j.server.toLowerCase().includes(search) ||
            j.user.toLowerCase().includes(search)
          );
        }

        // Apply filters
        if (filterUser) allMapped = allMapped.filter((j) => j.user === filterUser);
        if (filterServer) allMapped = allMapped.filter((j) => j.server === filterServer);
        if (filterWorkflow) allMapped = allMapped.filter((j) => j.name === filterWorkflow);

        if (sortBy) {
          allMapped.sort((a, b) => {
            const va = getSortValue(a, sortBy);
            const vb = getSortValue(b, sortBy);
            return sortDir === 'asc' ? va - vb : vb - va;
          });
        }

        const total = allMapped.length;
        const start = (page - 1) * pageSize;
        res.json({ configured: true, jobs: allMapped.slice(start, start + pageSize), total, page, pageSize });
      } else {
        // Default: use Redis sorted set ordering (by finishedOn desc)
        const counts = await queue.getJobCounts();
        const total = counts.completed ?? 0;

        if (sortBy === 'finished' && sortDir === 'asc') {
          // Reverse the default Redis order
          const end = total - 1;
          const start = (page - 1) * pageSize;
          const raw = await queue.getJobs(['completed'], end - start - pageSize + 1, end - start);
          const jobs = (raw || []).filter((j) => j != null).map(mapJob).reverse();
          res.json({ configured: true, jobs, total, page, pageSize });
        } else {
          const start = (page - 1) * pageSize;
          const raw = await queue.getJobs(['completed'], start, start + pageSize - 1);
          const jobs = (raw || []).filter((j) => j != null).map(mapJob);
          res.json({ configured: true, jobs, total, page, pageSize });
        }
      }
    } catch (err) {
      console.error('Error fetching completed jobs:', err);
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
      let reachedRangeStart = false;
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
        const minTsInChunk = rawFiltered.reduce((acc, j) => {
          const ts = j.finishedOn ?? j.processedOn ?? j.timestamp;
          return ts != null && (acc == null || ts < acc) ? ts : acc;
        }, null);
        reachedRangeStart = minTsInChunk != null && minTsInChunk < from;
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
        if (anonymise && keyForUser && userLabel !== 'Unknown') {
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
        payload.reachedRangeStart = reachedRangeStart;
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
