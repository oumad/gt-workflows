import { useRef, useState } from 'react'
import { Server, Plus, X, Activity, Loader2, Search, Tag, ArrowUpDown, Timer, TimerOff, Upload, Download, ChevronDown, AlertTriangle } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
import ServerJobsModal from '@/components/modals/ServerJobsModal'
import ServerWorkflowsModal from '@/components/modals/ServerWorkflowsModal'
import { ServerCard } from './ServerCard'
import { useServers } from './useServers'
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
  const importRef = useRef<HTMLInputElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<{ url: string; name?: string; tags?: string[] }[] | null>(null)
  const [editingServerUrl, setEditingServerUrl] = useState<string | null>(null)
  const [jobsServerUrl, setJobsServerUrl] = useState<string | null>(null)

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

  // Status summary counts for the strip (only when there's something to say)
  const { healthy, unhealthy, unchecked } = s.statusCounts
  const hasChecked = healthy > 0 || unhealthy > 0

  return (
    <div className="servers-page">
      <header className="servers-header">
        <div className="servers-header-title">
          <h1 className="page-title">
            <Server size={24} /> Servers
          </h1>
          <p className="servers-description">
            ComfyUI servers to monitor. Run health checks to see server status.
          </p>
        </div>
        <div className="servers-header-actions">
          <button type="button" onClick={() => s.setAddServerOpen(true)} className="btn btn-toolbar">
            <Plus size={16} /> Add Server
          </button>
          {s.displayServers.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-toolbar"
                onClick={s.checkAllServers}
                disabled={s.isChecking}
                title="Check health of all servers"
              >
                {s.isChecking ? <Loader2 size={16} className="spin" /> : <Activity size={16} />}
                {s.checkProgress
                  ? `${s.checkProgress.checked}/${s.checkProgress.total}`
                  : s.isChecking ? 'Checking…' : 'Check All'}
              </button>
              <button
                type="button"
                className={`btn btn-toolbar ${s.autoInterval ? 'btn-toolbar--active' : ''}`}
                onClick={s.cycleAutoInterval}
                title={s.autoInterval ? `Auto-check every ${s.autoInterval < 60 ? `${s.autoInterval}s` : `${s.autoInterval / 60}m`} — click to cycle` : 'Enable auto-check (30s / 1m / 5m)'}
              >
                {s.autoInterval ? <Timer size={16} /> : <TimerOff size={16} />}
                {s.autoInterval
                  ? s.autoInterval < 60 ? `Auto ${s.autoInterval}s` : `Auto ${s.autoInterval / 60}m`
                  : 'Auto'}
              </button>
            </>
          )}
          <span className="servers-header-sep" />
          <div className="servers-more-menu">
            <button
              type="button"
              className={`btn btn-toolbar ${moreOpen ? 'btn-toolbar--active' : ''}`}
              onClick={() => setMoreOpen((o) => !o)}
              title="More actions"
            >
              More <ChevronDown size={13} />
            </button>
            {moreOpen && (
              <>
                <div className="servers-more-backdrop" onClick={() => setMoreOpen(false)} />
                <div className="servers-more-dropdown">
                  <button
                    type="button"
                    className="servers-more-item"
                    onClick={() => { s.handleExport(); setMoreOpen(false) }}
                    disabled={s.monitoredServers.length === 0}
                  >
                    <Download size={14} /> Export
                  </button>
                  <button
                    type="button"
                    className="servers-more-item"
                    onClick={() => { importRef.current?.click(); setMoreOpen(false) }}
                  >
                    <Upload size={14} /> Import
                  </button>
                </div>
              </>
            )}
          </div>
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      </header>

      {s.prefsLoaded && s.displayServers.length === 0 ? (
        <div className="servers-empty">
          <Server size={36} />
          <p>No servers yet</p>
          <p className="servers-empty-sub">Add a ComfyUI server URL to monitor its health.</p>
        </div>
      ) : s.displayServers.length > 0 ? (
        <>
          {/* Status summary strip */}
          {hasChecked && (
            <div className="servers-summary">
              {healthy > 0 && <span className="servers-summary-item servers-summary-item--healthy">{healthy} healthy</span>}
              {unhealthy > 0 && <span className="servers-summary-item servers-summary-item--unhealthy">{unhealthy} down</span>}
              {unchecked > 0 && <span className="servers-summary-item servers-summary-item--unchecked">{unchecked} unchecked</span>}
            </div>
          )}

          <div className="servers-toolbar">
            <div className="servers-search">
              <Search size={15} className="servers-search-icon" />
              <input
                type="text"
                className="servers-search-input"
                placeholder="Search servers…"
                value={s.serverSearch}
                onChange={(e) => s.setServerSearch(e.target.value)}
              />
              {s.serverSearch && (
                <button type="button" className="servers-search-clear" onClick={() => s.setServerSearch('')} aria-label="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="servers-filter-pills">
              {(['all', 'healthy', 'unhealthy', 'unchecked'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`filter-pill filter-pill--${f} ${s.statusFilter === f ? 'filter-pill--active' : ''}`}
                  onClick={() => s.setStatusFilter(f)}
                >
                  {STATUS_FILTER_LABELS[f]}
                  <span className="filter-pill-count">{s.statusCounts[f]}</span>
                </button>
              ))}
            </div>
            <div className="servers-sort">
              <ArrowUpDown size={13} className="servers-sort-icon" />
              <select
                className="servers-sort-select"
                value={s.sortBy}
                onChange={(e) => s.setSortBy(e.target.value as SortBy)}
                aria-label="Sort servers"
              >
                {(Object.keys(SORT_LABELS) as SortBy[]).map((k) => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </div>
          </div>

          {s.uniqueGroups.length > 0 && (
            <div className="servers-group-filter">
              <Tag size={13} className="servers-group-filter-icon" />
              <button
                type="button"
                className={`filter-pill ${s.groupFilter === null ? 'filter-pill--active' : ''}`}
                onClick={() => s.setGroupFilter(null)}
              >
                All tags
              </button>
              {s.uniqueGroups.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`filter-pill filter-pill--group ${s.groupFilter === g ? 'filter-pill--active' : ''}`}
                  onClick={() => s.setGroupFilter(s.groupFilter === g ? null : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          )}

          {s.filteredServers.length === 0 ? (
            <div className="servers-empty servers-empty--filtered">
              <Search size={32} />
              <p>No servers match your filter</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { s.setServerSearch(''); s.setStatusFilter('all'); s.setGroupFilter(null) }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={showDragHandle ? handleDragEnd : undefined}>
              <SortableContext items={s.filteredServers} strategy={rectSortingStrategy}>
                <div className="servers-grid">
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
                        onRemove={s.handleRemoveServer}
                        onEdit={setEditingServerUrl}
                        onViewLogs={s.setLogsServerUrl}
                        onCheck={s.checkServer}
                        onViewWorkflows={s.setWorkflowsServerUrl}
                        onViewJobs={setJobsServerUrl}
                      />
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </>
      ) : null}

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
          <div className="modal-content import-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Upload size={18} /> Import Servers</h2>
              <button type="button" className="modal-close" onClick={() => setImportPreview(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="import-confirm-warning">
                <AlertTriangle size={16} />
                <span>
                  This will <strong>replace</strong> all {s.monitoredServers.length} current server{s.monitoredServers.length !== 1 ? 's' : ''} with the {importPreview.length} server{importPreview.length !== 1 ? 's' : ''} from the file.
                </span>
              </div>
              <ul className="import-confirm-list">
                {importPreview.map((e) => (
                  <li key={e.url} className="import-confirm-entry">
                    <span className="import-confirm-url">{e.url}</span>
                    {e.name && <span className="import-confirm-meta">{e.name}</span>}
                    {e.tags?.map((t) => <span key={t} className="import-confirm-tag">{t}</span>)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setImportPreview(null)}>Cancel</button>
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
