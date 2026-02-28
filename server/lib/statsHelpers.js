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
  let user = '';
  if (userObj) {
    user = userObj.name || userObj.email || userObj.id || '';
  }
  const userStr = String(user || '—');
  return {
    id: String(job.id),
    name: typeof wfName === 'string' ? wfName : (job.name || ''),
    user: anonymiseUser ? anonymiseUserName(userStr) : userStr,
    server: server || '—',
    processedOn,
    finishedOn,
    timestamp,
  };
}

export function jobMatchesUser(job, userFilter) {
  if (!userFilter) return true;
  const user = job?.data?.executionContext?.context?.user;
  if (!user) return false;
  const label = user.name || user.email || user.id;
  return label && String(label) === String(userFilter);
}
