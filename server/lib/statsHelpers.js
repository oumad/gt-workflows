/**
 * Map Bull job to activity job shape (id, name, user, server, processedOn, finishedOn, timestamp).
 */
export function toActivityJob(job) {
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
  return {
    id: String(job.id),
    name: typeof wfName === 'string' ? wfName : (job.name || ''),
    user: String(user || '—'),
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
