/**
 * Plain-English descriptions for each Seto hint code. The codes use a domain
 * prefix (us_/si_/sv_/jo_) so they're scannable in logs and Discord reports;
 * the descriptions here are what the UI actually shows the user when they
 * hover the bare code.
 *
 * Keep this in sync with the backend's services/seto.ts rule registry — if a
 * new finding is added there, add the matching entry here so the modal isn't
 * left with a tooltip-less code chip.
 */

export type SetoCodeInfo = {
  /** Short, scannable label rendered next to the code. */
  label: string
  /** One-sentence explanation shown in a tooltip and in the threshold help. */
  description: string
  /** Which configurable threshold (in seto_config) triggers this code, when
   *  applicable. Useful for jumping from a finding to its setting. */
  threshold?: string
}

export const SETO_CODE_INFO: Record<string, SetoCodeInfo> = {
  us_many_jobs: {
    label: 'User has many in-flight jobs',
    description:
      'Warns when one user has at least the configured number of running or waiting jobs — flags potential monopolisation of cluster capacity.',
    threshold: 'maxUserJobs',
  },
  si_many_jobs: {
    label: 'Service is saturated',
    description:
      'Warns when a single service has at least the configured number of running or waiting jobs — that service is likely the bottleneck.',
    threshold: 'maxServiceJobs',
  },
  sv_many_jobs: {
    label: 'Server is saturated',
    description:
      'Warns when all services on a server collectively have at least the configured number of running or waiting jobs.',
    threshold: 'maxServerJobs',
  },
  jo_slow: {
    label: 'Job waited too long',
    description:
      'Warns when a job waited longer than the configured threshold before starting — usually a sign of cluster contention.',
    threshold: 'maxWaitTimeSec',
  },
  jo_aborted: {
    label: 'Job was cancelled',
    description:
      'The job was aborted by the user (or by a signal). Not a failure of the workflow itself.',
  },
  si_many_wf: {
    label: 'Service hosts many workflows',
    description:
      'Warns when more than the configured number of distinct workflows run on a single service — harder to isolate when one of them misbehaves.',
    threshold: 'maxLinkedWf',
  },
  sv_slow_net: {
    label: 'Server has slow ping',
    description:
      "Warns when the server's last ping latency exceeds the configured threshold — the cluster is likely sluggish from that host.",
    threshold: 'maxServerLatencyMs',
  },
  sv_many_services: {
    label: 'Server hosts many services',
    description:
      'Warns when more than the configured number of services run on a single host — concentrates blast radius if the host fails.',
    threshold: 'maxServerServices',
  },
  si_crowded: {
    label: 'Service is busy or crowded',
    description:
      'Active jobs are above 70% (info) or 90% (warning) of the service\'s maxConcurrent cap — incoming jobs may queue. Lift maxConcurrent or scale out to relieve.',
  },
  sv_crowded: {
    label: 'Host is busy or crowded',
    description:
      'Active jobs across all services on this host are above 70% / 90% of the combined maxConcurrent caps. Spread workloads or scale the host.',
  },
  err_info: {
    label: 'Error explanation',
    description: 'Generic mitigation advice for this error code.',
  },
  err_unknown: {
    label: 'Unclassified error',
    description: 'No classifier rule matches this code yet — look at recent samples for clues.',
  },
  err_occurrence: {
    label: 'Recent error occurrences',
    description: '24h / 7d / 90d counts for jobs failing with this error code.',
  },
  err_workflows: {
    label: 'Workflows hit by this error',
    description: 'Top 3 workflows where this error happened in the last 7 days.',
  },
  err_services: {
    label: 'Services hit by this error',
    description: 'Top 3 services where this error happened in the last 7 days.',
  },
  err_samples: {
    label: 'Recent error messages',
    description: 'A handful of distinct recent reason strings — useful for spotting variants.',
  },
  wf_quiet: {
    label: 'Workflow has no recent runs',
    description: 'Workflow hasn\'t been executed in the last 7 days.',
  },
  wf_recent: {
    label: 'Workflow recent activity (7d)',
    description: 'Run count, failure rate, and average duration in the last 7 days.',
  },
  wf_recent_24h: {
    label: 'Workflow recent activity (24h)',
    description: 'Run count and failure rate over the last 24 hours.',
  },
  wf_top_error: {
    label: 'Workflow top error code',
    description: 'Most common failure mode in the last 7 days.',
  },
  wf_no_servers: {
    label: 'Workflow has no servers configured',
    description: 'Runs will fall back to whichever server the launcher picks.',
  },
  wf_unknown_server: {
    label: 'Workflow references missing servers',
    description: 'Workflow lists servers that no longer exist in the Servers table.',
  },
  wf_server_down: {
    label: 'Configured server is down',
    description: 'At least one of the workflow\'s servers is unreachable right now.',
  },
  wf_server_maint: {
    label: 'Configured server in maintenance',
    description: 'At least one of the workflow\'s servers has been put into maintenance.',
  },
  wf_slower: {
    label: 'Workflow running slower than usual',
    description: 'Recent 7-day average duration is significantly higher than the 90-day baseline.',
  },
}

/** Best-effort lookup. Unknown codes fall back to the raw string so the UI
 *  still renders something useful for codes a forgotten frontend hasn't been
 *  updated for yet. */
export function setoCodeInfo(code: string): SetoCodeInfo {
  return (
    SETO_CODE_INFO[code] ?? {
      label: code,
      description: 'No description available yet for this code.',
    }
  )
}
