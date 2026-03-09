import { useState } from 'react'
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { ServerLogsBody, type ServerLogsViewMode } from '@/components/logs/ServerLogsBody'

interface TestWorkflowLogsPanelProps {
  logContent: string | null
  logContentType: 'text/plain' | 'text/html' | null
  logLoading: boolean
  logError: string | null
  viewMode: ServerLogsViewMode
  onViewModeChange: (mode: ServerLogsViewMode) => void
  onRefresh: () => void
}

export function TestWorkflowLogsPanel({
  logContent,
  logContentType,
  logLoading,
  logError,
  viewMode,
  onViewModeChange,
  onRefresh,
}: TestWorkflowLogsPanelProps): React.ReactElement {
  return (
    <div className="test-wf-logs-panel">
      <div className="test-wf-logs-toolbar">
        {logContentType !== 'text/html' && (
          <button
            type="button"
            className="btn btn-toolbar"
            onClick={() => onViewModeChange(viewMode === 'raw' ? 'formatted' : 'raw')}
            title={viewMode === 'raw' ? 'Show formatted log view (timestamp | message)' : 'Show raw JSON'}
          >
            {viewMode === 'raw' ? 'Raw' : 'Formatted'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-toolbar"
          onClick={onRefresh}
          disabled={logLoading}
        >
          <RefreshCw size={14} className={logLoading ? 'spin' : ''} />
          Refresh
        </button>
      </div>
      <ServerLogsBody
        content={logContent}
        contentType={logContentType ?? 'text/plain'}
        loading={logLoading}
        error={logError}
        viewMode={viewMode}
      />
    </div>
  )
}

interface TestWorkflowErrorPanelProps {
  message: string
  nodeId?: string
  nodeType?: string
  details?: unknown
  traceback?: string | string[] | null
}

const ERROR_DETAILS_STYLE: React.CSSProperties = { fontSize: '0.75rem' }

export function TestWorkflowErrorPanel({
  message,
  nodeId,
  nodeType,
  details,
  traceback,
}: TestWorkflowErrorPanelProps): React.ReactElement {
  const [showTraceback, setShowTraceback] = useState(false)
  const tracebackText =
    traceback != null
      ? Array.isArray(traceback)
        ? traceback.join('')
        : traceback
      : ''

  return (
    <div className="test-wf-error-panel">
      <div className="test-wf-error-message">{message}</div>
      {nodeId && (
        <div className="test-wf-error-node">
          Node: #{nodeId} ({nodeType ?? 'unknown'})
        </div>
      )}
      {details != null && (
        typeof details === 'string'
          ? <div className="test-wf-error-node" style={ERROR_DETAILS_STYLE}>{details}</div>
          : <div className="test-wf-error-traceback" style={ERROR_DETAILS_STYLE}>{JSON.stringify(details, null, 2)}</div>
      )}
      {tracebackText && (
        <>
          <button
            type="button"
            className="test-wf-error-traceback-toggle"
            onClick={() => setShowTraceback(!showTraceback)}
          >
            {showTraceback ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showTraceback ? 'Hide' : 'Show'} traceback
          </button>
          {showTraceback && (
            <div className="test-wf-error-traceback">{tracebackText}</div>
          )}
        </>
      )}
    </div>
  )
}
