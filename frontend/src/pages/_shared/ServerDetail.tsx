import { useState, useEffect, useRef, type ComponentType } from 'react'
import { useTabWithUrl } from '../../hooks/useTabWithUrl'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { Boxes, Server, RefreshCw, ExternalLink, Wrench } from 'lucide-react'
import type { Server as ServerType, Workflow, NavigateFn } from '../../types'
import { findHostFor } from '../../lib/serverLinks'
import { type ServerPatch, COLOR_OPTIONS, typeAccent, serverColor } from './serverHelpers'
import { ServerStatusBadge } from './ServerBadges'
import { ServerJobs } from './ServerJobsTab'
import { ServerWorkflows } from './ServerWorkflowsTab'
import { ServerLogs } from './ServerLogsTab'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationsContext'

/**
 * Shared server-detail layout used by both the services and servers pages.
 * The per-page differences are:
 *   1. Icon and crumbs/breadcrumb label — derived from `kindLabel`.
 *   2. The "linked host" badge in the header — only shown for services (a
 *      service has a parent host; a host doesn't).
 *   3. The Overview / Settings / Actions tab bodies — page-specific. Each
 *      page passes its own components via the `components` prop.
 */

export type KindLabel = 'service' | 'server'

export interface DetailComponents {
  Overview: ComponentType<{
    server: ServerType
    servers: ServerType[]
    wfs: Workflow[]
    isAdmin: boolean
    onPatch: (patch: ServerPatch) => Promise<void>
    navigate?: NavigateFn
  }>
  Settings: ComponentType<{
    server: ServerType
    onSave: (patch: ServerPatch) => Promise<void>
  }>
  Actions: ComponentType<{
    server: ServerType
    onDelete: () => void
  }>
}

const ICON_FOR: Record<KindLabel, typeof Boxes> = {
  service: Boxes,
  server: Server,
}

const CRUMB_FOR: Record<KindLabel, string> = {
  service: 'SERVICES',
  server: 'SERVERS',
}

export function ServerDetail({
  server,
  servers,
  wfs,
  isAdmin,
  onBack,
  onPatch,
  onDelete,
  onRecheck,
  navigate,
  kindLabel,
  components,
}: {
  server: ServerType
  servers: ServerType[]
  wfs: Workflow[]
  isAdmin: boolean
  onBack: () => void
  onPatch: (patch: ServerPatch) => Promise<void>
  onDelete: () => void
  onRecheck: () => Promise<void>
  navigate?: NavigateFn
  kindLabel: KindLabel
  components: DetailComponents
}) {
  const [tab, setTab] = useTabWithUrl('overview', [
    'overview',
    'jobs',
    'workflows',
    'logs',
    'settings',
    'actions',
  ])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 })
  const [rechecking, setRechecking] = useState(false)
  const iconRef = useRef<HTMLDivElement>(null)
  const { notify } = useNotifications()
  // Snapshot the pre-recheck health so we can call out a status flip in the
  // toast — "still offline" / "recovered" / "new failure" reads better than a
  // bare status name.
  const prevStatusRef = useRef<string | null>(null)

  async function handleRecheck() {
    if (rechecking) return
    prevStatusRef.current = server.health?.status ?? null
    setRechecking(true)
    try {
      await onRecheck()
      // The parent reloads after probing, so by the next render `server` is
      // refreshed. We can't read it inline here because closures captured the
      // pre-probe value; the effect below fires the toast once the new server
      // prop lands.
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Recheck failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setRechecking(false)
    }
  }

  // Fire the recheck-complete toast after the parent has reloaded and pushed
  // the new server prop down. Guards on prevStatusRef so we only toast once
  // per recheck (and not on the initial mount).
  useEffect(() => {
    const prev = prevStatusRef.current
    if (prev === null) return
    prevStatusRef.current = null
    const next = server.health?.status ?? 'unknown'
    const recovered = prev !== 'online' && next === 'online'
    const broke = prev === 'online' && next !== 'online'
    notify({
      variant: recovered ? 'success' : next === 'online' ? 'info' : broke ? 'error' : 'warn',
      title: recovered
        ? `${server.name} is back online`
        : broke
          ? `${server.name} is now ${next}`
          : `${server.name} recheck complete`,
      body: `Status: ${next}${
        server.health?.latencyMs != null ? ` · ${server.health.latencyMs}ms` : ''
      }`,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.health?.status, server.health?.latencyMs])

  const color = serverColor(server)
  const isWorkflow = server.type !== 'lora'
  const Icon = ICON_FOR[kindLabel]
  // Linked-host badge is a services-only concept — a service has a parent
  // host; a host doesn't have one of its own.
  const linkedHost = kindLabel === 'service' ? findHostFor(server, servers) : null

  // Settings tab requires the matching edit capability — designer can
  // patch services (edit-service), but only admin/ops can patch hosts
  // (edit-server). Actions tab is admin/ops only (it owns Delete + the
  // ComfyUI control buttons).
  const { can } = useAuth()
  const canEdit = kindLabel === 'service' ? can('edit-service') : can('edit-server')
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'jobs', label: 'Jobs' },
    ...(isWorkflow ? [{ id: 'workflows', label: 'Workflows', pill: wfs.length }] : []),
    ...(isWorkflow ? [{ id: 'logs', label: 'Logs' }] : []),
    ...(canEdit ? [{ id: 'settings', label: 'Settings' }] : []),
    ...(isAdmin ? [{ id: 'actions', label: 'Actions' }] : []),
  ]

  // A deep-linked ?tab= may name a conditionally-hidden tab (e.g. 'settings'
  // without edit rights); fall back to the first rendered tab so the body is
  // never blank. (useTabWithUrl can't know the conditional set at mount.)
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id

  useEffect(() => {
    if (!pickerOpen) return
    const close = () => setPickerOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [pickerOpen])

  function openPicker(e: React.MouseEvent) {
    e.stopPropagation()
    const rect = iconRef.current?.getBoundingClientRect()
    if (rect) setPickerPos({ top: rect.bottom + 8, left: rect.left })
    setPickerOpen((o) => !o)
  }

  const Overview = components.Overview
  const Settings = components.Settings
  const Actions = components.Actions

  return (
    <>
      <PageHead
        crumbs={['Brews', { label: CRUMB_FOR[kindLabel], onClick: onBack }, server.name]}
        title={server.name}
        sub={server.url}
        actions={
          <>
            <button className="btn btn-sm" onClick={handleRecheck} disabled={rechecking}>
              <RefreshCw
                size={12}
                className={rechecking ? 'spin' : undefined}
                style={{ marginRight: 6 }}
              />
              {rechecking ? 'Rechecking…' : 'Recheck'}
            </button>
          </>
        }
      />
      <div
        className="card card-pad row"
        style={{
          gap: 16,
          alignItems: 'center',
          margin: '0 var(--gutter) 0',
          borderRadius: 0,
          borderLeft: 0,
          borderRight: 0,
          borderTop: 0,
        }}
      >
        {/* Clickable icon — opens color picker (admin only; PATCH is admin) */}
        <div ref={iconRef} style={{ flexShrink: 0 }} onClick={isAdmin ? openPicker : undefined}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 10,
              background: color,
              display: 'grid',
              placeItems: 'center',
              color: 'white',
              cursor: isAdmin ? 'pointer' : 'default',
            }}
            title={isAdmin ? 'Click to change color' : undefined}
          >
            <Icon size={22} />
          </div>
          {pickerOpen && isAdmin && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                top: pickerPos.top,
                left: pickerPos.left,
                zIndex: 1000,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                boxShadow: 'var(--shadow-lg)',
                padding: 8,
                display: 'flex',
                gap: 6,
              }}
            >
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    onPatch({ color: c })
                    setPickerOpen(false)
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    border: color === c ? '2px solid var(--ink)' : '2px solid transparent',
                    background: c,
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow:
                      color === c ? '0 0 0 2px var(--surface), 0 0 0 4px var(--ink)' : 'none',
                    transition: 'box-shadow .12s',
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          {linkedHost ? (
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                className="chip"
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  color: typeAccent(server),
                  background: `color-mix(in oklab, ${typeAccent(server)} 14%, transparent)`,
                  border: `1px solid color-mix(in oklab, ${typeAccent(server)} 40%, transparent)`,
                }}
              >
                {server.type === 'lora' ? 'LoRA' : 'Workflow'}
              </span>
              <span className="row" style={{ gap: 5, alignItems: 'center', minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{linkedHost.name}</strong>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  ({server.url})
                </span>
                {navigate && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: 22, height: 22 }}
                    title={`Open server ${linkedHost.name}`}
                    onClick={() => navigate('servers', `/servers/${linkedHost.id}`)}
                  >
                    <ExternalLink size={11} />
                  </button>
                )}
              </span>
            </div>
          ) : (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {server.url}
              </div>
            </div>
          )}
        </div>
        <ServerStatusBadge server={server} style={{ fontSize: 12 }} />
      </div>
      {server.isMaintenance && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '0 var(--gutter)',
            padding: '10px 14px',
            background: 'color-mix(in oklab, var(--warn) 18%, var(--surface))',
            borderLeft: '4px solid var(--warn)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          <Wrench size={16} style={{ color: 'var(--warn)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <strong>Maintenance mode is active for {server.name}.</strong>{' '}
            <span style={{ color: 'var(--ink-2)' }}>
              Probes don't fire alerts, the saturation heatmap colours this tile amber, and the
              status banner suppresses any "down" warnings until maintenance is turned off.
            </span>
          </div>
          {isAdmin && (
            <button
              className="btn btn-sm"
              onClick={() => onPatch({ isMaintenance: false })}
              title="Take this out of maintenance mode"
            >
              Disable maintenance
            </button>
          )}
        </div>
      )}
      <Tabs tabs={tabs} active={activeTab} onChange={setTab} />
      <div className="body">
        {activeTab === 'overview' && (
          <Overview
            server={server}
            servers={servers}
            wfs={wfs}
            isAdmin={isAdmin}
            onPatch={onPatch}
            navigate={navigate}
          />
        )}
        {activeTab === 'jobs' && <ServerJobs server={server} />}
        {activeTab === 'workflows' && (
          <ServerWorkflows wfs={wfs} navigate={navigate} kindLabel={kindLabel} />
        )}
        {activeTab === 'logs' && <ServerLogs server={server} kindLabel={kindLabel} />}
        {activeTab === 'settings' && <Settings server={server} onSave={onPatch} />}
        {activeTab === 'actions' && <Actions server={server} onDelete={onDelete} />}
      </div>
    </>
  )
}
