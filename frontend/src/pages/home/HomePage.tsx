import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useServers } from '../../hooks/useServers'
import { PageHead } from '../../components/shell/PageHead'
import { api } from '../../lib/api'
import { fmtRelativeTime } from '../../lib/format'
import { Kpi } from '../../components/ui/Kpi'
import { Workflow, Briefcase, Boxes, Server, ArrowRight, Zap, Cpu, BarChart2 } from 'lucide-react'
import { isHostRecord } from '../../lib/serverLinks'
import { useData } from '../../context/DataContext'
import type { Page } from '../../types'
import { JobModal, unifiedToRow, type UnifiedJob, type UnifiedJobsPage, type Row } from '../jobs/shared'
import type { UnifiedLiveResponse } from '../jobs/jobs-types'

interface JobsStats {
  wf: { total: number; active: number; waiting: number; completed: number; failed: number }
  lora: { total: number; running: number; pending: number; completed: number; failed: number }
  running: number
  waiting: number
}

type Tile = {
  id: Page
  icon: React.ReactNode
  bg: string
  name: string
  desc: string
  count: string
}

/** Workflow / LoRA split sub-label — shared spelling with Live Feed so users
 *  see the same labels (no W/L jargon) wherever job counts appear. */
function WL({ w, l }: { w: number; l: number }) {
  return (
    <span
      style={{ display: 'inline-flex', gap: 8, fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}
    >
      <span style={{ color: 'var(--pop-purple)' }} title="ComfyUI workflow jobs">
        {w} Workflow
      </span>
      <span>·</span>
      <span style={{ color: 'var(--pop-pink)' }} title="LoRA training jobs">
        {l} LoRA
      </span>
    </span>
  )
}

export function HomePage({ navigate }: { navigate: (p: Page) => void }) {
  const { user } = useAuth()
  const { workflows, loading: wl } = useWorkflows()
  const { servers, loading: sl } = useServers()
  const { firstSyncDone } = useData()

  // Live job counts
  const [runWf, setRunWf] = useState(0)
  const [runLo, setRunLo] = useState(0)
  const [queWf, setQueWf] = useState(0)
  const [queLo, setQueLo] = useState(0)
  const [activeUsers, setActiveUsers] = useState<number | null>(null)
  const [jobsLoaded, setJobsLoaded] = useState(false)

  // Activity feed stores the raw unified jobs so each row can be opened in the
  // shared JobModal — display fields are derived in render.
  const [activity, setActivity] = useState<UnifiedJob[]>([])
  const [openJob, setOpenJob] = useState<Row | null>(null)

  const STATUS_COLOR: Record<string, string> = {
    completed: 'var(--good)',
    failed: 'var(--bad)',
    active: 'var(--accent)',
    running: 'var(--accent)',
    waiting: 'var(--info)',
    pending: 'var(--info)',
  }

  useEffect(() => {
    // Counts come from the unified /jobs/stats endpoint (one call instead of
    // four). Active-user count still needs the actual rows — we pull a slice
    // of currently-in-flight jobs for that.
    Promise.all([
      api.get<JobsStats>('/api/jobs/stats').catch(() => null),
      api
        .get<UnifiedLiveResponse>('/api/jobs/live')
        .catch(() => ({ running: [], waiting: [], ts: 0 })),
    ]).then(([stats, live]) => {
      if (stats) {
        setRunWf(stats.wf.active)
        setQueWf(stats.wf.waiting)
        setRunLo(stats.lora.running)
        setQueLo(stats.lora.pending)
      }
      setJobsLoaded(true)

      // Unique active users: anyone with a running or queued job right now
      const userSet = new Set<string>()
      for (const j of [...live.running, ...live.waiting]) {
        if (j.userName) userSet.add(j.userName)
      }
      setActiveUsers(userSet.size)
    })

    // Recent activity feed — single unified call, latest 10 across both types.
    // Items are stored as raw UnifiedJob so each row can be opened in the
    // shared JobModal on click; display fields are computed in render.
    api
      .get<UnifiedJobsPage>('/api/jobs?limit=10')
      .then((res) => setActivity(res.items ?? []))
      .catch(() => {})
    // Re-fetch once the initial Redis->Postgres sync finishes so first-ever
    // boot fills in jobs/counts without a manual refresh.
  }, [firstSyncDone])

  const running = runWf + runLo
  const waiting = queWf + queLo

  const firstName = user?.username ?? 'there'
  // Hosts (port-less) and services (ported) counted separately so the two
  // KPIs/tiles don't show the same combined number.
  const hostList = servers.filter(isHostRecord)
  const serviceList = servers.filter((s) => !isHostRecord(s))
  const serversOnline = hostList.filter((s) => s.health?.status === 'online').length
  const serversDown = hostList.filter((s) => s.health?.status === 'offline').length
  const servicesOnline = serviceList.filter((s) => s.health?.status === 'online').length
  const servicesDown = serviceList.filter((s) => s.health?.status === 'offline').length
  const servicesUnknown = serviceList.length - servicesOnline - servicesDown
  // "N nodes online" in the welcome line means physical hosts.
  const onlineCount = serversOnline
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const tiles: Tile[] = [
    {
      id: 'workflows',
      bg: 'var(--accent)',
      icon: <Workflow size={20} />,
      name: 'Workflows',
      desc: 'Browse and run ComfyUI pipelines across the cluster.',
      count: wl ? '…' : `${workflows.length} workflows`,
    },
    {
      id: 'jobs',
      bg: 'var(--pop-purple)',
      icon: <Briefcase size={20} />,
      name: 'Jobs',
      desc: 'Monitor running and waiting jobs in real time.',
      count: !jobsLoaded ? '…' : `${running} running · ${waiting} waiting`,
    },
    {
      id: 'services',
      bg: 'var(--pop-cyan)',
      icon: <Boxes size={20} />,
      name: 'Services',
      desc: 'Logical services running on servers (ComfyUI, LoRA…).',
      count: sl
        ? '…'
        : serviceList.length === 0
          ? 'No services'
          : `${servicesOnline} / ${serviceList.length} online`,
    },
    {
      id: 'servers',
      bg: 'var(--info)',
      icon: <Server size={20} />,
      name: 'Servers',
      desc: 'Physical hosts in the cluster.',
      count: sl
        ? '…'
        : hostList.length === 0
          ? 'No servers'
          : `${serversOnline} / ${hostList.length} online`,
    },
    {
      id: 'doctor',
      bg: 'var(--pop-pink)',
      icon: <Cpu size={20} />,
      name: 'Doctor',
      desc: 'Diagnose failures and slow jobs across the cluster.',
      count: 'Analyse failures',
    },
    {
      id: 'analytics',
      bg: 'var(--pop-pink)',
      icon: <BarChart2 size={20} />,
      name: 'Analytics',
      desc: 'Numbers, time-series and breakdowns across the cluster.',
      count: 'Last 14 days',
    },
  ]

  return (
    <>
      <PageHead title="Dashboard" sub="Overview of your GT Coffee Maker cluster" />
      <div className="body">
        {/* Welcome banner */}
        <div className="welcome">
          <div>
            <h1>
              {greeting}, {firstName}
            </h1>
            <p>
              Your cluster is running · {sl ? '…' : onlineCount} nodes online ·{' '}
              {wl ? '…' : workflows.length} workflows ready.
            </p>
          </div>
          <div className="welcome-meta">
            <span>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span style={{ opacity: 0.6 }}>
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div
          className="grid-4"
          style={{ marginBottom: 24, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
        >
          <Kpi label="Workflows" value={wl ? '…' : workflows.length} />

          <Kpi
            label="Running jobs"
            value={!jobsLoaded ? '…' : running}
            valueColor="var(--accent)"
            sub={
              jobsLoaded ? (
                <>
                  <WL w={runWf} l={runLo} />
                  {waiting > 0 && (
                    <span className="chip" style={{ marginTop: 6, display: 'inline-block' }}>
                      {waiting} waiting
                    </span>
                  )}
                </>
              ) : undefined
            }
          />

          <Kpi
            label="Servers online"
            valueColor={
              sl
                ? 'var(--ink-2)'
                : serversOnline === 0
                  ? 'var(--bad)'
                  : serversOnline < hostList.length
                    ? 'var(--warn)'
                    : 'var(--good)'
            }
            value={
              <>
                {sl ? '…' : serversOnline}
                <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>
                  {' '}
                  / {hostList.length}
                </span>
              </>
            }
            sub={
              !sl &&
              (serversDown > 0 || (hostList.length > 0 && serversOnline === hostList.length)) ? (
                <>
                  {serversDown > 0 && (
                    <span className="chip chip-warn" style={{ marginTop: 6 }}>
                      {serversDown} down
                    </span>
                  )}
                  {hostList.length > 0 && serversOnline === hostList.length && (
                    <span className="chip chip-good" style={{ marginTop: 6 }}>
                      All up
                    </span>
                  )}
                </>
              ) : undefined
            }
          />

          <Kpi
            label="Services online"
            valueColor={
              sl
                ? 'var(--ink-2)'
                : servicesOnline === 0
                  ? 'var(--bad)'
                  : servicesOnline < serviceList.length
                    ? 'var(--warn)'
                    : 'var(--good)'
            }
            value={
              <>
                {sl ? '…' : servicesOnline}
                <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>
                  {' '}
                  / {serviceList.length}
                </span>
              </>
            }
            sub={
              !sl &&
              (servicesDown > 0 ||
                servicesUnknown > 0 ||
                (serviceList.length > 0 && servicesOnline === serviceList.length)) ? (
                <>
                  {servicesDown > 0 && (
                    <span className="chip chip-warn" style={{ marginTop: 6 }}>
                      {servicesDown} down
                    </span>
                  )}
                  {servicesUnknown > 0 && (
                    <span
                      className="chip"
                      style={{ marginTop: 6, marginLeft: servicesDown > 0 ? 6 : 0 }}
                    >
                      {servicesUnknown} unknown
                    </span>
                  )}
                </>
              ) : undefined
            }
          />

          <Kpi
            label="Active users"
            value={activeUsers == null ? '…' : activeUsers}
            valueColor={(activeUsers ?? 0) > 0 ? 'var(--info)' : 'var(--ink-2)'}
            sub={
              activeUsers != null && activeUsers > 0 ? (
                <span className="chip" style={{ marginTop: 6 }}>
                  with jobs running
                </span>
              ) : undefined
            }
          />
        </div>

        {/* Brew tiles */}
        <div className="kicker" style={{ marginBottom: 12 }}>
          Brews
        </div>
        <div className="grid-3" style={{ marginBottom: 28 }}>
          {tiles.map((t) => (
            <div
              key={t.id}
              className="tile"
              onClick={() => navigate(t.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="tile-icon" style={{ background: t.bg }}>
                {t.icon}
              </div>
              <div className="tile-name">{t.name}</div>
              <div className="tile-desc">{t.desc}</div>
              <div className="tile-meta">
                <span>{t.count}</span>
                <ArrowRight size={14} />
              </div>
            </div>
          ))}
        </div>

        {/* Activity */}
        {openJob && <JobModal row={openJob} onClose={() => setOpenJob(null)} />}
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <Zap size={14} /> Recent activity
            </div>
            <span className="chip">live</span>
          </div>
          <div className="card-pad">
            {activity.length === 0 && (
              <div
                style={{
                  color: 'var(--ink-3)',
                  fontSize: 13,
                  textAlign: 'center',
                  padding: '12px 0',
                }}
              >
                Loading activity…
              </div>
            )}
            {activity.map((j) => {
              const color = STATUS_COLOR[j.status] ?? 'var(--ink-3)'
              const msg =
                j.type === 'wf'
                  ? `${j.name || 'Workflow job'} ${j.status}`
                  : `LoRA training ${j.name ?? ''} ${j.status}`
              const who = j.userName ?? 'unknown'
              const when = j.finishedAt ?? j.createdAt
              return (
                <div
                  key={`${j.type}-${j.id}`}
                  className="feed-item"
                  onClick={() => setOpenJob(unifiedToRow(j, Date.now()))}
                  style={{ cursor: 'pointer' }}
                  title="Open job details"
                >
                  <div className="feed-bullet" style={{ background: color }} />
                  <div>
                    <div style={{ fontSize: 13 }}>{msg}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{who}</div>
                  </div>
                  <div className="feed-time" title={new Date(when).toLocaleString()}>
                    {fmtRelativeTime(when)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
