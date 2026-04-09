import { Router } from 'express';
import { getStatsQueue } from '../../lib/queue.js';
import { makeStatsCache, getJobsBatched, getJobTs } from '../../lib/statsHelpers.js';

const completedStatsCache = makeStatsCache();

export function createCompletedRouter(config) {
  const router = Router();
  const queue = getStatsQueue();

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

  return router;
}
