import { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { History } from '../jobs/shared'
import type { Server as ServerType, Workflow, NavigateFn } from '../../types'
import {
  type ServerPatch,
  type ComfyStats,
  type GpuInfo,
  typeAccent,
  fmtDuration,
  fmtBytes,
  fmtMB,
  fmtRelativeTime,
} from './serverHelpers'
import { KVRow, ServerStatusBadge } from './ServerBadges'
import { Kpi } from '../../components/ui/Kpi'
import { findServicesFor, linkedGpu, portOf } from '../../lib/serverLinks'
import { ServerTopUsersWidget } from './ServerTopUsersWidget'

export type KindLabel = 'service' | 'server'

/** Job history scoped to this server/service.
 *  - Services lock the kind filter to the service's own type (a workflow
 *    service shows only WF jobs; a lora service shows only LoRA).
 *  - Servers (physical hosts) leave kind unlocked so the user can browse
 *    everything that ran on the host across both kinds. */
function ServerRecentJobs({ server, kindLabel }: { server: ServerType; kindLabel: KindLabel }) {
  if (kindLabel === 'service') {
    return (
      <History
        lock={{ kind: 'server', id: server.id, label: server.name }}
        jobKind={server.type === 'lora' ? 'lora' : 'wf'}
      />
    )
  }
  return <History lock={{ kind: 'server', id: server.id, label: server.name }} />
}

export function ServerOverview({
  server,
  servers,
  wfs,
  isAdmin,
  onPatch,
  navigate,
  kindLabel,
}: {
  server: ServerType
  /** All registered records — used to compute the linked-services list
   *  (servers only) and to inherit GPU info from a sibling record when this
   *  one has none. */
  servers: ServerType[]
  wfs: Workflow[]
  isAdmin: boolean
  onPatch: (patch: ServerPatch) => Promise<void>
  navigate?: NavigateFn
  kindLabel: KindLabel
}) {
  // Linked-services panel is a servers-only concept (services don't have
  // peer services). Computing it on the services page would be wasted work.
  const linkedServices = kindLabel === 'server' ? findServicesFor(server, servers) : []
  const fallbackGpu = linkedGpu(server, servers)
  const latency = server.health?.latencyMs ?? null
  const isOnline = server.health?.status === 'online'
  const isWfSrv = server.type !== 'lora'

  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(server.description ?? '')
  const [stats, setStats] = useState<ComfyStats | null>(null)
  const [statsErr, setStatsErr] = useState<string | null>(null)
  const [gpuStats, setGpuStats] = useState<GpuInfo[] | null>(null)
  const [gpuErr, setGpuErr] = useState<string | null>(null)
  const [srvStats, setSrvStats] = useState<{
    total: number
    completed: number
    failed: number
    avgWaitMs: number | null
  } | null>(null)

  useEffect(() => {
    if (!isWfSrv || !isOnline) {
      setStats(null)
      setStatsErr(null)
      return
    }
    let cancelled = false
    api
      .get<ComfyStats>(`/api/servers/${server.id}/comfy/stats`)
      .then((d) => {
        if (!cancelled) {
          setStats(d)
          setStatsErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setStatsErr(e instanceof Error ? e.message : 'Failed to load stats')
      })
    return () => {
      cancelled = true
    }
  }, [server.id, isWfSrv, isOnline])

  useEffect(() => {
    if (isWfSrv || !isOnline) {
      setGpuStats(null)
      setGpuErr(null)
      return
    }
    let cancelled = false
    api
      .get<GpuInfo[]>(`/api/servers/${server.id}/gpu`)
      .then((d) => {
        if (!cancelled) {
          setGpuStats(d)
          setGpuErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setGpuErr(e instanceof Error ? e.message : 'Failed to load GPU stats')
      })
    return () => {
      cancelled = true
    }
  }, [server.id, isWfSrv, isOnline])

  useEffect(() => {
    let cancelled = false
    api
      .get<{ total: number; completed: number; failed: number; avgWaitMs: number | null }>(
        `/api/servers/${server.id}/stats`,
      )
      .then((d) => {
        if (!cancelled) setSrvStats(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [server.id])

  function commitDesc() {
    const next = descDraft.trim()
    const prev = server.description ?? ''
    if (next !== prev) onPatch({ description: next === '' ? null : next })
    setEditingDesc(false)
  }

  function startEditing() {
    setDescDraft(server.description ?? '')
    setEditingDesc(true)
  }

  const device = stats?.devices?.[0]
  const vramUsd = device ? device.vram_total - device.vram_free : null
  const gpuDevice = gpuStats?.[0]

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        <div className="col">
          <div className="grid-3">
            <Kpi label="Running jobs" value={server.activeJobs ?? 0} valueColor="var(--accent)" />
            <Kpi label="Waiting" value={server.waitingJobs ?? 0} />
            <Kpi label="Latency" valueSize={22} value={latency != null ? `${latency}ms` : '—'} />
          </div>
          <div className="grid-3">
            <Kpi label="Jobs · 24h" valueSize={22} value={srvStats ? srvStats.total : '—'} />
            <Kpi
              label="Success rate · 24h"
              valueSize={22}
              valueColor={
                srvStats && srvStats.total > 0
                  ? srvStats.completed / srvStats.total >= 0.9
                    ? 'var(--good)'
                    : srvStats.completed / srvStats.total >= 0.75
                      ? 'var(--warn)'
                      : 'var(--bad)'
                  : undefined
              }
              value={
                srvStats && srvStats.total > 0
                  ? `${Math.round((srvStats.completed / srvStats.total) * 100)}%`
                  : '—'
              }
            />
            <Kpi
              label="Avg wait · 24h"
              valueSize={22}
              value={
                srvStats?.avgWaitMs != null
                  ? fmtDuration(Math.round(srvStats.avgWaitMs / 1000))
                  : '—'
              }
            />
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Description</div>
              {!editingDesc && isAdmin && (
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>double-click to edit</span>
              )}
            </div>
            <div
              className="card-pad"
              style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
              onDoubleClick={() => {
                if (isAdmin && !editingDesc) startEditing()
              }}
            >
              {editingDesc ? (
                <textarea
                  autoFocus
                  className="input"
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={commitDesc}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditingDesc(false)
                      return
                    }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      commitDesc()
                    }
                  }}
                  style={{
                    width: '100%',
                    minHeight: 80,
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    resize: 'vertical',
                  }}
                  placeholder={`Describe this ${kindLabel}… (Ctrl+Enter to save, Esc to cancel)`}
                />
              ) : server.description ? (
                <span style={{ whiteSpace: 'pre-wrap' }}>{server.description}</span>
              ) : (
                <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>
                  No description set.
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="col">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Hardware</div>
              {isWfSrv && isOnline && !stats && !statsErr && (
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>loading…</span>
              )}
              {!isWfSrv && isOnline && !gpuStats && !gpuErr && (
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>loading…</span>
              )}
              {isWfSrv && statsErr && (
                <span style={{ fontSize: 10, color: 'var(--bad)' }} title={statsErr}>
                  unreachable
                </span>
              )}
              {!isWfSrv && gpuErr && (
                <span style={{ fontSize: 10, color: 'var(--bad)' }} title={gpuErr}>
                  unreachable
                </span>
              )}
            </div>
            <div className="card-pad col" style={{ gap: 10 }}>
              <KVRow label="GPU">
                <span className="mono" style={{ fontSize: 11 }}>
                  {isWfSrv
                    ? device
                      ? device.name.replace(/^cuda:\d+\s+/, '')
                      : (server.gpu ?? fallbackGpu ?? '—')
                    : (gpuDevice?.name ?? server.gpu ?? fallbackGpu ?? '—')}
                </span>
              </KVRow>
              <KVRow label="VRAM">
                {isWfSrv ? (
                  device && vramUsd != null ? (
                    <span className="mono" style={{ fontSize: 11 }}>
                      {fmtBytes(vramUsd)} / {fmtBytes(device.vram_total)}
                    </span>
                  ) : (
                    <span className="mono" style={{ fontSize: 11 }}>
                      —
                    </span>
                  )
                ) : gpuDevice?.memory_used != null && gpuDevice?.memory_total != null ? (
                  <span className="mono" style={{ fontSize: 11 }}>
                    {fmtMB(gpuDevice.memory_used)} / {fmtMB(gpuDevice.memory_total)}
                  </span>
                ) : (
                  <span className="mono" style={{ fontSize: 11 }}>
                    —
                  </span>
                )}
              </KVRow>
              {isWfSrv && device && vramUsd != null && (
                <div className="bar">
                  <i
                    style={{
                      width: `${Math.round((vramUsd / device.vram_total) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              )}
              {!isWfSrv && gpuDevice?.memory_used != null && gpuDevice?.memory_total != null && (
                <div className="bar">
                  <i
                    style={{
                      width: `${Math.round((gpuDevice.memory_used / gpuDevice.memory_total) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              )}
              {!isWfSrv && gpuDevice?.usage != null && (
                <>
                  <KVRow label="GPU util">
                    <span className="mono" style={{ fontSize: 11 }}>
                      {Math.round(gpuDevice.usage)}%
                    </span>
                  </KVRow>
                  <div className="bar">
                    <i
                      style={{
                        width: `${Math.round(gpuDevice.usage)}%`,
                        background: 'var(--info)',
                      }}
                    />
                  </div>
                </>
              )}
              {!isWfSrv && gpuDevice?.temperature != null && (
                <KVRow label="Temp">
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color:
                        gpuDevice.temperature > 85
                          ? 'var(--bad)'
                          : gpuDevice.temperature > 75
                            ? 'var(--warn)'
                            : undefined,
                    }}
                  >
                    {gpuDevice.temperature}°C
                  </span>
                </KVRow>
              )}
              {!isWfSrv && gpuDevice?.power != null && (
                <KVRow label="Power">
                  <span className="mono" style={{ fontSize: 11 }}>
                    {Math.round(gpuDevice.power)}W
                  </span>
                </KVRow>
              )}
              {isWfSrv && stats?.system?.os && (
                <KVRow label="OS">
                  <span className="mono" style={{ fontSize: 11 }}>
                    {stats.system.os}
                  </span>
                </KVRow>
              )}
              {isWfSrv && stats?.system?.python_version && (
                <KVRow label="Python">
                  <span className="mono" style={{ fontSize: 11 }}>
                    {stats.system.python_version.split(' ')[0]}
                  </span>
                </KVRow>
              )}
              <KVRow label="Status">
                <ServerStatusBadge server={server} style={{ fontSize: 11 }} />
              </KVRow>
              <KVRow label="Last seen">
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {fmtRelativeTime(server.health?.lastPingAt)}
                </span>
              </KVRow>
              {isWfSrv && (
                <KVRow label="Workflows">
                  <strong className="mono">{wfs.length}</strong>
                </KVRow>
              )}
            </div>
          </div>
          {server.tags.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">Tags</div>
              </div>
              <div className="card-pad row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {server.tags.map((t) => (
                  <span key={t} className="chip" style={{ fontSize: 11 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {linkedServices.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">Linked services</div>
                <span className="chip">{linkedServices.length}</span>
              </div>
              <div className="card-pad col" style={{ gap: 4 }}>
                {linkedServices.map((s) => {
                  const port = portOf(s)
                  return (
                    <div
                      key={s.id}
                      className="row"
                      style={{ gap: 8, alignItems: 'center', padding: '4px 0' }}
                    >
                      <span
                        className="chip"
                        style={{
                          fontSize: 9,
                          padding: '1px 5px',
                          fontWeight: 600,
                          color: typeAccent(s),
                          background: `color-mix(in oklab, ${typeAccent(s)} 14%, transparent)`,
                        }}
                      >
                        {s.type === 'lora' ? 'LoRA' : 'Workflow'}
                      </span>
                      <strong
                        style={{
                          fontSize: 12.5,
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.name}
                      </strong>
                      {port && (
                        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          :{port}
                        </span>
                      )}
                      {navigate && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          style={{ width: 22, height: 22, flexShrink: 0 }}
                          title={`Open service ${s.name}`}
                          onClick={() => navigate('servers', `/servers/${s.id}`)}
                        >
                          <ExternalLink size={11} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <ServerTopUsersWidget serverId={server.id} navigate={navigate} />
      <ServerRecentJobs server={server} kindLabel={kindLabel} />
    </div>
  )
}
