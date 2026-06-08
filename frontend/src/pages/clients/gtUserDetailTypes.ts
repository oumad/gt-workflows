export type GtUser = {
  id: string
  externalId: string
  email: string | null
  name: string | null
  firstSeenAt: string
  lastSeenAt: string | null
}

export type UserStats = {
  wfJobs: number
  loraJobs: number
  totalJobs: number
  distinctWorkflows: number
  distinctModels: number
  avgPerDay: number
  totalRank: number | null
  totalUsers: number
  wfRank: number | null
  wfUsers: number
  loraRank: number | null
  loraUsers: number
}

export type ActivityRow = { date: string; wf: number; lora: number; total: number }

export type WfRow = {
  workflowId?: string | null
  workflowName: string
  userJobs: number
  totalJobs: number
  totalUsers: number
  rank: number | null
}

export type LoraRow = {
  baseModel: string
  userJobs: number
  totalJobs: number
  totalUsers: number
  rank: number | null
}

export type ServerRow = {
  serverId: string | null
  serverName: string
  serverType: string | null
  userDurationMs: number | null
  totalDurationMs: number | null
  userJobs: number
  totalJobs: number
  totalUsers: number
  rank: number | null
}

export type RecentJob = {
  id: string
  type: 'wf' | 'lora'
  name: string
  serverName: string | null
  serverId: string | null
  waitMs: number | null
  durationMs: number | null
  status: string
  createdAt: string
}
