import { Server, Plus, X, ListPlus, Activity, Search, Tag, ArrowUpDown, Timer, TimerOff } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import ServerLogsModal from '@/components/modals/ServerLogsModal'
import AddServerModal from '@/components/modals/AddServerModal'
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
          <button type="button" onClick={() => s.setBulkOpen((o) => !o)} className="btn btn-toolbar">
            <ListPlus size={16} /> Add Multiple
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
                <Activity size={16} className={s.isChecking ? 'spin' : ''} />
                {s.checkProgress
                  ? `${s.checkProgress.checked}/${s.checkProgress.total}`
                  : s.isChecking ? 'Checking…' : 'Check All'}
              </button>
              <button
                type="button"
                className={`btn btn-toolbar ${s.autoCheckEnabled ? 'btn-toolbar--active' : ''}`}
                onClick={() => s.setAutoCheckEnabled((v) => !v)}
                title={s.autoCheckEnabled ? 'Auto-check every 5 min (click to disable)' : 'Enable auto-check every 5 min'}
              >
                {s.autoCheckEnabled ? <Timer size={16} /> : <TimerOff size={16} />}
                {s.autoCheckEnabled ? 'Auto 5m' : 'Auto'}
              </button>
            </>
          )}
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
                        onUrlChange={s.handleServerUrlChange}
                        onAliasChange={s.handleServerAliasChange}
                        onGroupChange={s.handleServerGroupChange}
                        onViewLogs={s.setLogsServerUrl}
                        onCheck={s.checkServer}
                        onViewWorkflows={s.setWorkflowsServerUrl}
                        onEditDone={s.handleSave}
                      />
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </>
      ) : null}

      {s.bulkOpen && (
        <div className="servers-bulk-panel">
          <p className="servers-bulk-hint">
            One entry per line — <code>url</code> or <code>url, display name</code>
          </p>
          <textarea
            className="servers-bulk-textarea"
            placeholder={`http://127.0.0.1:8188\nhttp://server2:8188, Production\nhttp://server3:8188, Staging`}
            value={s.bulkText}
            onChange={(e) => s.setBulkText(e.target.value)}
            rows={5}
          />
          <div className="servers-bulk-actions">
            <button type="button" onClick={s.handleBulkAdd} className="btn btn-primary">Add servers</button>
            <button type="button" onClick={() => { s.setBulkOpen(false); s.setBulkText('') }} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      )}

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
      {s.addServerOpen && (
        <AddServerModal
          existingUrls={s.monitoredServers}
          onConfirm={s.handleAddServerConfirm}
          onCancel={() => s.setAddServerOpen(false)}
        />
      )}
    </div>
  )
}
