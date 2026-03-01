import { useState, useMemo, useEffect, useCallback } from 'react'
import { X, Play, Square, CheckCircle, XCircle, Loader, FastForward, Circle, ChevronDown, ChevronUp, List, ScrollText, RefreshCw } from 'lucide-react'
import { fetchServerLogs } from '@/services/api/servers'
import type { TestWorkflowState, TestWorkflowActions, Phase, NodeStatus, NodeState } from '@/hooks/useTestWorkflow'
import './TestWorkflowModal.css'

interface TestWorkflowModalProps {
  state: TestWorkflowState
  actions: TestWorkflowActions
  isRunning: boolean
  workflowNodeCount: number
  serverUrls: string[]
  onClose: () => void
}

function NodeIcon({ status }: { status: NodeStatus }) {
  switch (status) {
    case 'pending': return <Circle size={14} />
    case 'cached': return <FastForward size={14} />
    case 'executing': return <Loader size={14} />
    case 'done': return <CheckCircle size={14} />
    case 'error': return <XCircle size={14} />
  }
}

type Tab = 'nodes' | 'logs'

type LogEntry = { t?: string; m?: string }

function tryParseLogEntries(content: string | null): LogEntry[] | null {
  if (content == null) return null
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const data = JSON.parse(content) as { entries?: unknown }
    const entries = data?.entries
    if (!Array.isArray(entries)) return null
    const valid = entries.every(
      (e) => e != null && typeof e === 'object' && ('t' in e || 'm' in e)
    )
    return valid ? (entries as LogEntry[]) : null
  } catch {
    return null
  }
}

function formatLogTimestamp(iso: string | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toISOString().replace('T', ' ').slice(0, 23)
  } catch {
    return String(iso)
  }
}

export default function TestWorkflowModal({ state, actions, isRunning, workflowNodeCount, serverUrls, onClose }: TestWorkflowModalProps) {
  const { phase, nodes, executionOrder, errorInfo, selectedServer } = state
  const { startTest, cancelTest, setSelectedServer } = actions
  const [showTraceback, setShowTraceback] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('nodes')

  // Logs tab state (fetched directly from ComfyUI, same as ServerLogsModal)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  const logEntries = useMemo(() => tryParseLogEntries(logContent), [logContent])

  const loadLogs = useCallback(async () => {
    if (!selectedServer) return
    setLogLoading(true)
    setLogError(null)
    try {
      const res = await fetchServerLogs(selectedServer)
      setLogContent(res.content)
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to load logs')
      setLogContent(null)
    } finally {
      setLogLoading(false)
    }
  }, [selectedServer])

  // Fetch logs when switching to the logs tab
  useEffect(() => {
    if (activeTab === 'logs' && logContent == null && !logLoading) {
      loadLogs()
    }
  }, [activeTab, logContent, logLoading, loadLogs])

  // Build sorted node list: execution order first, then remaining pending nodes
  const sortedNodes = useMemo(() => {
    const executed = executionOrder
      .map(id => nodes.get(id))
      .filter((n): n is NodeState => !!n)

    const executedIds = new Set(executionOrder)
    const pending = Array.from(nodes.values())
      .filter(n => !executedIds.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

    return [...executed, ...pending]
  }, [nodes, executionOrder])

  const counts = useMemo(() => {
    let done = 0, cached = 0, errored = 0, total = 0
    for (const node of nodes.values()) {
      total++
      if (node.status === 'done') done++
      else if (node.status === 'cached') cached++
      else if (node.status === 'error') errored++
    }
    return { done, cached, errored, total }
  }, [nodes])

  const phaseLabel: Record<Phase, string> = {
    idle: 'Ready to test',
    connecting: 'Connecting...',
    submitting: 'Submitting prompt...',
    queued: 'Queued',
    executing: `Executing (${counts.done + counts.cached}/${counts.total})`,
    completed: 'Completed',
    error: 'Error',
    cancelled: 'Cancelled',
  }

  return (
    <div className="test-wf-modal-overlay" onClick={onClose}>
      <div className="test-wf-modal" onClick={e => e.stopPropagation()}>
        <div className="test-wf-modal-header">
          <div className="test-wf-modal-title">
            <Play size={20} />
            <h2>Test Workflow</h2>
          </div>
          <div className="test-wf-modal-actions">
            {serverUrls.length > 1 && (
              <select
                className="test-wf-server-select"
                value={selectedServer}
                onChange={e => setSelectedServer(e.target.value)}
                disabled={isRunning}
              >
                {serverUrls.map(url => (
                  <option key={url} value={url}>{url}</option>
                ))}
              </select>
            )}
            <button className="test-wf-modal-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className={`test-wf-status-banner ${phase}`}>
          {isRunning && <Loader size={14} className="spinner" />}
          {phase === 'completed' && <CheckCircle size={14} />}
          {phase === 'error' && <XCircle size={14} />}
          <span>{phaseLabel[phase]}</span>
          {serverUrls.length <= 1 && selectedServer && (
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.6, fontFamily: "'Courier New', monospace" }}>
              {selectedServer}
            </span>
          )}
        </div>

        <div className="test-wf-modal-content">
          <div className="test-wf-actions">
            {!isRunning && (
              <button className="test-wf-start-btn" onClick={startTest}>
                <Play size={14} />
                {phase === 'idle' ? 'Start Test' : 'Re-test'}
              </button>
            )}
            {isRunning && (
              <button className="test-wf-cancel-btn" onClick={cancelTest}>
                <Square size={14} />
                Cancel
              </button>
            )}
          </div>

          {phase === 'idle' && (
            <div className="test-wf-idle-message">
              Click &ldquo;Start Test&rdquo; to execute this workflow on ComfyUI and check for errors.
              <br />
              <span style={{ fontSize: '0.8rem' }}>{workflowNodeCount} nodes in workflow</span>
            </div>
          )}

          {phase !== 'idle' && (
            <>
              {(counts.total > 0) && (
                <div className="test-wf-summary">
                  {counts.done > 0 && (
                    <span className="test-wf-summary-item done">
                      <CheckCircle size={12} /> {counts.done} done
                    </span>
                  )}
                  {counts.cached > 0 && (
                    <span className="test-wf-summary-item cached">
                      <FastForward size={12} /> {counts.cached} cached
                    </span>
                  )}
                  {counts.errored > 0 && (
                    <span className="test-wf-summary-item error">
                      <XCircle size={12} /> {counts.errored} error
                    </span>
                  )}
                </div>
              )}

              <div className="test-wf-tabs">
                <button
                  className={`test-wf-tab ${activeTab === 'nodes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('nodes')}
                >
                  <List size={14} />
                  Nodes
                  {counts.total > 0 && (
                    <span className="test-wf-tab-badge">{counts.done + counts.cached}/{counts.total}</span>
                  )}
                </button>
                <button
                  className={`test-wf-tab ${activeTab === 'logs' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('logs'); setLogContent(null) }}
                >
                  <ScrollText size={14} />
                  Logs
                </button>
              </div>

              {activeTab === 'nodes' && sortedNodes.length > 0 && (
                <div className="test-wf-node-list">
                  {sortedNodes.map(node => (
                    <div key={node.id} className={`test-wf-node-item ${node.status}`}>
                      <span className="test-wf-node-icon">
                        <NodeIcon status={node.status} />
                      </span>
                      <div className="test-wf-node-info">
                        <div className="test-wf-node-label">
                          <span className="test-wf-node-id">#{node.id}</span>
                          <span className="test-wf-node-class">{node.classType}</span>
                        </div>
                        {node.status === 'executing' && node.progress && (
                          <>
                            <div className="test-wf-progress-bar">
                              <div
                                className="test-wf-progress-fill"
                                style={{ width: `${(node.progress.value / node.progress.max) * 100}%` }}
                              />
                            </div>
                            <span className="test-wf-progress-text">
                              Step {node.progress.value}/{node.progress.max}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'logs' && (
                <div className="test-wf-logs-panel">
                  <div className="test-wf-logs-toolbar">
                    <button
                      className="test-wf-logs-refresh"
                      onClick={loadLogs}
                      disabled={logLoading}
                    >
                      <RefreshCw size={14} className={logLoading ? 'spin' : ''} />
                      Refresh
                    </button>
                  </div>
                  {logLoading && !logContent && (
                    <div className="test-wf-log-empty">Loading logs...</div>
                  )}
                  {logError && (
                    <div className="test-wf-log-empty">{logError}</div>
                  )}
                  {logEntries && (
                    <div className="test-wf-log-list">
                      <div className="test-wf-log-head">
                        <span className="test-wf-log-col-time">Time</span>
                        <span className="test-wf-log-col-msg">Message</span>
                      </div>
                      {logEntries.map((entry, i) => (
                        <div key={i} className="test-wf-log-row">
                          <span className="test-wf-log-col-time" title={entry.t ?? ''}>
                            {formatLogTimestamp(entry.t)}
                          </span>
                          <span className="test-wf-log-col-msg">{entry.m ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!logLoading && !logError && logContent != null && !logEntries && (
                    <pre className="test-wf-log-raw">{logContent}</pre>
                  )}
                </div>
              )}
            </>
          )}

          {errorInfo && (
            <div className="test-wf-error-panel">
              <div className="test-wf-error-message">{errorInfo.message}</div>
              {errorInfo.node_id && (
                <div className="test-wf-error-node">
                  Node: #{errorInfo.node_id} ({errorInfo.node_type || 'unknown'})
                </div>
              )}
              {errorInfo.details != null && (
                <div className="test-wf-error-node" style={{ fontSize: '0.75rem' }}>
                  {typeof errorInfo.details === 'string'
                    ? errorInfo.details
                    : JSON.stringify(errorInfo.details, null, 2)
                  }
                </div>
              )}
              {errorInfo.traceback && (
                <>
                  <button
                    className="test-wf-error-traceback-toggle"
                    onClick={() => setShowTraceback(!showTraceback)}
                  >
                    {showTraceback ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showTraceback ? 'Hide' : 'Show'} traceback
                  </button>
                  {showTraceback && (
                    <div className="test-wf-error-traceback">
                      {Array.isArray(errorInfo.traceback)
                        ? errorInfo.traceback.join('')
                        : errorInfo.traceback}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
