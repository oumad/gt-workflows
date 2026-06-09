import { Fragment, useState, useEffect } from 'react'
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
  Eye,
  EyeOff,
  MoreVertical,
  Activity,
  Zap,
  Wrench,
  Flag,
  Bot,
  ArrowUpDown,
  Trash2,
} from 'lucide-react'
import { ExpandingToggle } from '../../components/ui/ExpandingToggle'
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
import { AddServerModal, ReportIssueModal } from './ServerModals'
import { ServerSaturationHeatmap } from './ServerSaturationHeatmap'

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
  const { user } = useAuth()
  const isAdmin = user?.isAdmin ?? false
  const { servers, loading, error, reload } = useServers()
  const { workflows } = useWorkflows()
  const [tab, setTab] = useState('all')
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
  const [showDown, setShowDown] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey) ?? 'null')?.showDown ?? true
    } catch {
      return true
    }
  })
  const [showMaint, setShowMaint] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey) ?? 'null')?.showMaint ?? false
    } catch {
      return false
    }
  })
  // 'name' preserves the natural directory order; 'status' surfaces problems
  // (down → maintenance → warn → busy → ok) so ops can triage at
  // a glance without scrolling.
  const [sortBy, setSortBy] = useState<'name' | 'status'>(() => {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey) ?? 'null')?.sortBy ?? 'name'
    } catch {
      return 'name'
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
  const [reportOpen, setReportOpen] = useState<string | null>(null)
  const [setoOpen, setSetoOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

  useEffect(() => {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify({ showDown, showMaint, sortBy }))
    } catch {}
  }, [showDown, showMaint, sortBy, cfg.storageKey])

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
  const onlineCount = activeSrvs.filter((s) => {
    const st = serverStatus(s)
    return st === 'ok' || st === 'warn' || st === 'busy'
  }).length
  const busyCount = activeSrvs.filter((s) => serverStatus(s) === 'busy').length
  const downCount = activeSrvs.filter((s) => serverStatus(s) === 'down').length
  const maintenanceCount = pageServers.filter((s) => s.isMaintenance).length

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

  const filtered = pageServers
    .filter((s) => {
      if (!showMaint && s.isMaintenance) return false
      if (!showDown && serverStatus(s) === 'down') return false
      if (search) {
        const q = search.toLowerCase()
        if (![s.name, s.url, ...s.tags].some((v) => v.toLowerCase().includes(q))) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'status') {
        const rankDiff = STATUS_RANK[serverStatus(a)] - STATUS_RANK[serverStatus(b)]
        if (rankDiff !== 0) return rankDiff
      }
      return a.name.localeCompare(b.name)
    })

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
            {/* Stats */}
            <div className="grid-4" style={{ marginBottom: 16 }}>
              <Kpi label={cfg.totalLabel} value={pageServers.length} />
              <Kpi label="Online" value={onlineCount} valueColor="var(--good)" />
              <Kpi label="Down" value={downCount} valueColor="var(--bad)" />
              <Kpi label="Busy" value={busyCount} valueColor="var(--info)" />
            </div>

            {/* Saturation heatmap — 5-second triage view above the card list. */}
            {!loading && pageServers.length > 0 && (
              <ServerSaturationHeatmap servers={pageServers} onOpen={openDetail} />
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
              <button className="btn btn-sm" onClick={() => setShowDown((v: boolean) => !v)}>
                {showDown ? <EyeOff size={14} /> : <Eye size={14} />}
                {showDown ? 'Hide down' : 'Show down'}
                {downCount > 0 && (
                  <span
                    className="chip"
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      color: 'var(--bad)',
                      background: 'color-mix(in oklab, var(--bad) 12%, transparent)',
                    }}
                  >
                    {downCount}
                  </span>
                )}
              </button>
              <button className="btn btn-sm" onClick={() => setShowMaint((v: boolean) => !v)}>
                {showMaint ? <EyeOff size={14} /> : <Eye size={14} />}
                {showMaint ? 'Hide maint.' : 'Show maint.'}
                {maintenanceCount > 0 && (
                  <span
                    className="chip"
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      color: 'var(--warn)',
                      background: 'color-mix(in oklab, var(--warn) 12%, transparent)',
                    }}
                  >
                    {maintenanceCount}
                  </span>
                )}
              </button>
              <ExpandingToggle
                prefix={
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      paddingLeft: 4,
                      fontSize: 12,
                      color: 'var(--ink-3)',
                    }}
                  >
                    <ArrowUpDown size={12} /> Sort
                  </span>
                }
                options={[
                  { value: 'name', label: 'Name' },
                  { value: 'status', label: 'Status' },
                ]}
                value={sortBy}
                onChange={setSortBy}
              />
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
                  const hasLat =
                    status !== 'down' &&
                    status !== 'maintenance' &&
                    ms != null
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
                          - services (workflow only): Workflows count + GPU
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
                          <div style={{ textAlign: 'right', minWidth: 0, maxWidth: '60%' }}>
                            <div className="stat-label" style={{ fontSize: 9 }}>
                              GPU
                            </div>
                            {(() => {
                              // GPU may live on the linked host record rather than
                              // the service itself — falling back keeps the card
                              // populated even before the service has been probed.
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
          <ServersMetrics servers={servers} onOpen={setDetail} kindLabel={kindLabel} />
        )}
        {tab === 'insights' && (
          <ServersInsights servers={servers} onOpen={setDetail} kindLabel={kindLabel} range={range} />
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
            // Log proxying only works for ComfyUI workflow servers — LoRA
            // backends don't expose /internal/logs nor /history. Hide for them.
            ...(s.type === 'workflow'
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
            {
              icon: <Bot size={14} />,
              label: 'Ask Seto',
              action: () => {
                setSetoOpen(s.id)
                setMenuOpen(null)
              },
              color: 'var(--accent)',
            },
            {
              icon: <Flag size={14} />,
              label: 'Report issue',
              action: () => {
                setReportOpen(s.id)
                setMenuOpen(null)
              },
              color: 'var(--bad)',
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
                zIndex: 1000,
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
      {reportOpen &&
        (() => {
          const s = servers.find((x) => x.id === reportOpen)
          if (!s) return null
          return (
            <ReportIssueModal
              server={s}
              onClose={() => setReportOpen(null)}
              kindLabel={kindLabel}
            />
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
