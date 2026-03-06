import { Link } from 'react-router-dom'
import type { Workflow } from '@/types'
import { RefreshCw, Edit2, CheckSquare, X, Search, ChevronDown, ChevronUp, Folder, Save, LayoutGrid } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableWorkflowCard } from './SortableWorkflowCard'
import { WorkflowListModals } from './WorkflowListModals'
import { useWorkflowList } from './useWorkflowList'
import './WorkflowList.css'

interface WorkflowListProps {
  workflows: Workflow[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

export function WorkflowList({ workflows, loading, error, onRefresh }: WorkflowListProps) {
  const wl = useWorkflowList(workflows, onRefresh)

  if (loading) {
    return (
      <div className="loading-container">
        <RefreshCw className="spinner" size={32} />
        <p>Loading workflows...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={onRefresh} className="btn btn-primary">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    )
  }

  return (
    <div className="workflow-list">
      <header className="list-header page-toolbar">
        <div className="header-left">
          <h1 className="page-title">
            <LayoutGrid size={24} />
            Workflows ({wl.filteredWorkflows.length}
            {wl.searchTerm && wl.filteredWorkflows.length !== workflows.length && ` of ${workflows.length}`})
          </h1>
          {wl.selectionMode && (
            <span className="selection-mode-badge">
              {wl.selectedWorkflows.size > 0
                ? `${wl.selectedWorkflows.size} selected`
                : 'Select workflows to edit'}
            </span>
          )}
        </div>
        <div className="search-container">
          <div className="search-input-wrapper">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              aria-label="Search workflows"
              placeholder="Search workflows..."
              value={wl.searchTerm}
              onChange={(e) => wl.setSearchTerm(e.target.value)}
              className="search-input"
            />
            {wl.searchTerm && (
              <button onClick={() => wl.setSearchTerm('')} className="search-clear" title="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="header-actions">
          {!wl.selectionMode ? (
            <>
              <button
                onClick={() => wl.setEditMode(!wl.editMode)}
                className={`btn ${wl.editMode ? 'btn-primary' : 'btn-secondary'}`}
                title={wl.editMode ? 'Exit edit mode' : 'Enter edit mode to reorder and edit workflows'}
              >
                <Edit2 size={16} />
                {wl.editMode ? 'Done Editing' : 'Edit Mode'}
              </button>
              <button onClick={wl.enterSelectionMode} className="btn btn-secondary">
                <CheckSquare size={16} /> Bulk Edit
              </button>
              <button onClick={onRefresh} className="btn btn-secondary">
                <RefreshCw size={16} /> Refresh
              </button>
            </>
          ) : (
            <>
              {wl.filteredWorkflows.length > 0 && (
                <button
                  onClick={wl.toggleSelectAll}
                  className="btn btn-secondary"
                  title={wl.selectedWorkflows.size === wl.filteredWorkflows.length ? 'Deselect all' : 'Select all'}
                >
                  <CheckSquare size={16} />
                  {wl.selectedWorkflows.size === wl.filteredWorkflows.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
              {wl.selectedWorkflows.size > 0 && (
                <button onClick={() => wl.setShowBulkEdit(true)} className="btn btn-primary">
                  <CheckSquare size={16} /> Edit {wl.selectedWorkflows.size}
                </button>
              )}
              <button onClick={wl.exitSelectionMode} className="btn btn-secondary">
                <X size={16} /> Cancel
              </button>
            </>
          )}
        </div>
      </header>

      {workflows.length === 0 ? (
        <div className="empty-state">
          <p>No workflows found</p>
          <Link to="/workflows/new" className="btn btn-primary">Create Your First Workflow</Link>
        </div>
      ) : wl.filteredWorkflows.length === 0 ? (
        <div className="empty-state">
          <p>No workflows match your search &ldquo;{wl.searchTerm}&rdquo;</p>
          <button onClick={() => wl.setSearchTerm('')} className="btn btn-secondary">Clear Search</button>
        </div>
      ) : (
        <>
          <div className={`workflow-categories ${wl.editMode ? 'edit-mode' : ''}`}>
            {wl.categorizedWorkflows.map(([category, categoryWorkflows], categoryIndex) => {
              const isExpanded = wl.expandedCategories.has(category)
              return (
                <div key={category} className="workflow-category">
                  <button
                    className="workflow-category-header"
                    onClick={() => wl.toggleCategory(category)}
                    aria-expanded={isExpanded}
                    aria-controls={`category-${category}`}
                  >
                    <div className="workflow-category-title">
                      <Folder size={18} />
                      <span className="category-name">{category}</span>
                      <span className="category-count">({categoryWorkflows.length})</span>
                    </div>
                    <div className="workflow-category-toggle">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div id={`category-${category}`} className="workflow-category-content">
                      {wl.editMode ? (
                        <DndContext sensors={wl.sensors} collisionDetection={closestCenter} onDragEnd={wl.handleDragEnd}>
                          <SortableContext items={categoryWorkflows.map(w => w.name)} strategy={verticalListSortingStrategy}>
                            <div className="workflow-grid">
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
                                  onViewLogs={wl.setLogsServerUrl}
                                  onFieldChange={wl.handleFieldChange}
                                  uiState={wl.workflowDetailUI[workflow.name]}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      ) : (
                        <div className="workflow-grid">
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
                              onViewLogs={wl.setLogsServerUrl}
                              onFieldChange={wl.handleFieldChange}
                              uiState={wl.workflowDetailUI[workflow.name]}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {categoryIndex < wl.categorizedWorkflows.length - 1 && (
                    <div className="category-separator" />
                  )}
                </div>
              )
            })}
          </div>

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
        </>
      )}

      {wl.editMode && (
        <div className="edit-mode-footer">
          {wl.saveError && (
            <div className="error-banner" role="alert" style={{ marginBottom: '8px' }}>
              <p>{wl.saveError}</p>
            </div>
          )}
          <div className="edit-mode-info">
            <span>Edit mode active. Drag cards to reorder, edit fields directly on cards.</span>
          </div>
          <div className="edit-mode-actions">
            <button onClick={wl.handleCancelEdit} className="btn btn-secondary">Cancel</button>
            <button onClick={wl.handleSaveEdits} className="btn btn-primary" disabled={wl.editedWorkflows.size === 0}>
              <Save size={16} /> Save Changes ({wl.editedWorkflows.size})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
