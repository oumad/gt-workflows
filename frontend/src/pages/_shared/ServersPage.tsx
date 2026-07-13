import { Fragment, useState, useEffect } from 'react'
import { useTabWithUrl } from '../../hooks/useTabWithUrl'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { RangeSelector } from '../../components/ui/RangeSelector'
import { type Range } from '../analytics/analyticsHelpers'
import { useServers } from '../../hooks/useServers'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'
import {
  Search,
  RefreshCw,
  Plus,
  Scan,
  ChevronRight,
  Tag,
  Boxes,
  Server,
  Workflow as WorkflowIcon,
  MoreVertical,
  Activity,
  Zap,
  Wrench,
  Bot,
  Trash2,
} from 'lucide-react'
import { SetoModal } from '../../components/seto/SetoModal'
import type { Server as ServerType } from '../../types'
import { normServerUrl } from '../workflows/workflowsHelpers'
import { linkedGpu, findHostFor, findServicesFor } from '../../lib/serverLinks'
import {
  type ServerPatch,
  type NavigateFn,
  typeAccent,
  typeTint,
  serverColor,
  serverStatus,
} from './serverHelpers'
import { Kpi } from '../../components/ui/Kpi'
import { ServerStatusBadge } from './ServerBadges'
import { isHostRecord } from '../../lib/serverLinks'
import { ServerDetail, type DetailComponents } from './ServerDetail'
import { ServerLogsModal } from './ServerLogsTab'
import {
  ServersMetrics,
  ServersInsights,
  ServersIncidents,
  ServersRepartition,
} from './ServersDashboard'
import { AddServerModal } from './ServerModals'
import { ServerSaturationHeatmap } from './ServerSaturationHeatmap'

/** Status-chip filter values for the list. 'down' includes 'unknown' (no
 *  recent ping — effectively unreachable for triage purposes) and 'busy'
 *  includes 'warn'. */
type StatusFilter = 'all' | 'down' | 'busy' | 'slow' | 'up' | 'maint'

/**
 * Shared listing page used by both the services and servers tools.
 * The two pages render the same shell, KPI strip, search/filter row and modal
 * stack — the per-page differences (icon, labels, URL prefix, card body and
 * action menu) are selected via `kindLabel`. See KIND_CONFIG for the static
 * label/key table and the inline branches in the card body / action menu for
 * the structural differences. */

export type KindLabel = 'service' | 'server'

const KIND_CONFIG: Record<
  KindLabel,
  {
    icon: typeof Boxes
    title: string
    sub: string
    crumb: string
    addBtn: string
    totalLabel: string
    searchPlaceholder: string
    loadingMsg: string
    emptyNoMatch: string
    emptyNone: string
    actionsTitle: string
    inheritedTagTooltip: string
    urlPrefix: string
    storageKey: string
    allTabLabel: string
  }
> = {
  service: {
    icon: Boxes,
    title: 'Services',
    sub: 'All cluster services and their current load',
    crumb: 'Services',
    addBtn: 'Add service',
    totalLabel: 'Total services',
    searchPlaceholder: 'Search services…',
    loadingMsg: 'Loading services…',
    emptyNoMatch: 'No services match the current filter.',
    emptyNone: 'No services yet — click Grind to import from workflows.',
    actionsTitle: 'Service actions',
    inheritedTagTooltip: 'from the server hosting this service',
    urlPrefix: '/servers',
    storageKey: 'coffee-maker-server-filters',
    allTabLabel: 'All services',
  },
  server: {
    icon: Server,
    title: 'Servers',
    sub: 'All cluster servers and their current load',
    crumb: 'Servers',
    addBtn: 'Add server',
    totalLabel: 'Total servers',
    searchPlaceholder: 'Search servers…',
    loadingMsg: 'Loading servers…',
    emptyNoMatch: 'No servers match the current filter.',
    emptyNone: 'No servers yet — click Grind to import from workflows.',
    actionsTitle: 'Server actions',
    inheritedTagTooltip: 'from a service on this server',
    urlPrefix: '/hosts',
    storageKey: 'coffee-maker-host-filters',
    allTabLabel: 'All servers',
  },
}

export function ServersPage({
  navigate,
  kindLabel,
  detailComponents,
}: {
  navigate?: NavigateFn
  kindLabel: KindLabel
  /** Per-page Overview / Settings / Actions sub-tabs injected from the
   *  per-flavour wrapper — shared ServerDetail doesn't know which to render. */
  detailComponents: DetailComponents
}) {
  const cfg = KIND_CONFIG[kindLabel]
  const KindIcon = cfg.icon
  const { canWrite } = useAuth()
  // "isAdmin" downstream means "can edit this tool's records" — services are
  // writable by admin + operator, hosts (Servers tool) by admin only.
  const isAdmin = canWrite(kindLabel === 'service' ? 'services' : 'servers')
  const { servers, loading, error, reload } = useServers()
  const { workflows } = useWorkflows()
  const [tab, setTab] = useTabWithUrl('all', [
    'all',
    'metrics',
    'insights',
    'incidents',
    'repartition',
  ])
  const [range, setRange] = useState<Range>('7d')
  // URL prefix differs between flavours: services live at /servers/:id (legacy
  // route, kept stable), servers live at /hosts/:id. Both pages still post to
  // the same /api/servers endpoint — only the URL bar prefix changes.
  const detailRe = new RegExp(`^${cfg.urlPrefix}/([^/]+)$`)
  const [detail, setDetail] = useState<string | null>(() => {
    const m = window.location.pathname.match(detailRe)
    return m ? decodeURIComponent(m[1]) : null
  })
  const [editingName, setEditingName] = useState<string | null>(null)
  // Only services have an expandable workflow list on the card — but the hook
  // must run unconditionally, so we declare it for both flavours.
  const [expandedWF, setExpandedWF] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Status chips (All / Down / Busy / Up / Maint) — replaces the old
  // show-down/show-maint toggles + sort select. The list is ALWAYS sorted
  // worst-first so problems surface on top; the chips slice it by status.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey) ?? 'null')?.statusFilter ?? 'all'
    } catch {
      return 'all'
    }
  })
  // The saturation heatmap is tall — collapsible, and the preference sticks
  // across sessions (same per-page storage blob as the filter).
  const [heatmapOpen, setHeatmapOpen] = useState<boolean>(() => {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey) ?? 'null')?.heatmapOpen ?? true
    } catch {
      return true
    }
  })
  const [scraping, setScraping] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null)
  // Deep-link: /(servers|hosts)?addUrl=http://node-03:8188 opens the create modal
  // pre-filled. Cleared from the URL once the user closes the modal.
  const [addOpen, setAddOpen] = useState(() =>
    new URLSearchParams(window.location.search).has('addUrl'),
  )
  const [addUrl, setAddUrl] = useState(
    () => new URLSearchParams(window.location.search).get('addUrl') ?? '',
  )
  const [menuOpen, setMenuOpen] = useState<{ id: string; top: number; left: number } | null>(null)
  const [logsOpen, setLogsOpen] = useState<string | null>(null)
  const [setoOpen, setSetoOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

  useEffect(() => {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify({ statusFilter, heatmapOpen }))
    } catch {}
  }, [statusFilter, heatmapOpen, cfg.storageKey])

  const wfByServer = (serverUrl: string) =>
    workflows.filter((w) => w.serverUrls.some((u) => normServerUrl(u) === normServerUrl(serverUrl)))

  // Both pages share the same `servers` table; the distinction is URL shape.
  // Hosts have a port-less URL (`http://worker-03`); services carry a port
  // (`http://worker-03:8188`). Without this filter the Servers page leaks
  // service rows like `x1201491:8199` and vice-versa — that's the symptom
  // you'd see on a freshly Grind-ed dataset.
  //
  // We keep the unfiltered `servers` for downstream components that need to
  // resolve host↔service relationships across the divide (notably the
  // Repartition tab, which aggregates a host over its sibling services and
  // wouldn't be able to without seeing both sides).
  const pageServers = servers.filter((s) =>
    kindLabel === 'server' ? isHostRecord(s) : !isHostRecord(s),
  )

  const activeSrvs = pageServers.filter((s) => !s.isMaintenance)
  // KPI counts are derived from chipCounts (below) so each card's number
  // matches the list you get when you click it — see the KPI strip.

  async function handleScrape() {
    setScraping(true)
    setScrapeMsg(null)
    try {
      // The scrape unifies workflow + lora job history and workflow params.json,
      // and creates both host (port-less) and service (URL + port + type) rows
      // — so the message mentions both counts when either is non-zero. We list
      // the kind matching the current tab first so the user sees the relevant
      // count up front.
      const res = await api.post<{
        servers: number
        services: number
        created: number
        found: number
        names: string[]
      }>('/api/servers/scrape', {})
      const parts: string[] = []
      if (kindLabel === 'service') {
        if (res.services > 0) parts.push(`${res.services} service${res.services > 1 ? 's' : ''}`)
        if (res.servers > 0) parts.push(`${res.servers} server${res.servers > 1 ? 's' : ''}`)
      } else {
        if (res.servers > 0) parts.push(`${res.servers} server${res.servers > 1 ? 's' : ''}`)
        if (res.services > 0) parts.push(`${res.services} service${res.services > 1 ? 's' : ''}`)
      }
      setScrapeMsg(
        res.created > 0
          ? `Created ${parts.join(' and ')}: ${res.names.join(', ')}`
          : res.found > 0
            ? `All ${res.found} entries from job history and workflow params.json already exist.`
            : 'No URLs found in job history or workflow params.json.',
      )
      reload()
    } catch (e) {
      setScrapeMsg(e instanceof Error ? e.message : 'Grind failed')
    } finally {
      setScraping(false)
    }
  }

  async function handlePatch(s: ServerType, patch: ServerPatch) {
    await api.patch(`/api/servers/${s.id}`, patch)
    reload()
  }

  function openDetail(id: string) {
    window.history.pushState(null, '', `${cfg.urlPrefix}/${id}`)
    setDetail(id)
  }

  function closeDetail() {
    window.history.pushState(null, '', cfg.urlPrefix)
    setDetail(null)
  }

  async function handleDelete(s: ServerType) {
    await api.del(`/api/servers/${s.id}`)
    closeDetail()
    reload()
  }

  async function handleRecheck(s: ServerType) {
    await api.post(`/api/servers/${s.id}/probe`, {})
    reload()
  }

  // Once loading is done, if the URL points to a missing id, drop the detail
  // view back to the listing. Done in an effect so we don't push history during
  // render (which would warn under React strict mode).
  useEffect(() => {
    if (!loading && detail && !servers.find((x) => x.id === detail)) {
      closeDetail()
    }
    // closeDetail is recreated every render; the guard above defines when
    // this effect acts, so depending on it would only add no-op re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, detail, servers])

  // Detail view
  if (detail) {
    const s = servers.find((x) => x.id === detail)
    if (s)
      return (
        <ServerDetail
          server={s}
          servers={servers}
          wfs={wfByServer(s.url)}
          isAdmin={isAdmin}
          onBack={closeDetail}
          onPatch={(patch) => handlePatch(s, patch)}
          onDelete={() => handleDelete(s)}
          onRecheck={() => handleRecheck(s)}
          navigate={navigate}
          kindLabel={kindLabel}
          components={detailComponents}
        />
      )
  }

  // Priority for sortBy='status' — worst (most actionable) first. Ties break
  // on name so the order within a status bucket stays stable across reloads.
  const STATUS_RANK: Record<ReturnType<typeof serverStatus>, number> = {
    down: 0,
    unknown: 1,
    maintenance: 2,
    warn: 3,
    busy: 4,
    ok: 5,
  }

  const matchesFilter = (s: ServerType): boolean => {
    const st = serverStatus(s)
    switch (statusFilter) {
      case 'down':
        return st === 'down' || st === 'unknown'
      case 'busy':
        return st === 'busy'
      case 'slow':
        return st === 'warn'
      case 'up':
        return st === 'ok'
      case 'maint':
        return st === 'maintenance'
      default:
        return true
    }
  }

  const filtered = pageServers
    .filter((s) => {
      if (!matchesFilter(s)) return false
      if (search) {
        const q = search.toLowerCase()
        if (![s.name, s.url, ...s.tags].some((v) => v.toLowerCase().includes(q))) return false
      }
      return true
    })
    // Always worst-first (down → unknown → maint → warn → busy → ok), name
    // as the tiebreak — downs are visible without touching any control.
    .sort((a, b) => {
      const rankDiff = STATUS_RANK[serverStatus(a)] - STATUS_RANK[serverStatus(b)]
      if (rankDiff !== 0) return rankDiff
      return a.name.localeCompare(b.name)
    })

  // Chip counts. 'down' folds in 'unknown'; 'busy' (has jobs) and 'slow'
  // (idle but high-latency) are kept separate so each chip's count matches the
  // badge rendered on the cards it selects.
  const chipCounts: Record<StatusFilter, number> = {
    all: pageServers.length,
    down: pageServers.filter((s) => ['down', 'unknown'].includes(serverStatus(s))).length,
    busy: pageServers.filter((s) => serverStatus(s) === 'busy').length,
    slow: pageServers.filter((s) => serverStatus(s) === 'warn').length,
    up: pageServers.filter((s) => serverStatus(s) === 'ok').length,
    maint: pageServers.filter((s) => serverStatus(s) === 'maintenance').length,
  }

  const tabs = [
    { id: 'all', label: cfg.allTabLabel, pill: pageServers.length },
    { id: 'metrics', label: 'Metrics' },
    { id: 'insights', label: 'Insights' },
    { id: 'incidents', label: 'Incidents' },
    { id: 'repartition', label: 'Repartition' },
  ]

  return (
    <>
      <PageHead
        crumbs={['Brews', cfg.crumb]}
        title={cfg.title}
        sub={cfg.sub}
        actions={
          <>
            {(tab === 'insights' || tab === 'repartition') && (
              <RangeSelector range={range} onChange={setRange} />
            )}
            <button className="btn btn-sm" onClick={() => reload()} disabled={loading}>
              {' '}
              <RefreshCw size={14} /> Sync
            </button>
            {isAdmin && (
              <button className="btn btn-sm" onClick={handleScrape} disabled={scraping}>
                <Scan size={14} /> Grind
              </button>
            )}
            {isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
                <Plus size={14} /> {cfg.addBtn}
              </button>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="body">
        {tab === 'all' && (
          <>
            {/* Stats — maintenance is excluded from the headline numbers
             * (planned downtime isn't an incident) and each card activates
             * the matching status chip below. */}
            <div className="grid-5" style={{ marginBottom: 16 }}>
              <Kpi
                label={cfg.totalLabel}
                value={activeSrvs.length}
                sub={chipCounts.maint > 0 ? `+${chipCounts.maint} in maintenance` : undefined}
                onClick={() => setStatusFilter('all')}
              />
              <Kpi
                label="Online"
                value={chipCounts.up}
                valueColor="var(--good)"
                onClick={() => setStatusFilter('up')}
              />
              <Kpi
                label="Down"
                value={chipCounts.down}
                valueColor="var(--bad)"
                onClick={() => setStatusFilter('down')}
              />
              <Kpi
                label="Busy"
                value={chipCounts.busy}
                valueColor="var(--info)"
                onClick={() => setStatusFilter('busy')}
              />
              <Kpi
                label="Slow"
                value={chipCounts.slow}
                valueColor="var(--warn)"
                onClick={() => setStatusFilter('slow')}
              />
            </div>

            {/* Saturation heatmap — 5-second triage view above the card list. */}
            {!loading && pageServers.length > 0 && (
              <ServerSaturationHeatmap
                servers={pageServers}
                onOpen={openDetail}
                kindLabel={kindLabel}
                open={heatmapOpen}
                onToggle={() => setHeatmapOpen((v: boolean) => !v)}
              />
            )}

            {/* Scrape message */}
            {scrapeMsg && (
              <div
                className="row"
                style={{
                  gap: 8,
                  marginBottom: 12,
                  padding: '8px 12px',
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <span style={{ flex: 1 }}>{scrapeMsg}</span>
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => setScrapeMsg(null)}
                >
                  ×
                </button>
              </div>
            )}

            {/* Filter row */}
            <div className="row" style={{ marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
              <div className="search">
                <span className="search-icon">
                  <Search size={14} />
                </span>
                <input
                  className="input"
                  placeholder={cfg.searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {/* Status chips — one-click slice of the list. The list itself
               * is always sorted worst-first, so "All" already has problems
               * on top; the chips answer "show me JUST the downs". */}
              {(
                [
                  { id: 'all', label: 'All', color: null },
                  { id: 'down', label: 'Down', color: 'var(--bad)' },
                  { id: 'busy', label: 'Busy', color: 'var(--info)' },
                  { id: 'slow', label: 'Slow', color: 'var(--warn)' },
                  { id: 'up', label: 'Up', color: 'var(--good)' },
                  { id: 'maint', label: 'Maint.', color: 'var(--warn)' },
                ] as { id: StatusFilter; label: string; color: string | null }[]
              ).map((f) => (
                <button
                  key={f.id}
                  className="btn btn-sm"
                  onClick={() => setStatusFilter(f.id)}
                  style={
                    statusFilter === f.id
                      ? {
                          borderColor: f.color ?? 'var(--ink-2)',
                          boxShadow: `inset 0 0 0 1px ${f.color ?? 'var(--ink-2)'}`,
                        }
                      : undefined
                  }
                >
                  {f.label}
                  <span
                    className="chip"
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      ...(f.color
                        ? {
                            color: f.color,
                            background: `color-mix(in oklab, ${f.color} 12%, transparent)`,
                          }
                        : {}),
                    }}
                  >
                    {chipCounts[f.id]}
                  </span>
                </button>
              ))}
            </div>

            {/* Cards */}
            {loading ? (
              <div style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>
                {cfg.loadingMsg}
              </div>
            ) : error ? (
              <div className="alert alert-error">{error}</div>
            ) : (
              <div className="grid-3">
                {filtered.map((s) => {
                  // Inherited-tags source differs by flavour:
                  //  - service cards inherit from the parent host (single linked host)
                  //  - server  cards inherit from any service on the same host (union)
                  let cardTags: { t: string; inherited: boolean }[]
                  const ownTagSet = new Set(s.tags)
                  if (kindLabel === 'service') {
                    const linkedHost = findHostFor(s, servers)
                    cardTags = [
                      ...s.tags.map((t) => ({ t, inherited: false })),
                      ...(linkedHost?.tags ?? [])
                        .filter((t) => !ownTagSet.has(t))
                        .map((t) => ({ t, inherited: true })),
                    ]
                  } else {
                    const linkedServices = findServicesFor(s, servers)
                    const serviceTagSet = new Set<string>()
                    for (const svc of linkedServices) for (const t of svc.tags) serviceTagSet.add(t)
                    cardTags = [
                      ...s.tags.map((t) => ({ t, inherited: false })),
                      ...[...serviceTagSet]
                        .filter((t) => !ownTagSet.has(t))
                        .map((t) => ({ t, inherited: true })),
                    ]
                  }

                  const wfs = wfByServer(s.url)
                  const isExp = expandedWF === s.name

                  // Latency footer (servers only) — hidden when unreachable or
                  // in maintenance because the last-known value is stale and
                  // misleading in those states.
                  const status = serverStatus(s)
                  const ms = s.health?.latencyMs ?? null
                  const hasLat = status !== 'down' && status !== 'maintenance' && ms != null
                  const latColor = !hasLat
                    ? 'var(--ink-3)'
                    : ms! > 200
                      ? 'var(--bad)'
                      : ms! > 60
                        ? 'var(--warn)'
                        : 'var(--good)'

                  return (
                    <div
                      className="card card-pad col"
                      key={s.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[data-stop]')) return
                        openDetail(s.id)
                      }}
                      style={{
                        gap: 10,
                        position: 'relative',
                        cursor: 'pointer',
                        background: typeTint(s),
                        borderLeft: `3px solid ${typeAccent(s)}`,
                        opacity: s.isMaintenance ? 0.55 : undefined,
                      }}
                    >
                      <div className="row" style={{ gap: 0 }}>
                        <div
                          className="tile-icon"
                          style={{
                            background: serverColor(s),
                            width: 32,
                            height: 32,
                            marginRight: 10,
                            flexShrink: 0,
                          }}
                        >
                          <KindIcon size={14} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {editingName === s.id ? (
                            <input
                              data-stop
                              autoFocus
                              defaultValue={s.name}
                              className="input"
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 600,
                                fontSize: 15,
                                padding: '2px 6px',
                                height: 24,
                              }}
                              onBlur={(e) => {
                                const v = e.target.value.trim()
                                if (v && v !== s.name) handlePatch(s, { name: v })
                                setEditingName(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                if (e.key === 'Escape') setEditingName(null)
                              }}
                            />
                          ) : (
                            <div
                              data-stop
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontWeight: 600,
                                fontSize: 15,
                                cursor: isAdmin ? 'text' : 'default',
                                borderRadius: 4,
                                padding: '0 2px',
                                margin: '0 -2px',
                              }}
                              onClick={(e) => {
                                if (!isAdmin) return
                                e.stopPropagation()
                                setEditingName(s.id)
                              }}
                              title={isAdmin ? 'Click to rename' : undefined}
                            >
                              {s.name}
                            </div>
                          )}
                          <div
                            className="row"
                            style={{ gap: 5, alignItems: 'center', marginTop: 1 }}
                          >
                            {/* Type chip — services only. Servers don't have
                                a meaningful type (it's service-level). */}
                            {kindLabel === 'service' && (
                              <span
                                className="chip"
                                style={{
                                  fontSize: 9,
                                  padding: '1px 6px',
                                  flexShrink: 0,
                                  fontWeight: 600,
                                  background: `color-mix(in oklab, ${typeAccent(s)} 16%, var(--surface))`,
                                  color: typeAccent(s),
                                }}
                              >
                                {s.type === 'lora' ? 'LoRA' : 'Workflow'}
                              </span>
                            )}
                            <span
                              className="mono"
                              style={{
                                fontSize: 10.5,
                                color: 'var(--ink-3)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {s.url}
                            </span>
                          </div>
                        </div>
                        <ServerStatusBadge server={s} />
                        <div data-stop style={{ marginLeft: 6, flexShrink: 0 }}>
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ width: 26, height: 26 }}
                            title={cfg.actionsTitle}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (menuOpen?.id === s.id) {
                                setMenuOpen(null)
                                return
                              }
                              const rect = (
                                e.currentTarget as HTMLButtonElement
                              ).getBoundingClientRect()
                              setMenuOpen({
                                id: s.id,
                                top: rect.bottom + 4,
                                left: rect.right - 190,
                              })
                            }}
                          >
                            <MoreVertical size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Tags (own + inherited from linked host/services) */}
                      {cardTags.length > 0 && (
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {cardTags.map(({ t, inherited }) => (
                            <span
                              key={t}
                              className="chip"
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                opacity: inherited ? 0.65 : 1,
                              }}
                              title={inherited ? cfg.inheritedTagTooltip : undefined}
                            >
                              <Tag size={9} /> {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Footer row — different per flavour:
                          - services (workflow only): Workflows count (GPU is a
                            host-level concern, shown on the Servers tool)
                          - servers: Latency + GPU */}
                      {kindLabel === 'service' && s.type !== 'lora' && (
                        <div
                          className="row"
                          style={{
                            justifyContent: 'space-between',
                            borderTop: '1px dashed var(--line)',
                            paddingTop: 10,
                            marginTop: 4,
                          }}
                        >
                          <div
                            data-stop
                            onClick={() => wfs.length > 0 && setExpandedWF(isExp ? null : s.name)}
                            style={{
                              cursor: wfs.length > 0 ? 'pointer' : 'default',
                              borderRadius: 6,
                              padding: '2px 6px',
                              margin: '-2px -6px',
                              background: isExp
                                ? 'color-mix(in oklab, var(--accent) 10%, transparent)'
                                : 'transparent',
                            }}
                            title={wfs.length > 0 ? 'Show workflows' : ''}
                          >
                            <div className="stat-label" style={{ fontSize: 9 }}>
                              Workflows
                            </div>
                            <div className="row" style={{ gap: 4, alignItems: 'baseline' }}>
                              <span
                                style={{
                                  fontFamily: 'var(--font-display)',
                                  fontSize: 20,
                                  fontWeight: 600,
                                  color: wfs.length > 0 ? 'var(--accent)' : 'var(--ink-3)',
                                }}
                              >
                                {wfs.length}
                              </span>
                              {wfs.length > 0 && (
                                <span
                                  style={{
                                    transform: isExp ? 'rotate(90deg)' : 'rotate(0)',
                                    transition: 'transform .15s',
                                    color: 'var(--ink-3)',
                                    display: 'inline-flex',
                                  }}
                                >
                                  <ChevronRight size={12} />
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {kindLabel === 'server' && (
                        <div
                          className="row"
                          style={{
                            justifyContent: 'space-between',
                            borderTop: '1px dashed var(--line)',
                            paddingTop: 10,
                            marginTop: 4,
                          }}
                        >
                          <div>
                            <div className="stat-label" style={{ fontSize: 9 }}>
                              Latency
                            </div>
                            <div
                              className="mono"
                              style={{ fontSize: 14, fontWeight: 600, color: latColor }}
                            >
                              {hasLat ? `${ms}ms` : '—'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', minWidth: 0, maxWidth: '60%' }}>
                            <div className="stat-label" style={{ fontSize: 9 }}>
                              GPU
                            </div>
                            {(() => {
                              // The host record itself may have a null gpu (the
                              // probe targets the service port, not the host); we
                              // inherit from any linked service on this hostname.
                              const gpu = linkedGpu(s, servers)
                              return (
                                <div
                                  className="mono"
                                  style={{
                                    fontSize: 12,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={gpu ?? undefined}
                                >
                                  {gpu ?? '—'}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Expanded workflow list — services only, workflow type. */}
                      {kindLabel === 'service' && s.type !== 'lora' && isExp && wfs.length > 0 && (
                        <div
                          data-stop
                          className="col"
                          style={{
                            gap: 4,
                            paddingTop: 8,
                            borderTop: '1px solid var(--line)',
                            marginTop: 2,
                          }}
                        >
                          {wfs.slice(0, 8).map((w) => (
                            <div
                              key={w.id}
                              className="row"
                              style={{
                                gap: 6,
                                padding: '4px 0',
                                fontSize: 12,
                                cursor: navigate ? 'pointer' : 'default',
                                borderRadius: 4,
                              }}
                              onClick={() => navigate?.('workflows', `/workflows/${w.id}`)}
                            >
                              <span
                                style={{
                                  width: 14,
                                  height: 14,
                                  borderRadius: 3,
                                  background: 'var(--accent)',
                                  display: 'grid',
                                  placeItems: 'center',
                                  color: 'white',
                                  flexShrink: 0,
                                }}
                              >
                                <WorkflowIcon size={8} />
                              </span>
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                }}
                              >
                                {w.name}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                                {w.category}
                              </span>
                            </div>
                          ))}
                          {wfs.length > 8 && (
                            <div style={{ fontSize: 11, color: 'var(--ink-3)', paddingTop: 2 }}>
                              + {wfs.length - 8} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {filtered.length === 0 && (
                  <div
                    className="card card-pad"
                    style={{
                      gridColumn: '1 / -1',
                      textAlign: 'center',
                      color: 'var(--ink-3)',
                      padding: 32,
                    }}
                  >
                    {search ? cfg.emptyNoMatch : cfg.emptyNone}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {tab === 'metrics' && (
          <ServersMetrics servers={pageServers} onOpen={setDetail} kindLabel={kindLabel} />
        )}
        {tab === 'insights' && (
          <ServersInsights
            servers={servers}
            onOpen={setDetail}
            kindLabel={kindLabel}
            range={range}
          />
        )}
        {tab === 'incidents' && (
          <ServersIncidents servers={servers} onOpen={setDetail} kindLabel={kindLabel} />
        )}
        {tab === 'repartition' && (
          <ServersRepartition
            servers={servers}
            workflows={workflows}
            onOpen={setDetail}
            navigate={navigate}
            kindLabel={kindLabel}
            range={range}
          />
        )}
      </div>
      {addOpen &&
        // AddServerModal is a discriminated union — the services flavour
        // requires `servers` (for the host picker); the server flavour doesn't
        // take it. The close/created handlers are otherwise identical.
        (() => {
          const closeAdd = () => {
            setAddOpen(false)
            setAddUrl('')
            // Strip ?addUrl= from the URL so back-button doesn't reopen the modal.
            if (window.location.search.includes('addUrl=')) {
              window.history.replaceState(null, '', window.location.pathname)
            }
          }
          const createdAdd = async (s: ServerType) => {
            closeAdd()
            await reload()
            openDetail(s.id)
          }
          return kindLabel === 'service' ? (
            <AddServerModal
              kindLabel="service"
              servers={servers}
              defaultUrl={addUrl || undefined}
              onClose={closeAdd}
              onCreated={createdAdd}
            />
          ) : (
            <AddServerModal
              kindLabel="server"
              defaultUrl={addUrl || undefined}
              onClose={closeAdd}
              onCreated={createdAdd}
            />
          )
        })()}
      {menuOpen &&
        (() => {
          const s = servers.find((x) => x.id === menuOpen.id)
          if (!s) return null
          // `divider: true` inserts a visual separator above the item — used
          // to push the destructive Delete entry away from the routine actions
          // so it can't be hit by reflex.
          const items: {
            icon: React.ReactNode
            label: string
            action: () => void
            color?: string
            divider?: boolean
          }[] = [
            {
              icon: <Zap size={14} />,
              label: 'Force check',
              action: () => {
                setMenuOpen(null)
                api
                  .post(`/api/servers/${s.id}/probe`, {})
                  .then(() => reload())
                  .catch(() => {})
              },
              color: 'var(--info)',
            },
            // Log proxying only makes sense on SERVICE records (the process
            // that owns a port) — hosts are physical boxes with no log
            // endpoint of their own. LoRA backends don't expose /internal/logs
            // nor /history either, so it's ComfyUI services only.
            ...(kindLabel === 'service' && s.type === 'workflow'
              ? [
                  {
                    icon: <Activity size={14} />,
                    label: 'Show ComfyUI logs',
                    action: () => {
                      setLogsOpen(s.id)
                      setMenuOpen(null)
                    },
                    color: 'var(--pop-cyan)',
                  },
                ]
              : []),
            // Jump to the physical host this service runs on (hostname match).
            ...(kindLabel === 'service' && navigate && findHostFor(s, servers)
              ? [
                  {
                    icon: <Server size={14} />,
                    label: 'Go to server',
                    action: () => {
                      setMenuOpen(null)
                      navigate('servers', `/servers/${findHostFor(s, servers)!.id}`)
                    },
                    color: 'var(--info)',
                  },
                ]
              : []),
            // Maintenance is a host-level state — only show the toggle on the
            // servers tool, never on services. Services inherit the maintenance
            // status from their host. PATCH /api/servers/:id is admin-only too,
            // so hide for non-admins to avoid a silent 403.
            ...(kindLabel === 'server' && isAdmin
              ? [
                  {
                    icon: <Wrench size={14} />,
                    label: s.isMaintenance ? 'Disable maintenance' : 'Enable maintenance',
                    action: () => {
                      handlePatch(s, { isMaintenance: !s.isMaintenance })
                      setMenuOpen(null)
                    },
                    color: 'var(--warn)',
                  },
                ]
              : []),
            // "Report issue" lives INSIDE the Seto modal now (the Discord
            // report embeds the Seto findings), so Ask Seto is the single
            // entry point for both diagnosis and reporting.
            {
              icon: <Bot size={14} />,
              label: 'Ask Seto',
              action: () => {
                setSetoOpen(s.id)
                setMenuOpen(null)
              },
              color: 'var(--accent)',
            },
            // Delete is the only destructive action in this menu — admin-only
            // (DELETE /api/servers/:id is admin-gated, hiding for non-admins
            // avoids a silent 403) and behind a window.confirm so reflex
            // clicks don't drop the row. Past jobs are kept (their server_id
            // becomes null) per the API contract — call that out in the
            // confirmation so the operator knows what's at risk.
            ...(isAdmin
              ? [
                  {
                    icon: <Trash2 size={14} />,
                    label: `Delete ${kindLabel}`,
                    action: () => {
                      setMenuOpen(null)
                      const ok = window.confirm(
                        `Delete ${kindLabel} "${s.name}"?\n\n` +
                          `This removes it from the database. Past jobs that referenced it are kept ` +
                          `(their server_id becomes null). This cannot be undone.`,
                      )
                      if (!ok) return
                      handleDelete(s).catch((err) => {
                        // The shared handleDelete swallows errors silently; surface
                        // them here so the operator knows the row didn't go away.
                        alert(
                          `Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                        )
                      })
                    },
                    color: 'var(--bad)',
                    divider: true,
                  },
                ]
              : []),
          ]
          return (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                top: menuOpen.top,
                left: menuOpen.left,
                zIndex: 'var(--z-pop)',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                boxShadow: 'var(--shadow-lg)',
                minWidth: 0,
                overflow: 'hidden',
                padding: 4,
              }}
            >
              {items.map((item) => (
                <Fragment key={item.label}>
                  {item.divider && (
                    <div
                      style={{
                        height: 1,
                        background: 'var(--line)',
                        margin: '4px 6px',
                      }}
                    />
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      borderRadius: 6,
                      padding: '7px 12px',
                      fontSize: 13,
                      gap: 9,
                      whiteSpace: 'nowrap',
                    }}
                    onClick={item.action}
                  >
                    <span
                      style={{
                        color: item.color,
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>
          )
        })()}
      {logsOpen &&
        (() => {
          const s = servers.find((x) => x.id === logsOpen)
          if (!s) return null
          return (
            <ServerLogsModal server={s} onClose={() => setLogsOpen(null)} kindLabel={kindLabel} />
          )
        })()}
      {setoOpen &&
        (() => {
          const s = servers.find((x) => x.id === setoOpen)
          if (!s) return null
          return (
            <SetoModal
              kind={kindLabel}
              id={s.id}
              label={s.name}
              onClose={() => setSetoOpen(null)}
            />
          )
        })()}
    </>
  )
}
