import { useRef, useState } from 'react'
import { Server, Plus, X, Activity, Loader2, Search, Timer, TimerOff, Upload, Download, AlertTriangle, MoreVertical, Tag } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
import ServerJobsModal from '@/components/modals/ServerJobsModal'
import ServerWorkflowsModal from '@/components/modals/ServerWorkflowsModal'
import { ServerCard } from './ServerCard'
import { MonitoringPanel } from './MonitoringPanel'
import { ServerWorkflowStats } from './ServerWorkflowStats'
import { ServerLiveStatus } from './ServerLiveStatus'
import ServerComparisonTable from './ServerComparisonTable'
import ServerDetailModal from '@/components/modals/ServerDetailModal'
import { useServers } from './useServers'
import { useMonitoring } from '@/hooks/useMonitoring'
import type { StatusFilter, SortBy } from './useServers'
import './Servers.css'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  healthy: 'Healthy',
  unhealthy: 'Unhealthy',
  unchecked: 'Unchecked',
}

const SORT_LABELS: Record<SortBy, string> = {
  default: 'Custom order',
  status: 'By status',
  name: 'By name',
  latency: 'By latency',
}

export function Servers() {
  const s = useServers()
  const monitoring = useMonitoring()
  const importRef = useRef<HTMLInputElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<{ url: string; name?: string; tags?: string[] }[] | null>(null)
  const [editingServerUrl, setEditingServerUrl] = useState<string | null>(null)
  const [jobsServerUrl, setJobsServerUrl] = useState<string | null>(null)
  const [detailServerUrl, setDetailServerUrl] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then((text) => {
      try {
        const parsed: unknown = JSON.parse(text)
        if (!Array.isArray(parsed)) return
        const entries = (parsed as unknown[])
          .filter((e) => e && typeof e === 'object' && !Array.isArray(e) && typeof (e as Record<string, unknown>).url === 'string')
          .map((e) => {
            const entry = e as Record<string, unknown>
            const rawTags = Array.isArray(entry.tags) ? entry.tags.filter((t) => typeof t === 'string') : []
            return {
              url: entry.url as string,
              name: typeof entry.name === 'string' ? entry.name : undefined,
              tags: rawTags.length > 0 ? rawTags as string[] : undefined,
            }
          })
        if (entries.length > 0) setImportPreview(entries)
      } catch {
        // ignore invalid files
      }
    })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      s.handleReorder(String(active.id), String(over.id))
    }
  }

  const showDragHandle = s.sortBy === 'default'
  const { healthy, unhealthy, unchecked } = s.statusCounts
  const hasChecked = healthy > 0 || unhealthy > 0

  const hasServers = s.displayServers.length > 0

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky header ─────────────────────────────────────────── */}
      <div className="sticky top-14 z-20 bg-primary">
        {/* Title row */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-3">
            <Server size={22} className="text-accent/70" />
            <h1 className="text-xl font-semibold text-primary m-0">Servers</h1>
            <div className="flex-1 h-px bg-default/50 ml-3" />
          </div>
        </div>
        {/* Toolbar */}
        <div className="flex items-center gap-0 px-6 py-[0.45rem] border-b border-default/40">

          {/* Search — compact fixed width */}
          <div className="relative w-[168px] shrink-0 mr-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search servers..."
              value={s.serverSearch}
              onChange={(e) => s.setServerSearch(e.target.value)}
              className="w-full pl-8 pr-6 py-[0.3rem] text-sm bg-secondary border border-default rounded-md text-primary placeholder:text-muted focus:outline-none focus:border-accent/60 transition-colors duration-150 font-[inherit]"
            />
            {s.serverSearch && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                onClick={() => s.setServerSearch('')}
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Status filter — flat inline tabs, no border container */}
          {hasServers && (
            <div className="flex items-center">
              {(['all', 'healthy', 'unhealthy', 'unchecked'] as const).map((f) => {
                const isActive = s.statusFilter === f
                const activeColor = f === 'healthy' ? 'text-semantic-success' : f === 'unhealthy' ? 'text-semantic-error' : 'text-primary'
                return (
                  <button
                    key={f}
                    type="button"
                    className={`inline-flex items-center gap-[0.25rem] px-[0.55rem] py-[0.35rem] text-sm bg-transparent border-none cursor-pointer transition-colors duration-100 whitespace-nowrap font-[inherit] leading-none rounded ${isActive ? `font-semibold ${activeColor}` : 'text-muted font-normal hover:text-secondary'}`}
                    onClick={() => s.setStatusFilter(f)}
                  >
                    {STATUS_FILTER_LABELS[f]}
                    <span className={`tabular-nums text-sm ${isActive ? 'opacity-80' : 'opacity-50'}`}>({s.statusCounts[f]})</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex-1" />

          {/* Check All */}
          {hasServers && (
            <button
              type="button"
              className="inline-flex items-center gap-[0.35rem] px-[0.65rem] py-[0.3rem] text-sm font-medium bg-transparent border border-default rounded-md text-muted cursor-pointer whitespace-nowrap leading-none transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-tertiary hover:text-primary hover:border-[#4a5d73] mr-1.5"
              onClick={s.checkAllServers}
              disabled={s.isChecking}
              title="Check health of all servers"
            >
              {s.isChecking ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
              {s.checkProgress
                ? `${s.checkProgress.checked}/${s.checkProgress.total}`
                : s.isChecking ? 'Checking…' : 'Check All'}
            </button>
          )}

          {/* Auto */}
          {hasServers && (
            <button
              type="button"
              className={`inline-flex items-center gap-[0.35rem] px-[0.65rem] py-[0.3rem] text-sm font-medium border rounded-md cursor-pointer whitespace-nowrap leading-none transition-all duration-150 mr-2 ${s.autoInterval ? 'bg-accent/[0.12] border-accent/30 text-accent hover:bg-accent/[0.2]' : 'bg-transparent border-default text-muted hover:bg-tertiary hover:text-primary hover:border-[#4a5d73]'}`}
              onClick={s.cycleAutoInterval}
              title={s.autoInterval ? `Auto every ${s.autoInterval < 60 ? `${s.autoInterval}s` : `${s.autoInterval / 60}m`} — click to cycle` : 'Auto-check off — click to enable'}
            >
              {s.autoInterval ? <Timer size={13} /> : <TimerOff size={13} />}
              {s.autoInterval
                ? s.autoInterval < 60 ? `${s.autoInterval}s` : `${s.autoInterval / 60}m`
                : 'Auto'}
            </button>
          )}

          {/* + Add */}
          <button
            type="button"
            onClick={() => s.setAddServerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-[0.3rem] text-sm font-medium bg-accent hover:bg-accent/80 text-white rounded-md transition-colors duration-150 whitespace-nowrap shrink-0"
          >
            <Plus size={14} /> Add
          </button>

          {/* More menu — sort + export/import */}
          <div ref={moreMenuRef} className="relative shrink-0 ml-1.5">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className={`p-[0.3rem] rounded-md transition-colors duration-150 ${moreOpen ? 'text-secondary bg-secondary' : 'text-muted hover:text-secondary hover:bg-secondary'}`}
              title="More options"
            >
              <MoreVertical size={15} />
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 mt-1 bg-secondary border border-default rounded-lg shadow-lg z-20 min-w-[180px] py-1">
                  {/* Sort options */}
                  <div className="px-3 py-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted/60">Sort</div>
                  {(Object.keys(SORT_LABELS) as SortBy[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`w-full text-left px-3 py-[0.35rem] text-sm transition-colors flex items-center gap-2 ${s.sortBy === k ? 'text-accent-light bg-accent/[0.06]' : 'text-secondary hover:bg-tertiary'}`}
                      onClick={() => { s.setSortBy(k); setMoreOpen(false) }}
                    >
                      {s.sortBy === k && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                      {s.sortBy !== k && <span className="w-1.5 h-1.5 shrink-0" />}
                      {SORT_LABELS[k]}
                    </button>
                  ))}
                  <div className="my-1 border-t border-default" />
                  <button
                    type="button"
                    className="w-full text-left px-3 py-[0.35rem] text-sm text-secondary hover:bg-tertiary transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => { s.handleExport(); setMoreOpen(false) }}
                    disabled={s.monitoredServers.length === 0}
                  >
                    <Download size={13} /> Export
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-[0.35rem] text-sm text-secondary hover:bg-tertiary transition-colors flex items-center gap-2"
                    onClick={() => { importRef.current?.click(); setMoreOpen(false) }}
                  >
                    <Upload size={13} /> Import
                  </button>
                </div>
              </>
            )}
          </div>
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>

        {/* Tag filter row */}
        {s.uniqueGroups.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <Tag size={12} className="text-[#697784] flex-shrink-0" />
            <button
              type="button"
              className={`inline-flex items-center gap-[0.35rem] px-[0.5rem] py-[0.2rem] text-sm font-medium border rounded-md whitespace-nowrap cursor-pointer transition-all duration-150 ${s.groupFilter === null ? 'bg-accent border-accent text-white' : 'bg-secondary border-default text-muted hover:border-accent hover:text-primary'}`}
              onClick={() => s.setGroupFilter(null)}
            >
              All
            </button>
            {s.uniqueGroups.map((g) => (
              <button
                key={g}
                type="button"
                className={`inline-flex items-center gap-[0.35rem] px-[0.5rem] py-[0.2rem] text-sm font-medium border rounded-md whitespace-nowrap cursor-pointer transition-all duration-150 ${s.groupFilter === g ? 'bg-accent border-accent text-white' : 'bg-secondary border-default text-muted hover:border-accent hover:text-primary'}`}
                onClick={() => s.setGroupFilter(s.groupFilter === g ? null : g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-4">
        {s.prefsLoaded && !hasServers ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <Server size={36} className="text-[#697784]" />
            <p className="text-[#8b9aab] font-medium">No servers yet</p>
            <p className="text-sm text-[#697784] max-w-[36ch]">Add a ComfyUI server URL to monitor its health.</p>
            <button
              type="button"
              onClick={() => s.setAddServerOpen(true)}
              className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150 flex items-center gap-1.5"
            >
              <Plus size={15} /> Add Server
            </button>
          </div>
        ) : hasServers ? (
          <div className="flex flex-col gap-4">
            <MonitoringPanel
              config={monitoring.config}
              checking={monitoring.checking}
              serverAliases={s.serverAliases}
              onCheckNow={monitoring.checkNow}
              onUpdateInterval={monitoring.updateInterval}
            />

            {s.filteredServers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <Search size={32} className="text-[#697784]" />
                <p className="text-[#8b9aab]">No servers match your filter</p>
                <button
                  type="button"
                  className="text-sm py-2 px-4 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors border border-[#2d3a4a]"
                  onClick={() => { s.setServerSearch(''); s.setStatusFilter('all'); s.setGroupFilter(null) }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={showDragHandle ? handleDragEnd : undefined}>
                <SortableContext items={s.filteredServers} strategy={rectSortingStrategy}>
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                    {s.filteredServers.map((server, index) => {
                      const norm = server.replace(/\/$/, '')
                      const health = s.getHealthStatus(norm)
                      const isServerChecking = health?.healthy === null
                      const realIndex = s.monitoredServers.indexOf(server)
                      return (
                        <ServerCard
                          key={server}
                          server={server}
                          index={realIndex >= 0 ? realIndex : index}
                          serverAliases={s.serverAliases}
                          serverGroups={s.serverGroups}
                          health={health ?? null}
                          wfCount={s.workflowCountPerServer[norm] ?? 0}
                          isServerChecking={isServerChecking}
                          isDuplicate={s.duplicateUrls.has(norm)}
                          queueDepth={s.queueDepths[norm]}
                          showDragHandle={showDragHandle}
                          isWatched={monitoring.isWatched(server)}
                          onRemove={s.handleRemoveServer}
                          onEdit={setEditingServerUrl}
                          onViewLogs={s.setLogsServerUrl}
                          onCheck={s.checkServer}
                          onViewWorkflows={s.setWorkflowsServerUrl}
                          onViewJobs={setJobsServerUrl}
                          onToggleWatch={monitoring.toggleWatched}
                          onViewDetail={setDetailServerUrl}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            <ServerLiveStatus
              servers={s.monitoredServers}
              onViewDetail={setDetailServerUrl}
            />
            <ServerComparisonTable
              onViewDetail={setDetailServerUrl}
            />
            <ServerWorkflowStats />
          </div>
        ) : null}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {s.logsServerUrl && (
        <ServerLogsModal serverUrl={s.logsServerUrl} serverAliases={s.serverAliases} onClose={() => s.setLogsServerUrl(null)} />
      )}
      {s.workflowsServerUrl && (
        <ServerWorkflowsModal
          serverUrl={s.workflowsServerUrl}
          serverAliases={s.serverAliases}
          workflows={s.workflows}
          onClose={() => s.setWorkflowsServerUrl(null)}
        />
      )}
      {jobsServerUrl && (
        <ServerJobsModal
          serverUrl={jobsServerUrl}
          serverAliases={s.serverAliases}
          onClose={() => setJobsServerUrl(null)}
        />
      )}
      {detailServerUrl && (
        <ServerDetailModal
          serverUrl={detailServerUrl}
          onClose={() => setDetailServerUrl(null)}
        />
      )}
      {s.addServerOpen && (
        <AddServerModal
          existingUrls={s.monitoredServers}
          onConfirm={s.handleAddServerConfirm}
          onCancel={() => s.setAddServerOpen(false)}
        />
      )}
      {editingServerUrl && (
        <AddServerModal
          existingUrls={s.monitoredServers}
          initialValues={{
            url: editingServerUrl,
            name: s.serverAliases[editingServerUrl],
            tags: s.serverGroups[editingServerUrl.replace(/\/$/, '')],
          }}
          onConfirm={(result) => { s.handleEditServer(editingServerUrl, result); setEditingServerUrl(null) }}
          onCancel={() => setEditingServerUrl(null)}
        />
      )}

      {importPreview && (
        <div className="modal-overlay" onClick={() => setImportPreview(null)}>
          <div className="modal-content max-w-[480px] w-full" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Upload size={18} /> Import Servers</h2>
              <button type="button" className="modal-close" onClick={() => setImportPreview(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="flex items-start gap-[0.6rem] px-4 py-3 bg-semantic-warning/[0.08] border border-semantic-warning/20 rounded-lg text-primary mb-4">
                <AlertTriangle size={16} className="text-[#f59e0b] shrink-0 mt-px" />
                <span className="text-sm">
                  This will <strong>replace</strong> all {s.monitoredServers.length} current server{s.monitoredServers.length !== 1 ? 's' : ''} with the {importPreview.length} server{importPreview.length !== 1 ? 's' : ''} from the file.
                </span>
              </div>
              <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[260px] overflow-y-auto">
                {importPreview.map((e) => (
                  <li key={e.url} className="flex items-center gap-2 px-2 py-[0.35rem] rounded-md bg-secondary text-sm">
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm text-primary">{e.url}</span>
                    {e.name && <span className="text-secondary whitespace-nowrap shrink-0">{e.name}</span>}
                    {e.tags?.map((t) => <span key={t} className="px-[0.4rem] py-[0.1rem] bg-accent/15 text-accent rounded text-xs shrink-0">{t}</span>)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-cancel" onClick={() => setImportPreview(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { s.handleImport(importPreview); setImportPreview(null) }}
              >
                <Upload size={14} /> Import {importPreview.length} server{importPreview.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
