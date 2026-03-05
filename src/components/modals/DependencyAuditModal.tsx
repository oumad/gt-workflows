import { X, Package, RefreshCw, Loader, Blocks, HardDrive, Image as ImageIcon } from 'lucide-react'
import type { WorkflowJson } from '@/types'
import { formatDateTimeWithSeconds } from '@/utils/dateFormat'
import type { DependencyAuditCache } from './dependency-audit/types'
import { useDependencyAudit } from './dependency-audit/useDependencyAudit'
import { DependencyAuditTabBadge, DependencyAuditSummary } from './dependency-audit/DependencyAuditTabUI'
import {
  DependencyAuditNodesTab,
  DependencyAuditModelsTab,
  DependencyAuditInputsTab,
} from './dependency-audit/DependencyAuditTabPanels'
import './DependencyAuditModal.css'

export type { DependencyAuditCache }

interface DependencyAuditModalProps {
  workflowJson: WorkflowJson
  serverUrls: string[]
  cached: DependencyAuditCache | null
  onCacheUpdate: (cache: DependencyAuditCache) => void
  onClose: () => void
}

export default function DependencyAuditModal({
  workflowJson,
  serverUrls,
  cached,
  onCacheUpdate,
  onClose,
}: DependencyAuditModalProps): React.ReactElement {
  const {
    displayResults,
    loading,
    phase,
    error,
    lastAuditTime,
    collapsedServers,
    revealProgress,
    activeTab,
    tabCounts,
    showSummary,
    runAudit,
    setActiveTab,
    toggleServer,
  } = useDependencyAudit({ workflowJson, serverUrls, cached, onCacheUpdate })

  const showInputsTab =
    tabCounts.inputs.total > 0 || displayResults.some((r) => r.files.length > 0)

  return (
    <div className="modal-overlay modal-overlay--blur" onClick={onClose}>
      <div className="modal-content dep-audit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="dep-audit-modal-title">
            <Package size={20} />
            <h2>Dependency Audit</h2>
          </div>
          <div className="dep-audit-modal-actions">
            <button
              className="btn btn-toolbar"
              onClick={runAudit}
              disabled={loading}
              title="Re-audit"
            >
              <span className="icon-spinner-wrap">
                <RefreshCw size={14} className={loading ? 'spinner' : ''} />
              </span>
              <span>Re-audit</span>
            </button>
            <button className="modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="dep-audit-tabs">
          <button
            className={`dep-audit-tab ${activeTab === 'nodes' ? 'active' : ''}`}
            onClick={() => setActiveTab('nodes')}
          >
            <Blocks size={15} />
            <span>Custom Nodes</span>
            {showSummary && (
              <DependencyAuditTabBadge counts={tabCounts.nodes} />
            )}
          </button>
          <button
            className={`dep-audit-tab ${activeTab === 'models' ? 'active' : ''}`}
            onClick={() => setActiveTab('models')}
          >
            <HardDrive size={15} />
            <span>Models</span>
            {showSummary && (
              <DependencyAuditTabBadge counts={tabCounts.models} />
            )}
          </button>
          {showInputsTab && (
            <button
              className={`dep-audit-tab ${activeTab === 'inputs' ? 'active' : ''}`}
              onClick={() => setActiveTab('inputs')}
            >
              <ImageIcon size={15} />
              <span>Inputs</span>
              {showSummary && (
                <DependencyAuditTabBadge counts={tabCounts.inputs} soft />
              )}
            </button>
          )}
        </div>

        <div className="modal-body dep-audit-modal-content">
          {error && <div className="dep-audit-error">{error}</div>}

          {loading && revealProgress && (
            <div className="dep-audit-progress">
              <span className="icon-spinner-wrap">
                <Loader size={14} className="spinner" />
              </span>
              <span>{revealProgress}</span>
            </div>
          )}

          {showSummary && lastAuditTime && (
            <div className="dep-audit-timestamp">
              Last audited: {formatDateTimeWithSeconds(lastAuditTime)}
            </div>
          )}

          {activeTab === 'nodes' && (
            <>
              {showSummary && (
                <DependencyAuditSummary
                  counts={tabCounts.nodes}
                  variant="nodes"
                />
              )}
              <DependencyAuditNodesTab
                displayResults={displayResults}
                phase={phase}
                loading={loading}
                collapsedServers={collapsedServers}
                onToggleServer={toggleServer}
              />
            </>
          )}

          {activeTab === 'models' && (
            <>
              {showSummary && (
                <DependencyAuditSummary
                  counts={tabCounts.models}
                  variant="models"
                />
              )}
              <DependencyAuditModelsTab
                displayResults={displayResults}
                phase={phase}
                loading={loading}
                collapsedServers={collapsedServers}
                onToggleServer={toggleServer}
              />
            </>
          )}

          {activeTab === 'inputs' && (
            <>
              {showSummary && (
                <DependencyAuditSummary
                  counts={tabCounts.inputs}
                  variant="inputs"
                />
              )}
              <DependencyAuditInputsTab
                displayResults={displayResults}
                phase={phase}
                loading={loading}
                collapsedServers={collapsedServers}
                onToggleServer={toggleServer}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
