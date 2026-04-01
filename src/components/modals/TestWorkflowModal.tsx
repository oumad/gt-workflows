import { useState, useMemo, useEffect, useCallback } from 'react'
import { Play, StopCircle, CheckCircle, XCircle, FastForward, List, ScrollText, RotateCcw } from 'lucide-react'
import type {
  TestWorkflowState,
  TestWorkflowActions,
  NodeState,
} from '@/hooks/useTestWorkflow'
import { useTestWorkflowLogs } from '@/hooks/useTestWorkflowLogs'
import type { ServerLogsViewMode } from '@/components/logs/ServerLogsBody'
import { TestWorkflowModalHeader, TestWorkflowStatusBanner } from './test-workflow/TestWorkflowHeader'
import { TestWorkflowNodeList } from './test-workflow/TestWorkflowNodeList'
import { TestWorkflowLogsPanel, TestWorkflowErrorPanel } from './test-workflow/TestWorkflowPanels'
import './TestWorkflowModal.css'

const TAB_NODES = 'nodes' as const
const TAB_LOGS = 'logs' as const
type Tab = typeof TAB_NODES | typeof TAB_LOGS

const IDLE_NODE_COUNT_STYLE: React.CSSProperties = { fontSize: '0.75rem' }

export interface TestWorkflowModalProps {
  state: TestWorkflowState
  actions: TestWorkflowActions
  isRunning: boolean
  workflowNodeCount: number
  serverUrls: string[]
  onClose: () => void
}

export function TestWorkflowModal({
  state,
  actions,
  isRunning,
  workflowNodeCount,
  serverUrls,
  onClose,
}: TestWorkflowModalProps): React.ReactElement {
  const { phase, nodes, executionOrder, errorInfo, selectedServer, retryAttempt, retryTotal } = state
  const { startTest, cancelTest, setSelectedServer } = actions
  const [activeTab, setActiveTab] = useState<Tab>(TAB_NODES)

  const {
    logContent,
    logContentType,
    logLoading,
    logError,
    loadLogs,
    clearLogs,
  } = useTestWorkflowLogs(selectedServer)
  const [logsViewMode, setLogsViewMode] = useState<ServerLogsViewMode>('formatted')

  const loadLogsWhenOnLogsTab = useCallback((): void => {
    if (activeTab === TAB_LOGS && logContent == null && !logLoading) {
      loadLogs()
    }
  }, [activeTab, logContent, logLoading, loadLogs])

  useEffect(() => {
    loadLogsWhenOnLogsTab()
  }, [loadLogsWhenOnLogsTab])

  const sortedNodes = useMemo(() => {
    const executed = executionOrder
      .map((id) => nodes.get(id))
      .filter((n): n is NodeState => !!n)
    const executedIds = new Set(executionOrder)
    const pending = Array.from(nodes.values())
      .filter((n) => !executedIds.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    return [...executed, ...pending]
  }, [nodes, executionOrder])

  const counts = useMemo(() => {
    let done = 0
    let cached = 0
    let errored = 0
    let total = 0
    for (const node of nodes.values()) {
      total++
      if (node.status === 'done') done++
      else if (node.status === 'cached') cached++
      else if (node.status === 'error') errored++
    }
    return { done, cached, errored, total }
  }, [nodes])

  const handleLogsTabClick = useCallback((): void => {
    setActiveTab(TAB_LOGS)
    clearLogs()
  }, [clearLogs])

  const handleNodesTabClick = useCallback((): void => {
    setActiveTab(TAB_NODES)
  }, [])

  const isDone = phase === 'done' || phase === 'error' || phase === 'cancelled'

  return (
    <div
      className="modal-overlay modal-overlay--blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-workflow-modal-title"
    >
      <div className="modal-content test-wf-modal" onClick={(e) => e.stopPropagation()}>
        <TestWorkflowModalHeader
          serverUrls={serverUrls}
          selectedServer={selectedServer}
          isRunning={isRunning}
          onServerChange={setSelectedServer}
          onClose={onClose}
        />

        {/* Scrollable area containing sticky bar + content */}
        <div className="test-wf-modal-content">
          {/* Sticky status + actions bar */}
          <div className="test-wf-sticky-bar">
            <TestWorkflowStatusBanner
              phase={phase}
              isRunning={isRunning}
              serverUrls={serverUrls}
              selectedServer={selectedServer}
              doneCount={counts.done + counts.cached}
              totalCount={counts.total}
              errorCount={counts.errored}
              retryAttempt={retryAttempt}
              retryTotal={retryTotal}
            />

            <div className="test-wf-action-bar">
              {!isRunning && (
                <button type="button" className="test-wf-start-btn" onClick={startTest}>
                  {isDone ? <RotateCcw size={13} /> : <Play size={13} />}
                  {phase === 'idle' ? 'Start Test' : 'Re-run'}
                </button>
              )}
              {isRunning && (
                <button type="button" className="test-wf-cancel-btn" onClick={cancelTest}>
                  <StopCircle size={13} />
                  Cancel
                </button>
              )}

              {counts.total > 0 && (
                <div className="test-wf-summary">
                  {counts.done > 0 && (
                    <span className="test-wf-summary-item done">
                      <CheckCircle size={11} /> {counts.done} done
                    </span>
                  )}
                  {counts.cached > 0 && (
                    <span className="test-wf-summary-item cached">
                      <FastForward size={11} /> {counts.cached} cached
                    </span>
                  )}
                  {counts.errored > 0 && (
                    <span className="test-wf-summary-item error">
                      <XCircle size={11} /> {counts.errored} error
                    </span>
                  )}
                </div>
              )}
            </div>

            {phase !== 'idle' && (
              <div className="test-wf-tabs">
                <button
                  type="button"
                  className={`test-wf-tab ${activeTab === TAB_NODES ? 'active' : ''}`}
                  onClick={handleNodesTabClick}
                >
                  <List size={13} />
                  Nodes
                  {counts.total > 0 && (
                    <span className="test-wf-tab-badge">
                      {counts.done + counts.cached}/{counts.total}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`test-wf-tab ${activeTab === TAB_LOGS ? 'active' : ''}`}
                  onClick={handleLogsTabClick}
                >
                  <ScrollText size={13} />
                  Logs
                </button>
              </div>
            )}
          </div>

          {/* Scrollable content */}
          <div className="test-wf-scroll-area">
            {phase === 'idle' && (
              <div className="test-wf-idle-message">
                Click &ldquo;Start Test&rdquo; to execute this workflow on ComfyUI
                and check for errors.
                <br />
                <span style={IDLE_NODE_COUNT_STYLE}>
                  {workflowNodeCount} nodes in workflow
                </span>
              </div>
            )}

            {phase !== 'idle' && (
              <>
                {activeTab === TAB_NODES && sortedNodes.length > 0 && (
                  <TestWorkflowNodeList sortedNodes={sortedNodes} />
                )}

                {activeTab === TAB_LOGS && (
                  <TestWorkflowLogsPanel
                    logContent={logContent}
                    logContentType={logContentType}
                    logLoading={logLoading}
                    logError={logError}
                    viewMode={logsViewMode}
                    onViewModeChange={setLogsViewMode}
                    onRefresh={loadLogs}
                  />
                )}
              </>
            )}

            {errorInfo && (
              <TestWorkflowErrorPanel
                message={errorInfo.message}
                nodeId={errorInfo.node_id}
                nodeType={errorInfo.node_type}
                details={errorInfo.details}
                traceback={errorInfo.traceback}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
