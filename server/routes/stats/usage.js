import { Router } from 'express';
import { getStatsQueue } from '../../lib/queue.js';
import { toActivityJob, jobMatchesUser, anonymiseUserName, makeStatsCache, getJobsBatched, getJobTs, shouldAnonymiseUsers } from '../../lib/statsHelpers.js';

const USAGE_LIMIT_MIN = 100;
const USAGE_LIMIT_MAX = 2000;

const userServerCache = makeStatsCache();
const serverStatsCache = makeStatsCache(90_000);
const wfPerfCache = makeStatsCache(90_000);

export function createUsageRouter(config) {
  const router = Router();
  const queue = getStatsQueue();

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

  router.get('/stats/usage/user-server', async (req, res) => {
    if (!queue) return res.json({ configured: false, byUser: [], byServer: [], byServerWorkflow: [], period: 'all' });
    try {
      const period = req.query.period || '1w';
      const force = req.query.force === '1';
      const cacheKey = period;
      if (!force) {
        const cached = userServerCache.get(cacheKey);
        if (cached) return res.json(cached);
      }

      const now = Date.now();
      const PERIOD_MS = {
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
      };
      const periodCutoff = period === 'all' ? 0 : now - (PERIOD_MS[period] ?? PERIOD_MS['1w']);
      const PERIOD_MAX_JOBS = { '1h': 500, '1d': 1500, '1w': 3000, '1m': 5000, 'all': 5000 };
      const maxJobs = PERIOD_MAX_JOBS[period] ?? 3000;

      const jobs = await getJobsBatched(queue, 'completed', periodCutoff, { batchSize: 200, maxJobs });

      // byUserServer[user][server] = { count, durationMs }
      // byServerUser[server][user] = { count, durationMs }
      // byServerWorkflow[server][workflow] = count
      // byUserWorkflow[user][workflow] = { count, durationMs }
      const byUserServer = {};
      const byServerUser = {};
      const byServerWorkflow = {};
      const byUserWorkflow = {};

      for (const job of jobs) {
        if (!job) continue;
        const ts = getJobTs(job);
        if (ts == null || (periodCutoff > 0 && ts < periodCutoff)) continue;
        const data = job.data || {};
        const workflow = data.workflow || {};
        const wfName = typeof workflow.name === 'string' ? workflow.name : null;
        const serverUrl = workflow.config?.comfyui_config?.serverUrl;
        const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : null;
        const userObj = data.executionContext?.context?.user;
        const user = userObj ? String(userObj.name || userObj.email || userObj.id || '') : null;
        const duration = (job.processedOn != null && job.finishedOn != null)
          ? job.finishedOn - job.processedOn : null;

        if (server && user) {
          if (!byUserServer[user]) byUserServer[user] = {};
          if (!byUserServer[user][server]) byUserServer[user][server] = { count: 0, durationMs: 0 };
          byUserServer[user][server].count++;
          if (duration != null && duration >= 0) byUserServer[user][server].durationMs += duration;

          if (!byServerUser[server]) byServerUser[server] = {};
          if (!byServerUser[server][user]) byServerUser[server][user] = { count: 0, durationMs: 0 };
          byServerUser[server][user].count++;
          if (duration != null && duration >= 0) byServerUser[server][user].durationMs += duration;
        }

        if (server && wfName) {
          if (!byServerWorkflow[server]) byServerWorkflow[server] = {};
          byServerWorkflow[server][wfName] = (byServerWorkflow[server][wfName] || 0) + 1;
        }

        if (user && wfName) {
          if (!byUserWorkflow[user]) byUserWorkflow[user] = {};
          if (!byUserWorkflow[user][wfName]) byUserWorkflow[user][wfName] = { count: 0, durationMs: 0 };
          byUserWorkflow[user][wfName].count++;
          if (duration != null && duration >= 0) byUserWorkflow[user][wfName].durationMs += duration;
        }
      }

      const toUserEntry = (user, serverMap) => {
        const servers = Object.entries(serverMap)
          .map(([server, { count, durationMs }]) => ({ server, count, durationMs }))
          .sort((a, b) => b.count - a.count);
        const total = servers.reduce((s, x) => s + x.count, 0);
        const totalDurationMs = servers.reduce((s, x) => s + x.durationMs, 0);

        const wfRaw = Object.entries(byUserWorkflow[user] ?? {})
          .map(([name, { count, durationMs }]) => ({ name, count, durationMs }))
          .sort((a, b) => b.count - a.count);
        const wfTotal = wfRaw.reduce((s, x) => s + x.count, 0);
        const wfDurationTotal = wfRaw.reduce((s, x) => s + x.durationMs, 0);

        return {
          user,
          total,
          totalDurationMs,
          servers: servers.map((x) => ({
            ...x,
            pct: total > 0 ? Math.round((x.count / total) * 1000) / 10 : 0,
            durationPct: totalDurationMs > 0 ? Math.round((x.durationMs / totalDurationMs) * 1000) / 10 : 0,
          })),
          workflows: wfRaw.map((x) => ({
            ...x,
            pct: wfTotal > 0 ? Math.round((x.count / wfTotal) * 1000) / 10 : 0,
            durationPct: wfDurationTotal > 0 ? Math.round((x.durationMs / wfDurationTotal) * 1000) / 10 : 0,
          })),
        };
      };

      const toServerEntry = (server, userMap) => {
        const users = Object.entries(userMap)
          .map(([user, { count, durationMs }]) => ({ user, count, durationMs }))
          .sort((a, b) => b.count - a.count);
        const total = users.reduce((s, x) => s + x.count, 0);
        const totalDurationMs = users.reduce((s, x) => s + x.durationMs, 0);
        return {
          server,
          total,
          totalDurationMs,
          users: users.map((x) => ({
            ...x,
            pct: total > 0 ? Math.round((x.count / total) * 1000) / 10 : 0,
            durationPct: totalDurationMs > 0 ? Math.round((x.durationMs / totalDurationMs) * 1000) / 10 : 0,
          })),
        };
      };

      const byUser = Object.entries(byUserServer)
        .map(([user, serverMap]) => toUserEntry(user, serverMap))
        .sort((a, b) => b.total - a.total);

      const byServer = Object.entries(byServerUser)
        .map(([server, userMap]) => toServerEntry(server, userMap))
        .sort((a, b) => b.total - a.total);

      const toServerWorkflowEntry = (server, wfMap) => {
        const workflows = Object.entries(wfMap)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
        const total = workflows.reduce((s, x) => s + x.count, 0);
        return {
          server,
          total,
          workflows: workflows.map((x) => ({ ...x, pct: total > 0 ? Math.round((x.count / total) * 1000) / 10 : 0 })),
        };
      };

      const byServerWorkflowArr = Object.entries(byServerWorkflow)
        .map(([server, wfMap]) => toServerWorkflowEntry(server, wfMap))
        .sort((a, b) => b.total - a.total);

      const responseData = { configured: true, byUser, byServer, byServerWorkflow: byServerWorkflowArr, period };
      userServerCache.set(cacheKey, responseData);
      return res.json(responseData);
    } catch (err) {
      console.error('Error fetching user-server stats:', err);
      res.status(500).json({ configured: true, error: err.message, byUser: [], byServer: [], byServerWorkflow: [], period: 'all' });
    }
  });

  router.get('/stats/server-comparison', async (req, res) => {
    if (!queue) return res.json({ configured: false, servers: [] });
    try {
      const period = req.query.period || '1d';
      const cached = serverStatsCache.get(period);
      if (cached) return res.json(cached);

      const PERIOD_MS = {
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
      };
      const now = Date.now();
      const periodCutoff = period === 'all' ? 0 : now - (PERIOD_MS[period] ?? PERIOD_MS['1d']);

      const [completedRaw, failedRaw] = await Promise.all([
        getJobsBatched(queue, 'completed', periodCutoff, { batchSize: 200, maxJobs: 5000 }),
        getJobsBatched(queue, 'failed', periodCutoff, { batchSize: 200, maxJobs: 5000 }),
      ]);

      // byServer[server] = { durations[], failCount, totalCount }
      const byServer = {};

      const processJob = (job, failed) => {
        if (!job) return;
        const ts = getJobTs(job);
        if (ts == null || (periodCutoff > 0 && ts < periodCutoff)) return;
        const data = job.data || {};
        const serverUrl = data.workflow?.config?.comfyui_config?.serverUrl;
        const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : null;
        if (!server) return;
        const duration = (job.processedOn != null && job.finishedOn != null)
          ? job.finishedOn - job.processedOn
          : null;
        if (!byServer[server]) byServer[server] = { durations: [], failCount: 0, totalCount: 0 };
        byServer[server].totalCount++;
        if (failed) byServer[server].failCount++;
        if (duration != null && duration >= 0) byServer[server].durations.push(duration);
      };

      for (const job of completedRaw) processJob(job, false);
      for (const job of failedRaw) processJob(job, true);

      const servers = Object.entries(byServer).map(([server, { durations, failCount, totalCount }]) => {
        durations.sort((a, b) => a - b);
        const count = durations.length;
        const avgMs = count > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / count) : null;
        const failRate = totalCount > 0 ? Math.round((failCount / totalCount) * 1000) / 10 : 0;
        return { server, totalCount, failCount, failRate, avgMs };
      })
        .sort((a, b) => b.totalCount - a.totalCount);

      const result = { configured: true, servers, period };
      serverStatsCache.set(period, result);
      return res.json(result);
    } catch (err) {
      console.error('Error fetching server comparison:', err);
      res.status(500).json({ configured: true, error: err.message, servers: [] });
    }
  });

  router.get('/stats/workflow-performance', async (req, res) => {
    if (!queue) return res.json({ configured: false, workflows: [] });
    try {
      const period = req.query.period || 'all';
      const cacheKey = period;
      const cached = wfPerfCache.get(cacheKey);
      if (cached) return res.json(cached);

      const PERIOD_MS = {
        '1h': 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
        '1m': 30 * 24 * 60 * 60 * 1000,
      };
      const now = Date.now();
      const periodCutoff = period === 'all' ? 0 : now - (PERIOD_MS[period] ?? 0);
      const PERIOD_MAX_JOBS = { '1h': 500, '1d': 2000, '1w': 5000, '1m': 5000, 'all': 5000 };
      const maxJobs = PERIOD_MAX_JOBS[period] ?? 5000;

      const [completedRaw, failedRaw] = await Promise.all([
        getJobsBatched(queue, 'completed', periodCutoff, { batchSize: 200, maxJobs }),
        getJobsBatched(queue, 'failed', periodCutoff, { batchSize: 200, maxJobs }),
      ]);

      // byWorkflow[name] = { durations[], failCount, totalCount }
      const byWorkflow = {};

      const processJob = (job, failed) => {
        if (!job) return;
        const ts = getJobTs(job);
        if (ts == null || (periodCutoff > 0 && ts < periodCutoff)) return;
        const data = job.data || {};
        const workflow = data.workflow || {};
        const name = typeof workflow.name === 'string' && workflow.name ? workflow.name : null;
        if (!name) return;
        const duration = (job.processedOn != null && job.finishedOn != null)
          ? job.finishedOn - job.processedOn
          : null;
        if (!byWorkflow[name]) byWorkflow[name] = { durations: [], failCount: 0, totalCount: 0 };
        byWorkflow[name].totalCount++;
        if (failed) byWorkflow[name].failCount++;
        if (duration != null && duration >= 0) byWorkflow[name].durations.push(duration);
      };

      for (const job of completedRaw) processJob(job, false);
      for (const job of failedRaw) processJob(job, true);

      const workflows = Object.entries(byWorkflow).map(([name, { durations, failCount, totalCount }]) => {
        durations.sort((a, b) => a - b);
        const count = durations.length;
        const avgMs = count > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / count) : null;
        const p95Ms = count > 0 ? durations[Math.floor(count * 0.95)] ?? durations[count - 1] : null;
        const maxMs = count > 0 ? durations[count - 1] : null;
        const failRate = totalCount > 0 ? Math.round((failCount / totalCount) * 1000) / 10 : 0;
        return { name, totalCount, failCount, failRate, avgMs, p95Ms, maxMs };
      })
        .sort((a, b) => (b.avgMs ?? 0) - (a.avgMs ?? 0));

      const result = { configured: true, workflows, period };
      wfPerfCache.set(cacheKey, result);
      return res.json(result);
    } catch (err) {
      console.error('Error fetching workflow performance:', err);
      res.status(500).json({ configured: true, error: err.message, workflows: [] });
    }
  });

  return router;
}
