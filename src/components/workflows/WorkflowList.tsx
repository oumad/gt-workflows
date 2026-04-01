import { Link, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import type { Workflow } from '@/types'
import { RefreshCw, Edit2, CheckSquare, X, Search, ChevronDown, ChevronUp, Folder, Save, Download, MoreVertical, Plus, LayoutGrid, AlertTriangle } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableWorkflowCard } from './SortableWorkflowCard'
import { WorkflowListModals } from './WorkflowListModals'
import { useWorkflowList } from './useWorkflowList'
import { useNavGuard } from '@/contexts/NavGuardContext'

interface WorkflowListProps {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

export function WorkflowList({ workflows, loading, error, onRefresh }: WorkflowListProps) {
  const wl = useWorkflowList(workflows, onRefresh)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [stickyOffset, setStickyOffset] = useState(117)
  const navigate = useNavigate()
  const { registerGuard, unregisterGuard } = useNavGuard()
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null)

  // Register nav guard when in edit mode with unsaved changes
  useEffect(() => {
    registerGuard(() => wl.editMode && wl.editedWorkflows.size > 0)
    return () => unregisterGuard()
  }, [wl.editMode, wl.editedWorkflows.size, registerGuard, unregisterGuard])

  // Close actions menu on click outside
  useEffect(() => {
    if (!showActionsMenu) return
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) setShowActionsMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showActionsMenu])

  // Measure toolbar bottom for dynamic sticky category offset
  // Toolbar is sticky at top-14 (56px), so categories stick at 56 + toolbar height
  // Re-measure when selection mode changes (badge adds/removes height)
  useEffect(() => {
    // Use requestAnimationFrame to measure after DOM update
    const raf = requestAnimationFrame(() => {
      if (toolbarRef.current) {
        setStickyOffset(56 + toolbarRef.current.offsetHeight)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [wl.selectionMode])

  // Warn on browser tab close/refresh with unsaved edits
  useEffect(() => {
    if (!wl.editMode || wl.editedWorkflows.size === 0) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [wl.editMode, wl.editedWorkflows.size])


  if (loading && workflows.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-[#8b9aab]">
        <RefreshCw className="animate-spin" size={24} />
        <p className="text-sm">Loading workflows...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <p className="text-[#d16b6b]">{error}</p>
          <button onClick={onRefresh} className="text-sm bg-purple-700 hover:bg-purple-800 text-white py-2 px-4 rounded-md transition-colors duration-150">
            <RefreshCw size={14} className="inline mr-1.5" /> Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page Title — same visual weight as category headers */}
      <div className="px-6 pt-5 pb-2">
        <div className="flex items-center gap-3">
          <LayoutGrid size={22} className="text-purple-500/70" />
          <h1 className="text-xl font-semibold text-[#e8ecf1]">Workflows</h1>
          <span className="text-sm text-[#697784] tabular-nums">
            ({wl.filteredWorkflows.length}{wl.filteredWorkflows.length !== workflows.length ? ` / ${workflows.length}` : ''})
          </span>
          <div className="flex-1 h-px bg-[#2d3a4a]/50 ml-3" />
        </div>
      </div>

      {/* Sticky toolbar: Search + New + Menu — all aligned on one row */}
      <div ref={toolbarRef} className="sticky top-14 z-20 bg-[#0f1419] px-6 py-3 border-b border-[#2d3a4a]/40">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#697784]" />
            <input
              type="text"
              aria-label="Search workflows"
              placeholder="Search workflows..."
              value={wl.searchTerm}
              onChange={(e) => wl.setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-[#1a2332] border border-[#2d3a4a] rounded-lg text-[#e8ecf1] placeholder-[#697784] focus:outline-none focus:border-purple-500/60 transition-colors duration-150"
            />
            {wl.searchTerm && (
              <button
                onClick={() => wl.setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#697784] hover:text-[#e8ecf1] transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Actions — aligned with search */}
          {!wl.selectionMode ? (
            <>
              <button
                onClick={() => {
                  if (wl.editMode && wl.editedWorkflows.size > 0) {
                    setPendingNavTarget('/workflows/new')
                  } else {
                    navigate('/workflows/new')
                  }
                }}
                className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              >
                <Plus size={15} />
                New
              </button>

              <div ref={actionsMenuRef} className="relative flex-shrink-0">
                <button
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  className="p-2 rounded-lg text-[#697784] hover:text-[#b8c4d0] hover:bg-[#1a2332] transition-colors duration-150"
                  title="More actions"
                  aria-expanded={showActionsMenu}
                >
                  <MoreVertical size={18} />
                </button>

                {showActionsMenu && (
                  <div className="absolute right-0 mt-1 bg-[#1a2332] border border-[#2d3a4a] rounded-lg shadow-lg z-20 min-w-[170px] py-1">
                    {!wl.editMode && (
                      <button
                        onClick={() => { wl.setEditMode(true); setShowActionsMenu(false) }}
                        className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors flex items-center gap-2.5 whitespace-nowrap"
                      >
                        <Edit2 size={14} />
                        Edit Mode
                      </button>
                    )}
                    <button
                      onClick={() => { wl.enterSelectionMode(); setShowActionsMenu(false) }}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors flex items-center gap-2.5 whitespace-nowrap"
                    >
                      <CheckSquare size={14} />
                      Select Multiple
                    </button>
                    <button
                      onClick={() => { wl.handleDownloadAll(); setShowActionsMenu(false) }}
                      disabled={wl.downloadingAll || workflows.length === 0}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2.5 whitespace-nowrap"
                      title="Download all workflows as a single zip"
                    >
                      <Download size={14} />
                      {wl.downloadingAll ? 'Downloading...' : 'Download All'}
                    </button>
                    <button
                      onClick={() => { onRefresh(); setShowActionsMenu(false) }}
                      disabled={loading}
                      className="w-full text-left px-3 py-2 text-sm text-[#e8ecf1] hover:bg-[#243044] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2.5 whitespace-nowrap"
                    >
                      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                      Refresh
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-shrink-0">
              {wl.filteredWorkflows.length > 0 && (
                <button
                  onClick={wl.toggleSelectAll}
                  className="text-sm py-2 px-3 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors duration-150 flex items-center gap-1.5 border border-[#2d3a4a]"
                >
                  <CheckSquare size={14} />
                  {wl.selectedWorkflows.size === wl.filteredWorkflows.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
              {wl.selectedWorkflows.size > 0 && (
                <button
                  onClick={() => wl.setShowBulkEdit(true)}
                  className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Edit2 size={14} />
                  Edit ({wl.selectedWorkflows.size})
                </button>
              )}
              <button
                onClick={wl.exitSelectionMode}
                className="text-sm py-2 px-3 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-900/10 transition-colors duration-150 flex items-center gap-1.5 border border-[#2d3a4a]"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Selection Mode Badge */}
        {wl.selectionMode && (
          <div className="mt-2 text-sm text-[#8b9aab] bg-purple-700/10 border border-purple-700/20 rounded-lg px-3 py-2">
            {wl.selectedWorkflows.size > 0
              ? `${wl.selectedWorkflows.size} workflow${wl.selectedWorkflows.size !== 1 ? 's' : ''} selected`
              : 'Select workflows to edit'}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <p className="text-[#8b9aab]">No workflows found</p>
            <Link to="/workflows/new" className="text-sm bg-purple-700 hover:bg-purple-800 text-white py-2 px-4 rounded-lg transition-colors duration-150">
              Create Your First Workflow
            </Link>
          </div>
        ) : wl.filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <p className="text-[#8b9aab]">No workflows match &ldquo;{wl.searchTerm}&rdquo;</p>
            <button onClick={() => wl.setSearchTerm('')} className="text-sm py-2 px-4 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors border border-[#2d3a4a]">
              Clear Search
            </button>
          </div>
        ) : (
          <div className="px-6 py-4 space-y-6">
            {wl.categorizedWorkflows.map(([category, categoryWorkflows]) => {
              const isExpanded = wl.expandedCategories.has(category)
              return (
                <div key={category}>
                  {/* Category Header — sticky below navbar + toolbar */}
                  <button
                    className="w-full flex items-center gap-3 py-3 text-left group sticky z-10 bg-[#0f1419]"
                    style={{ top: `${stickyOffset}px` }}
                    onClick={() => wl.toggleCategory(category)}
                    aria-expanded={isExpanded}
                    aria-controls={`category-${category}`}
                  >
                    <Folder size={22} className="text-purple-500/70" />
                    <span className="text-xl font-semibold text-[#e8ecf1]">{category}</span>
                    <span className="text-sm text-[#697784]">({categoryWorkflows.length})</span>
                    <div className="flex-1 h-px bg-[#2d3a4a]/50 ml-3" />
                    <span className="text-[#697784] group-hover:text-[#b8c4d0] transition-colors">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </span>
                  </button>

                  {/* Category Content */}
                  {isExpanded && (
                    <div id={`category-${category}`} className="mt-2">
                      {wl.editMode ? (
                        <DndContext sensors={wl.sensors} collisionDetection={closestCenter} onDragEnd={wl.handleDragEnd}>
                          <SortableContext items={categoryWorkflows.map(w => w.name)} strategy={verticalListSortingStrategy}>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {categoryWorkflows.map((workflow) => (
                                <SortableWorkflowCard
                                  key={workflow.name}
                                  workflow={workflow}
                                  isSelected={wl.selectedWorkflows.has(workflow.name)}
                                  selectionMode={wl.selectionMode}
                                  editMode={wl.editMode}
                                  editedParams={wl.editedWorkflows.get(workflow.name) || {}}
                                  onToggleSelection={wl.toggleSelection}
                                  onDownload={wl.handleDownload}
                                  onDuplicate={wl.handleDuplicate}
                                  onViewLogs={wl.openServerLogs}
                                  onFieldChange={wl.handleFieldChange}
                                  onComfyServerChange={wl.handleComfyServerChange}
                                  uiState={wl.workflowDetailUI[workflow.name]}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {categoryWorkflows.map((workflow) => (
                            <SortableWorkflowCard
                              key={workflow.name}
                              workflow={workflow}
                              isSelected={wl.selectedWorkflows.has(workflow.name)}
                              selectionMode={wl.selectionMode}
                              editMode={wl.editMode}
                              editedParams={{}}
                              onToggleSelection={wl.toggleSelection}
                              onDownload={wl.handleDownload}
                              onDuplicate={wl.handleDuplicate}
                              onViewLogs={wl.openServerLogs}
                              onFieldChange={wl.handleFieldChange}
                              onComfyServerChange={wl.handleComfyServerChange}
                              uiState={wl.workflowDetailUI[workflow.name]}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            <WorkflowListModals
              editingWorkflow={wl.editingWorkflow}
              onCloseQuickEdit={() => wl.setEditingWorkflow(null)}
              onSaveQuickEdit={() => { wl.setEditingWorkflow(null); onRefresh() }}
              showBulkEdit={wl.showBulkEdit}
              selectedWorkflowsList={wl.selectedWorkflowsList}
              onCloseBulkEdit={() => wl.setShowBulkEdit(false)}
              onSaveBulkEdit={() => { wl.setShowBulkEdit(false); wl.exitSelectionMode(); onRefresh() }}
              duplicatingWorkflow={wl.duplicatingWorkflow}
              onCloseDuplicate={() => wl.setDuplicatingWorkflow(null)}
              onSuccessDuplicate={() => { wl.setDuplicatingWorkflow(null); onRefresh() }}
              downloadingWorkflow={wl.downloadingWorkflow}
              onCloseDownload={() => wl.setDownloadingWorkflow(null)}
              logsServerUrl={wl.logsServerUrl}
              serverAliases={wl.serverAliasesFromPrefs}
              onCloseLogs={() => wl.setLogsServerUrl(null)}
            />
          </div>
        )}
      </div>

      {/* Edit Mode Footer */}
      {wl.editMode && (
        <div className="sticky bottom-0 z-10 bg-[#1a2332] border-t border-[#2d3a4a] px-6 py-3">
          {wl.saveError && (
            <div className="bg-red-900/20 border border-red-800/30 text-red-300 text-sm rounded-lg p-2.5 mb-2" role="alert">
              <p>{wl.saveError}</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#8b9aab]">
              {wl.editedWorkflows.size === 0
                ? 'Drag cards to reorder or edit fields.'
                : `${wl.editedWorkflows.size} workflow${wl.editedWorkflows.size !== 1 ? 's' : ''} modified.`
              }
            </span>
            <div className="flex items-center gap-2">
              <button onClick={wl.handleCancelEdit} className="text-sm py-2 px-4 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-900/10 transition-colors border border-[#2d3a4a]">
                Cancel
              </button>
              <button
                onClick={wl.handleSaveEdits}
                disabled={wl.editedWorkflows.size === 0}
                className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Save size={14} /> Save ({wl.editedWorkflows.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes dialog — for +New button navigation */}
      {pendingNavTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[#1a2332] border border-[#2d3a4a] rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
              <h3 className="text-base font-semibold text-[#e8ecf1]">Unsaved Changes</h3>
            </div>
            <p className="text-sm text-[#8b9aab] mb-5">
              You have {wl.editedWorkflows.size} unsaved change{wl.editedWorkflows.size !== 1 ? 's' : ''}. What would you like to do?
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setPendingNavTarget(null)}
                className="text-sm py-2 px-4 rounded-lg text-[#b8c4d0] hover:bg-[#243044] transition-colors border border-[#2d3a4a]"
              >
                Stay
              </button>
              <button
                onClick={() => {
                  wl.handleCancelEdit()
                  const target = pendingNavTarget
                  setPendingNavTarget(null)
                  navigate(target)
                }}
                className="text-sm py-2 px-4 rounded-lg text-[#d16b6b] hover:bg-red-900/20 transition-colors border border-red-900/30"
              >
                Discard
              </button>
              <button
                onClick={async () => {
                  await wl.handleSaveEdits()
                  const target = pendingNavTarget
                  setPendingNavTarget(null)
                  navigate(target)
                }}
                className="text-sm bg-purple-700 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-150"
              >
                Save & Go
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
