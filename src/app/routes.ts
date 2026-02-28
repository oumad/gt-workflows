/**
 * Route path constants. Use these instead of magic strings for navigation and route definitions.
 */

export const ROUTES = {
  jobStats: '/job-stats',
  jobStatsTimeView: '/job-stats/timeview',
  workflows: '/workflows',
  workflowsNew: '/workflows/new',
  workflow: (name: string): string => `/workflows/workflow/${encodeURIComponent(name)}`,
  activity: '/activity',
  settings: '/settings',
  login: '/login',
} as const
