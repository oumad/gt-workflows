import { Router } from 'express';
import { getStatsQueue } from '../../lib/queue.js';
import { makeStatsCache, getJobsBatched, getJobTs } from '../../lib/statsHelpers.js';

const doctorStatsCache = makeStatsCache();
const slowJobsCache = makeStatsCache(60_000); // 60s TTL — fresher for diagnostics

function getCachedDoctorStats(key) { return doctorStatsCache.get(key); }
function setCachedDoctorStats(key, data) { doctorStatsCache.set(key, data); }

export function createDoctorRouter(config) {
  const router = Router();
  const queue = getStatsQueue();

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

  /**
   * Slow jobs: completed + failed jobs whose generation duration exceeds a threshold.
   * Returns enriched records including queue wait time and failure reason category.
   */
  router.get('/stats/slow-jobs', async (req, res) => {
    if (!queue) return res.json({ configured: false, jobs: [] });
    try {
      const thresholdSec = Math.max(parseInt(req.query.threshold, 10) || 600, 10);
      const thresholdMs = thresholdSec * 1000;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const period = req.query.period || 'all';
      const periodMs = { '1h': 3_600_000, '1d': 86_400_000, '1w': 7 * 86_400_000, '1m': 30 * 86_400_000 }[period] ?? null;
      const since = periodMs != null ? Date.now() - periodMs : null;
      const cacheKey = `${thresholdSec}:${limit}:${period}`;
      const cached = slowJobsCache.get(cacheKey);
      if (cached) return res.json(cached);

      // Scan both completed and failed jobs (up to 5000 each)
      const [completedRaw, failedRaw] = await Promise.all([
        getJobsBatched(queue, 'completed', 0, { batchSize: 200, maxJobs: 5000 }),
        getJobsBatched(queue, 'failed',    0, { batchSize: 200, maxJobs: 5000 }),
      ]);

      const classifyReason = (reason) => {
        const r = (reason || '').toLowerCase();
        if (r.includes('timeout') || r.includes('timed out')) return 'timeout';
        if (r.includes('cuda out of memory') || r.includes('out of memory') || r.includes('oom') || r.includes('vram')) return 'oom';
        if (r.includes('interrupt') || r.includes('cancel') || r.includes('abort')) return 'cancelled';
        if (r.includes('econnrefused') || r.includes('fetch failed') || r.includes('network') || r.includes('502') || r.includes('503') || r.includes('504')) return 'network';
        if (r.includes('error') || r.includes('exception') || r.includes('traceback')) return 'server_error';
        return 'unknown';
      };

      const extractJob = (job, status) => {
        const data = job.data || {};
        const workflow = data.workflow || {};
        const wfName = typeof workflow.name === 'string' ? workflow.name : (job.name || '');
        const serverUrl = workflow.config?.comfyui_config?.serverUrl;
        const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : '—';
        const userObj = data.executionContext?.context?.user;
        const user = userObj ? String(userObj.name || userObj.email || userObj.id || '—') : '—';
        const processedOn = job.processedOn ?? null;
        const finishedOn = job.finishedOn ?? null;
        const timestamp = job.timestamp ?? null;
        const duration = (processedOn != null && finishedOn != null) ? finishedOn - processedOn : null;
        const queueWait = (timestamp != null && processedOn != null) ? processedOn - timestamp : null;
        const timeoutMs = typeof data.workflow?.config?.timeout === 'number' ? data.workflow.config.timeout * 1000 : null;
        const failedReason = job.failedReason || null;
        let reasonCategory = status === 'failed' ? classifyReason(failedReason) : null;
        // Detect implicit timeout: completed/failed jobs that ran close to their timeout
        if (!reasonCategory && timeoutMs && duration && duration >= timeoutMs * 0.95) reasonCategory = 'timeout';
        return { id: String(job.id), name: wfName, server, user, status, processedOn, finishedOn, timestamp, duration, queueWait, failedReason, reasonCategory, timeoutMs };
      };

      const slowJobs = [
        ...completedRaw.map((j) => extractJob(j, 'completed')),
        ...failedRaw.map((j) => extractJob(j, 'failed')),
      ]
        .filter((j) => j.duration != null && j.duration >= thresholdMs)
        .filter((j) => since == null || (j.finishedOn != null && j.finishedOn >= since))
        .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
        .slice(0, limit);

      const result = { configured: true, jobs: slowJobs, thresholdSec };
      slowJobsCache.set(cacheKey, result);
      return res.json(result);
    } catch (err) {
      console.error('Error fetching slow jobs:', err);
      res.status(500).json({ configured: true, error: err.message, jobs: [] });
    }
  });

  return router;
}
