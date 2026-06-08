import { useState, useEffect, Fragment } from 'react'
import { api } from '../../lib/api'
import { Search, Workflow as WorkflowIcon, ChevronRight } from 'lucide-react'
import { Kpi } from '../../components/ui/Kpi'
import { SortableHeader } from '../../components/ui/SortableHeader'
import { normServerUrl } from '../workflows/workflowsHelpers'
import type { Server as ServerType, Workflow } from '../../types'
import {
  type ServerInsight,
  type NavigateFn,
  STATUS_TONE,
  STATUS_LABEL,
  serverStatus,
  fmtDuration,
  fmtRelativeTime,
} from './serverHelpers'
import { isHostRecord, findServicesFor } from '../../lib/serverLinks'
import { rangeToDays, rangeLabel, type Range } from '../analytics/analyticsHelpers'

/* ════════════════════════════════════════════════════════════════
   Shared dashboard panels. Both `pages/services/` and `pages/servers/`
   render these — they're 92% identical and only differ in the noun
   ("service" vs "server") used in labels and one type chip in the
   Repartition expanded view. F10 dedup pass.
════════════════════════════════════════════════════════════════ */

export type KindLabel = 'service' | 'server'

function nouns(kind: KindLabel) {
  return kind === 'service'
    ? { Singular: 'Service', plural: 'services', Plural: 'Services' }
    : { Singular: 'Server', plural: 'servers', Plural: 'Servers' }
}

/* ═══════════════════════════════════════════════
   METRICS TAB
══════════════════════════════════════════════ */
export function ServersMetrics({
  servers,
  onOpen,
  kindLabel,
}: {
  servers: ServerType[]
  onOpen: (name: string) => void
  kindLabel: KindLabel
}) {
  const n = nouns(kindLabel)
  const rows = servers.map((s) => {
    const isDown = serverStatus(s) === 'down'
    const lat = isDown ? null : (s.health?.latencyMs ?? null)
    return {
      s,
      running: s.activeJobs ?? 0,
      waiting: s.waitingJobs ?? 0,
      lat,
      isDown,
    }
  })

  const onLine = rows.filter((r) => !r.isDown).length
  const runningSum = rows.reduce((a, r) => a + r.running, 0)
  const waitingSum = rows.reduce((a, r) => a + r.waiting, 0)
  const avgLat = (() => {
    const xs = rows.filter((r) => r.lat != null).map((r) => r.lat!)
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0
  })()

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi
          label="Online"
          valueColor="var(--good)"
          value={
            <>
              {onLine}
              <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}>
                {' '}
                / {rows.length}
              </span>
            </>
          }
        />
        <Kpi label="Running jobs" value={runningSum} valueColor="var(--accent)" />
        <Kpi label="Waiting jobs" value={waitingSum} valueColor="var(--pop-purple)" />
        <Kpi
          label="Avg latency"
          value={
            <>
              {avgLat}
              <span style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}> ms</span>
            </>
          }
        />
      </div>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>{n.Singular}</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 100, textAlign: 'right' }}>Running</th>
              <th style={{ width: 100, textAlign: 'right' }}>Waiting</th>
              <th style={{ width: 200 }}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, running, waiting, lat, isDown }) => {
              const st = serverStatus(s)
              const stChip = `chip-${STATUS_TONE[st]}`
              const stLbl = STATUS_LABEL[st]
              const latPct = lat != null ? Math.min(100, Math.round((lat / 80) * 100)) : null
              const latColor =
                lat == null
                  ? 'var(--ink-3)'
                  : lat > 60
                    ? 'var(--bad)'
                    : lat > 40
                      ? 'var(--warn)'
                      : 'var(--good)'
              return (
                <tr key={s.id} style={isDown ? { opacity: 0.55 } : undefined}>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 6px', height: 'auto', fontWeight: 600 }}
                      onClick={() => onOpen(s.id)}
                    >
                      {s.name}
                    </button>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                      {s.url}
                    </div>
                  </td>
                  <td>
                    <span className={`chip ${stChip}`}>
                      <span className="dot" /> {stLbl}
                    </span>
                  </td>
                  <td
                    className="mono"
                    style={{
                      textAlign: 'right',
                      color: running > 0 ? 'var(--accent)' : 'var(--ink-3)',
                    }}
                  >
                    {running}
                  </td>
                  <td
                    className="mono"
                    style={{
                      textAlign: 'right',
                      color: waiting > 0 ? 'var(--pop-purple)' : 'var(--ink-3)',
                    }}
                  >
                    {waiting}
                  </td>
                  <td>
                    {lat == null ? (
                      <span style={{ color: 'var(--ink-3)' }}>offline</span>
                    ) : (
                      <div className="row" style={{ gap: 8 }}>
                        <div className="bar" style={{ flex: 1, maxWidth: 100 }}>
                          <i style={{ width: `${latPct}%`, background: latColor }} />
                        </div>
                        <span
                          className="mono"
                          style={{ fontSize: 11, color: latColor, fontWeight: 600 }}
                        >
                          {lat} ms
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════
   INSIGHTS TAB
══════════════════════════════════════════════ */
export function ServersInsights({
  servers,
  onOpen,
  kindLabel,
  range,
}: {
  servers: ServerType[]
  onOpen: (name: string) => void
  kindLabel: KindLabel
  range: Range
}) {
  const n = nouns(kindLabel)
  const [sort, setSort] = useState<'jobs' | 'avg' | 'fail'>('jobs')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [data, setData] = useState<ServerInsight[] | null>(null)
  const [loading, setLoading] = useState(true)

  const days = rangeToDays(range)

  useEffect(() => {
    setLoading(true)
    api
      .get<ServerInsight[]>(`/api/servers/insights?days=${days}`)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [days])

  const byServerId = new Map((data ?? []).map((d) => [d.serverId, d]))
  const rows = servers
    .map((s) => {
      const ins = byServerId.get(s.id)
      return ins ? { s, ...ins } : null
    })
    .filter((r): r is { s: ServerType } & ServerInsight => r !== null)

  rows.sort((a, b) => {
    const av = sort === 'jobs' ? a.totalJobs : sort === 'avg' ? a.avgSec : a.failPct
    const bv = sort === 'jobs' ? b.totalJobs : sort === 'avg' ? b.avgSec : b.failPct
    return dir === 'desc' ? bv - av : av - bv
  })

  const totals = rows.reduce(
    (a, r) => ({
      jobs: a.jobs + r.totalJobs,
      sumAvg: a.sumAvg + r.avgSec,
      sumFail: a.sumFail + r.failPct,
    }),
    { jobs: 0, sumAvg: 0, sumFail: 0 },
  )
  const maxJobs = Math.max(1, ...rows.map((r) => r.totalJobs))
  const maxFail = Math.max(0.001, ...rows.map((r) => r.failPct))

  const handleSort = (id: 'jobs' | 'avg' | 'fail') => {
    if (sort === id) setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setSort(id)
      setDir('desc')
    }
  }

  if (loading) {
    return (
      <div
        className="card card-pad"
        style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 40 }}
      >
        Loading insights…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div
        className="card card-pad"
        style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 40 }}
      >
        No job activity in the last {rangeLabel(range)}.
      </div>
    )
  }

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label={n.Plural} value={rows.length} />
        <Kpi label={`Total jobs · ${rangeLabel(range)}`} value={totals.jobs.toLocaleString()} />
        <Kpi
          label="Avg job time"
          value={fmtDuration(Math.round(totals.sumAvg / Math.max(1, rows.length)))}
        />
        <Kpi
          label="Avg fail rate"
          valueColor="var(--bad)"
          value={
            <>
              {(totals.sumFail / Math.max(1, rows.length)).toFixed(1)}
              <span style={{ fontSize: 14 }}>%</span>
            </>
          }
        />
      </div>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>{n.Singular}</th>
              <SortableHeader
                col="jobs"
                label={`Total jobs · ${rangeLabel(range)}`}
                cur={sort}
                dir={dir}
                onSort={handleSort}
                num
              />
              <SortableHeader
                col="avg"
                label="Avg job time"
                cur={sort}
                dir={dir}
                onSort={handleSort}
                num
              />
              <SortableHeader
                col="fail"
                label="Fail %"
                cur={sort}
                dir={dir}
                onSort={handleSort}
                num
              />
              <th style={{ width: 140 }}>Reliability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, totalJobs, avgSec, failPct, successPct }) => {
              const jobsPct = Math.round((totalJobs / maxJobs) * 100)
              const failBarPct = Math.round((failPct / maxFail) * 100)
              const failColor =
                failPct > 10 ? 'var(--bad)' : failPct > 5 ? 'var(--warn)' : 'var(--good)'
              return (
                <tr key={s.id}>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 6px', height: 'auto', fontWeight: 600 }}
                      onClick={() => onOpen(s.id)}
                    >
                      {s.name}
                    </button>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      <div className="bar" style={{ flex: 1, maxWidth: 80 }}>
                        <i style={{ width: `${jobsPct}%`, background: 'var(--accent)' }} />
                      </div>
                      <span
                        className="mono"
                        style={{ fontSize: 12, fontWeight: 600, width: 56, textAlign: 'right' }}
                      >
                        {totalJobs.toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontSize: 12 }}>
                    {fmtDuration(avgSec)}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      <div className="bar" style={{ flex: 1, maxWidth: 80 }}>
                        <i style={{ width: `${failBarPct}%`, background: failColor }} />
                      </div>
                      <span
                        className="mono"
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: failColor,
                          width: 48,
                          textAlign: 'right',
                        }}
                      >
                        {failPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <div
                        style={{
                          flex: 1,
                          height: 8,
                          borderRadius: 4,
                          background: 'color-mix(in oklab, var(--bad) 14%, transparent)',
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: `${successPct}%`,
                            background:
                              'linear-gradient(90deg, var(--good), color-mix(in oklab, var(--good) 70%, var(--accent)))',
                          }}
                        />
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                        {successPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════
   INCIDENTS TAB
══════════════════════════════════════════════ */
type IncidentServer = {
  serverId: string | null
  serverName: string
  incidents: number
  recoveries: number
  totalDowntimeMs: number
  mttrMs: number | null
  lastAlertAt: string | null
}
type IncidentRow = {
  id: string
  kind: string
  severity: string
  title: string
  body: string | null
  serverId: string | null
  serverName: string | null
  downtimeMs: number | null
  createdAt: string
}
type IncidentsResponse = {
  rangeDays: number | null
  servers: IncidentServer[]
  recent: IncidentRow[]
}

const INCIDENT_RANGES = [
  { id: '7' as const, label: '7d' },
  { id: '30' as const, label: '30d' },
  { id: '90' as const, label: '90d' },
  { id: 'all' as const, label: 'All' },
]

const fmtMs = (ms: number | null) => fmtDuration(ms == null ? null : Math.round(ms / 1000))

function IncidentLine({
  a,
  idx,
  onOpen,
}: {
  a: IncidentRow
  idx: number
  onOpen: (id: string) => void
}) {
  const color =
    a.severity === 'critical'
      ? 'var(--bad)'
      : a.severity === 'warning'
        ? 'var(--warn)'
        : 'var(--good)'
  const clickable = !!a.serverId
  return (
    <div
      className="row"
      style={{
        padding: '9px 16px',
        gap: 10,
        alignItems: 'flex-start',
        borderTop: idx === 0 ? 0 : '1px solid var(--line)',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={() => {
        if (a.serverId) onOpen(a.serverId)
      }}
    >
      <span className="dot" style={{ background: color, flexShrink: 0, marginTop: 5 }} />
      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{a.title}</span>
        {a.body && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{a.body}</span>}
      </div>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {fmtRelativeTime(a.createdAt)}
      </span>
    </div>
  )
}

export function ServersIncidents({
  servers,
  onOpen,
  kindLabel,
}: {
  servers: ServerType[]
  onOpen: (id: string) => void
  kindLabel: KindLabel
}) {
  const n = nouns(kindLabel)
  const [range, setRange] = useState<'7' | '30' | '90' | 'all'>('all')
  const [data, setData] = useState<IncidentsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const qs = range === 'all' ? '' : `?days=${range}`
    api
      .get<IncidentsResponse>(`/api/servers/incidents${qs}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [range])

  const rows = data?.servers ?? []
  const recent = data?.recent ?? []

  const totalIncidents = rows.reduce((a, r) => a + r.incidents, 0)
  const totalRecoveries = rows.reduce((a, r) => a + r.recoveries, 0)
  const totalDowntimeMs = rows.reduce((a, r) => a + r.totalDowntimeMs, 0)
  const avgMttrMs = totalRecoveries > 0 ? totalDowntimeMs / totalRecoveries : null
  const currentlyDown = servers.filter((s) => serverStatus(s) === 'down').length

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="spacer" />
        <div className="toggle-group">
          {INCIDENT_RANGES.map((o) => (
            <button
              key={o.id}
              className={range === o.id ? 'active' : ''}
              onClick={() => setRange(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Incidents" value={totalIncidents} />
        <Kpi label="Avg MTTR" value={fmtMs(avgMttrMs)} />
        <Kpi label="Total downtime" value={fmtMs(totalDowntimeMs || null)} />
        <Kpi
          label="Currently down"
          value={currentlyDown}
          valueColor={currentlyDown > 0 ? 'var(--bad)' : 'var(--good)'}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">By {kindLabel}</div>
        </div>
        {loading && rows.length === 0 ? (
          <div
            className="card-pad"
            style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 32 }}
          >
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div
            className="card-pad"
            style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 32 }}
          >
            No incidents recorded in this range.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{n.Singular}</th>
                <th style={{ width: 100, textAlign: 'right' }}>Incidents</th>
                <th style={{ width: 120, textAlign: 'right' }}>Avg MTTR</th>
                <th style={{ width: 140, textAlign: 'right' }}>Total downtime</th>
                <th style={{ width: 160 }}>Last incident</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.serverId ?? r.serverName}>
                  <td>
                    {r.serverId ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px', height: 'auto', fontWeight: 600 }}
                        onClick={() => onOpen(r.serverId!)}
                      >
                        {r.serverName}
                      </button>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{r.serverName}</span>
                    )}
                  </td>
                  <td
                    className="mono"
                    style={{
                      textAlign: 'right',
                      color: r.incidents > 0 ? 'var(--bad)' : 'var(--ink-3)',
                    }}
                  >
                    {r.incidents}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {fmtMs(r.mttrMs)}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {fmtMs(r.totalDowntimeMs || null)}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {r.lastAlertAt ? fmtRelativeTime(r.lastAlertAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Recent incidents</div>
          <span className="chip">{recent.length}</span>
        </div>
        {loading && recent.length === 0 ? (
          <div
            className="card-pad"
            style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 32 }}
          >
            Loading…
          </div>
        ) : recent.length === 0 ? (
          <div
            className="card-pad"
            style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 32 }}
          >
            No incidents recorded in this range.
          </div>
        ) : (
          <div>
            {recent.map((a, i) => (
              <IncidentLine key={a.id} a={a} idx={i} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════
   REPARTITION TAB
══════════════════════════════════════════════ */
type RepSortKey = 'name' | 'workflows' | 'users' | 'runs' | 'avg' | 'wait'

type RepWorkflow = {
  workflowId: string | null
  workflowName: string
  jobs: number
  users: number
  avgSec: number
}
type RepServer = {
  serverId: string
  totalJobs: number
  distinctUsers: number
  avgSec: number
  avgWaitSec: number
  workflows: RepWorkflow[]
}

export function ServersRepartition({
  servers,
  workflows,
  onOpen,
  navigate,
  kindLabel,
  range,
}: {
  servers: ServerType[]
  workflows: Workflow[]
  onOpen: (id: string) => void
  navigate?: NavigateFn
  kindLabel: KindLabel
  range: Range
}) {
  const n = nouns(kindLabel)
  // Only the services view exposes the per-row WF/LoRA chip — physical
  // servers don't have a 1:1 type concept.
  const showTypeChip = kindLabel === 'service'
  const [rep, setRep] = useState<Map<string, RepServer>>(new Map())
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<RepSortKey>('workflows')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState<string | null>(null)

  const days = rangeToDays(range)

  useEffect(() => {
    api
      .get<{ servers: RepServer[] }>(`/api/servers/repartition?days=${days}`)
      .then((d) => setRep(new Map(d.servers.map((r) => [r.serverId, r]))))
      .catch(() => {})
  }, [days])

  // Jobs link by server_id to SERVICE rows (with port). Host rows (port-less)
  // have no jobs pointing at them directly — they group services by hostname.
  // Aggregating "this host's load" therefore means summing across every
  // service that shares its hostname. The repartition response is keyed by
  // service id, so for a host row we collect its sibling services first,
  // then fold their entries together; for a service row we use the direct
  // lookup as before.
  const aggregateForRow = (
    s: ServerType,
  ): {
    totalJobs: number
    distinctUsers: number
    avgSec: number
    avgWaitSec: number
    workflows: RepWorkflow[]
  } => {
    // Resolve which rep entries belong to this row.
    const ownEntry = rep.get(s.id)
    const siblingEntries = isHostRecord(s)
      ? findServicesFor(s, servers)
          .map((svc) => rep.get(svc.id))
          .filter((x): x is RepServer => !!x)
      : []
    const entries = ownEntry ? [ownEntry, ...siblingEntries] : siblingEntries
    if (entries.length === 0) {
      return { totalJobs: 0, distinctUsers: 0, avgSec: 0, avgWaitSec: 0, workflows: [] }
    }
    if (entries.length === 1) {
      const e = entries[0]
      return {
        totalJobs: e.totalJobs,
        distinctUsers: e.distinctUsers,
        avgSec: e.avgSec,
        avgWaitSec: e.avgWaitSec,
        workflows: e.workflows,
      }
    }

    // Multi-service host: sum totals; weight averages by job count so a
    // 1000-job heavy service doesn't get out-voted by a 5-job light one.
    // distinctUsers sums naïvely — the API exposes only the count, not the
    // user set, so a user active on two services here counts twice. Flagged
    // in the UI badge so operators don't misread it as a hard distinct.
    let totalJobs = 0
    let distinctUsers = 0
    let durWeighted = 0
    let waitWeighted = 0
    const wfByKey = new Map<string, RepWorkflow>()
    for (const e of entries) {
      totalJobs += e.totalJobs
      distinctUsers += e.distinctUsers
      durWeighted += e.avgSec * e.totalJobs
      waitWeighted += e.avgWaitSec * e.totalJobs
      for (const w of e.workflows) {
        const key = w.workflowId ?? w.workflowName.toLowerCase()
        const existing = wfByKey.get(key)
        if (!existing) {
          wfByKey.set(key, { ...w })
        } else {
          const next = {
            workflowId: existing.workflowId ?? w.workflowId,
            workflowName: existing.workflowName,
            jobs: existing.jobs + w.jobs,
            users: existing.users + w.users,
            avgSec:
              existing.jobs + w.jobs > 0
                ? Math.round(
                    (existing.avgSec * existing.jobs + w.avgSec * w.jobs) /
                      (existing.jobs + w.jobs),
                  )
                : 0,
          }
          wfByKey.set(key, next)
        }
      }
    }
    return {
      totalJobs,
      distinctUsers,
      avgSec: totalJobs > 0 ? Math.round(durWeighted / totalJobs) : 0,
      avgWaitSec: totalJobs > 0 ? Math.round(waitWeighted / totalJobs) : 0,
      workflows: [...wfByKey.values()].sort((a, b) => b.jobs - a.jobs),
    }
  }

  const rows = servers.map((s) => {
    const wfs = workflows.filter((w) =>
      w.serverUrls.some((u) => normServerUrl(u) === normServerUrl(s.url)),
    )
    const agg = aggregateForRow(s)

    const ran = agg.workflows
    const assignedIds = new Set(wfs.map((w) => w.id))
    const assignedNames = new Set(wfs.map((w) => w.name.toLowerCase()))
    const perWorkflow = [
      ...wfs.map((w) => {
        const stat = ran.find(
          (x) => x.workflowId === w.id || x.workflowName.toLowerCase() === w.name.toLowerCase(),
        )
        return {
          key: w.id,
          workflowId: w.id as string | null,
          name: w.name,
          jobs: stat?.jobs ?? 0,
          users: stat?.users ?? 0,
          avgSec: stat?.avgSec ?? 0,
          assigned: true,
        }
      }),
      ...ran
        .filter(
          (x) =>
            !(x.workflowId && assignedIds.has(x.workflowId)) &&
            !assignedNames.has(x.workflowName.toLowerCase()),
        )
        .map((x) => ({
          key: x.workflowId ?? x.workflowName,
          workflowId: x.workflowId,
          name: x.workflowName,
          jobs: x.jobs,
          users: x.users,
          avgSec: x.avgSec,
          assigned: false,
        })),
    ].sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name))

    return {
      s,
      workflowCount: wfs.length,
      users: agg.distinctUsers,
      runs: agg.totalJobs,
      avgSec: agg.avgSec,
      avgWaitSec: agg.avgWaitSec,
      perWorkflow,
    }
  })

  const q = query.trim().toLowerCase()
  const filtered = q
    ? rows.filter((r) =>
        [r.s.name, r.s.gpu ?? '', ...r.s.tags].some((v) => v.toLowerCase().includes(q)),
      )
    : rows

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'name':
        cmp = a.s.name.localeCompare(b.s.name)
        break
      case 'workflows':
        cmp = a.workflowCount - b.workflowCount
        break
      case 'users':
        cmp = a.users - b.users
        break
      case 'runs':
        cmp = a.runs - b.runs
        break
      case 'avg':
        cmp = a.avgSec - b.avgSec
        break
      case 'wait':
        cmp = a.avgWaitSec - b.avgWaitSec
        break
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const onSort = (k: RepSortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir(k === 'name' ? 'asc' : 'desc')
    }
  }

  const maxWf = Math.max(1, ...rows.map((r) => r.workflowCount))
  const totalAssignments = rows.reduce((a, r) => a + r.workflowCount, 0)
  const avgWf = servers.length ? totalAssignments / servers.length : 0
  const busiest = rows.reduce<(typeof rows)[number] | null>(
    (best, r) => (!best || r.workflowCount > best.workflowCount ? r : best),
    null,
  )
  const idle = rows.filter((r) => r.workflowCount === 0).length

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label={n.Plural} value={servers.length} />
        <Kpi label={`Avg workflows / ${kindLabel}`} value={avgWf.toFixed(1)} />
        <Kpi
          label="Most workflows"
          value={busiest ? busiest.workflowCount : 0}
          sub={
            busiest && busiest.workflowCount > 0 ? (
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {busiest.s.name}
              </span>
            ) : undefined
          }
        />
        <Kpi
          label={`Idle ${n.plural}`}
          value={idle}
          valueColor={idle > 0 ? 'var(--warn)' : 'var(--good)'}
          sub="no workflows assigned"
        />
      </div>

      <div className="row" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
        <div className="search" style={{ minWidth: 240 }}>
          <span className="search-icon">
            <Search size={14} />
          </span>
          <input
            className="input"
            placeholder={`Search ${n.plural}, GPU, tags…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {sorted.length} {sorted.length === 1 ? kindLabel : n.plural}
        </span>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <SortableHeader
                col="name"
                label={n.Singular}
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <th>GPU</th>
              <SortableHeader
                col="workflows"
                label="Workflows"
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <SortableHeader
                col="users"
                label={`Users · ${rangeLabel(range)}`}
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <SortableHeader
                col="runs"
                label={`Runs · ${rangeLabel(range)}`}
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <SortableHeader
                col="avg"
                label="Avg time"
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <SortableHeader
                col="wait"
                label="Avg wait"
                cur={sortKey}
                dir={sortDir}
                onSort={onSort}
                num
              />
              <th style={{ width: 96 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const st = serverStatus(r.s)
              const exp = expanded === r.s.id
              return (
                <Fragment key={r.s.id}>
                  <tr
                    style={{ cursor: 'pointer' }}
                    onClick={() => setExpanded(exp ? null : r.s.id)}
                  >
                    <td style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                      <ChevronRight
                        size={13}
                        style={{
                          transform: exp ? 'rotate(90deg)' : 'none',
                          transition: 'transform .12s',
                          verticalAlign: 'middle',
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '2px 6px', height: 'auto', fontWeight: 600 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpen(r.s.id)
                        }}
                      >
                        {r.s.name}
                      </button>
                      {showTypeChip && (
                        <span className="chip" style={{ fontSize: 9, marginLeft: 4 }}>
                          {r.s.type === 'lora' ? 'LoRA' : 'WF'}
                        </span>
                      )}
                    </td>
                    <td
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: r.s.gpu ? 'var(--ink-2)' : 'var(--ink-3)',
                        maxWidth: 220,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={r.s.gpu ?? undefined}
                    >
                      {r.s.gpu ?? '—'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                        <div className="bar" style={{ flex: 1, maxWidth: 70 }}>
                          <i
                            style={{
                              width: `${(r.workflowCount / maxWf) * 100}%`,
                              background: 'var(--accent)',
                            }}
                          />
                        </div>
                        <span
                          className="mono"
                          style={{ fontWeight: 600, width: 24, textAlign: 'right' }}
                        >
                          {r.workflowCount}
                        </span>
                      </div>
                    </td>
                    <td
                      className="mono"
                      style={{
                        textAlign: 'right',
                        color: r.users > 0 ? 'var(--info)' : 'var(--ink-3)',
                      }}
                    >
                      {r.users > 0 ? r.users.toLocaleString() : '—'}
                    </td>
                    <td
                      className="mono"
                      style={{ textAlign: 'right', color: r.runs > 0 ? undefined : 'var(--ink-3)' }}
                    >
                      {r.runs > 0 ? r.runs.toLocaleString() : '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {r.avgSec > 0 ? fmtDuration(r.avgSec) : '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>
                      {r.avgWaitSec > 0 ? fmtDuration(r.avgWaitSec) : '—'}
                    </td>
                    <td>
                      <span className={`chip chip-${STATUS_TONE[st]}`}>
                        <span className="dot" /> {STATUS_LABEL[st]}
                      </span>
                    </td>
                  </tr>
                  {exp && (
                    <tr>
                      <td
                        colSpan={9}
                        style={{ background: 'var(--surface-2)', padding: '10px 16px' }}
                      >
                        {r.perWorkflow.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                            No workflows assigned to this {kindLabel}, and none ran here in the last{' '}
                            {rangeLabel(range)}.
                          </span>
                        ) : (
                          <div className="col" style={{ gap: 1 }}>
                            <div
                              className="row"
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '.05em',
                                color: 'var(--ink-3)',
                                padding: '0 6px 3px',
                              }}
                            >
                              <span style={{ flex: 1 }}>Workflow · {rangeLabel(range)}</span>
                              <span style={{ width: 70, textAlign: 'right' }}>Jobs</span>
                              <span style={{ width: 60, textAlign: 'right' }}>Users</span>
                              <span style={{ width: 80, textAlign: 'right' }}>Avg time</span>
                            </div>
                            {r.perWorkflow.map((w) => (
                              <div
                                key={w.key}
                                className="row"
                                style={{
                                  fontSize: 12,
                                  padding: '4px 6px',
                                  borderRadius: 6,
                                  gap: 8,
                                  cursor: w.workflowId && navigate ? 'pointer' : 'default',
                                }}
                                onClick={() => {
                                  if (w.workflowId)
                                    navigate?.('workflows', `/workflows/${w.workflowId}`)
                                }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.background = 'var(--surface)')
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.background = 'transparent')
                                }
                              >
                                <span className="row" style={{ flex: 1, gap: 5, minWidth: 0 }}>
                                  <WorkflowIcon
                                    size={10}
                                    style={{ color: 'var(--ink-3)', flexShrink: 0 }}
                                  />
                                  <span
                                    style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {w.name}
                                  </span>
                                  {!w.assigned && (
                                    <span
                                      style={{ fontSize: 9, color: 'var(--ink-3)', flexShrink: 0 }}
                                    >
                                      · not assigned
                                    </span>
                                  )}
                                </span>
                                <span
                                  className="mono"
                                  style={{
                                    width: 70,
                                    textAlign: 'right',
                                    fontWeight: 600,
                                    color: w.jobs > 0 ? undefined : 'var(--ink-3)',
                                  }}
                                >
                                  {w.jobs.toLocaleString()}
                                </span>
                                <span
                                  className="mono"
                                  style={{
                                    width: 60,
                                    textAlign: 'right',
                                    color: w.users > 0 ? 'var(--info)' : 'var(--ink-3)',
                                  }}
                                >
                                  {w.users}
                                </span>
                                <span
                                  className="mono"
                                  style={{ width: 80, textAlign: 'right', color: 'var(--ink-3)' }}
                                >
                                  {w.avgSec > 0 ? fmtDuration(w.avgSec) : '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 28 }}>
                  {query ? `No ${n.plural} match your search.` : `No ${n.plural} registered.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
