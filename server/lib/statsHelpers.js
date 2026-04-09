/** Extract the best available timestamp from a Bull job. */
export function getJobTs(job) {
  return job?.finishedOn ?? job?.processedOn ?? job?.timestamp ?? null;
}

/** Generic in-memory stats cache factory. */
export function makeStatsCache(ttlMs = 90_000, maxSize = 30) {
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

/**
 * Fetch jobs in small batches, stopping early once a job's timestamp falls below cutoffMs.
 * Jobs are returned newest-first by Bull, so the first job older than cutoff means all
 * subsequent ones are also older — safe to abort.
 * @param {import('bull').Queue} queue
 * @param {string} type - 'failed' | 'completed'
 * @param {number} cutoffMs - stop when job timestamp < this (0 = no early exit)
 * @param {{ batchSize?: number, maxJobs?: number }} [opts]
 */
export async function getJobsBatched(queue, type, cutoffMs, { batchSize = 200, maxJobs = 5000 } = {}) {
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

export function shouldAnonymiseUsers(config, req) {
  return config.anonymiseJobStatsUsers && config.guestUser && req.authUsername === config.guestUser;
}

/**
 * Anonymise a user name for guest view: first letter + "**.**" + last letter (e.g. john.doe → j**.**e).
 * If string length <= 1, return as-is.
 */
export function anonymiseUserName(str) {
  if (str == null || typeof str !== 'string') return str;
  const s = str.trim();
  if (s.length <= 1) return s;
  return s[0] + '**.**' + s[s.length - 1];
}

/**
 * Map Bull job to activity job shape (id, name, user, server, processedOn, finishedOn, timestamp).
 * @param {object} job - Bull job
 * @param {boolean} [anonymiseUser] - when true, anonymise the user field (guest-only job-stats)
 */
export function toActivityJob(job, anonymiseUser = false) {
  if (!job) return null;
  const data = job.data || {};
  const workflow = data.workflow || {};
  const wfName = workflow.name;
  const serverUrl = workflow.config?.comfyui_config?.serverUrl;
  const server = typeof serverUrl === 'string' ? serverUrl.replace(/\/$/, '') : '';
  const userObj = data.executionContext?.context?.user;
  const processedOn = job.processedOn != null ? job.processedOn : undefined;
  const finishedOn = job.finishedOn != null ? job.finishedOn : undefined;
  const timestamp = job.timestamp != null ? job.timestamp : undefined;
  const timeout = workflow.config?.timeout ?? workflow.timeout ?? undefined;
  let user = '';
  if (userObj) {
    user = userObj.name || userObj.email || userObj.id || '';
  }
  const userStr = String(user || '—');
  const result = {
    id: String(job.id),
    name: typeof wfName === 'string' ? wfName : (job.name || ''),
    user: anonymiseUser ? anonymiseUserName(userStr) : userStr,
    server: server || '—',
    processedOn,
    finishedOn,
    timestamp,
    timeout: typeof timeout === 'number' ? timeout : undefined,
  };
  if (job.failedReason != null) result.failedReason = job.failedReason;
  return result;
}

export function jobMatchesUser(job, userFilter) {
  if (!userFilter) return true;
  const user = job?.data?.executionContext?.context?.user;
  if (!user) return false;
  const label = user.name || user.email || user.id;
  return label && String(label) === String(userFilter);
}
