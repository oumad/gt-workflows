import { X, Play, Loader, CheckCircle, XCircle } from 'lucide-react'
import type { Phase } from '@/hooks/useTestWorkflow'

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Ready to test',
  connecting: 'Connecting...',
  submitting: 'Submitting prompt...',
  queued: 'Queued',
  executing: 'Executing',
  completed: 'Completed',
  error: 'Error',
  cancelled: 'Cancelled',
}

const SERVER_URL_STYLE: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: '0.75rem',
  opacity: 0.6,
  fontFamily: "'Courier New', monospace",
}

interface TestWorkflowModalHeaderProps {
  serverUrls: string[]
  selectedServer: string
  isRunning: boolean
  onServerChange: (url: string) => void
  onClose: () => void
}

export function TestWorkflowModalHeader({
  serverUrls,
  selectedServer,
  isRunning,
  onServerChange,
  onClose,
}: TestWorkflowModalHeaderProps): React.ReactElement {
  return (
    <div className="test-wf-modal-header">
      <div className="test-wf-modal-title">
        <Play size={20} />
        <h2 id="test-workflow-modal-title">Test Workflow</h2>
      </div>
      <div className="test-wf-modal-actions">
        {serverUrls.length > 1 && (
          <select
            className="test-wf-server-select"
            value={selectedServer}
            onChange={(e) => onServerChange(e.target.value)}
            disabled={isRunning}
          >
            {serverUrls.map((url) => (
              <option key={url} value={url}>
                {url}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="test-wf-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  )
}

interface TestWorkflowStatusBannerProps {
  phase: Phase
  isRunning: boolean
  serverUrls: string[]
  selectedServer: string
  doneCount: number
  totalCount: number
}

export function TestWorkflowStatusBanner({
  phase,
  isRunning,
  serverUrls,
  selectedServer,
  doneCount,
  totalCount,
}: TestWorkflowStatusBannerProps): React.ReactElement {
  const label =
    phase === 'executing'
      ? `${PHASE_LABELS[phase]} (${doneCount}/${totalCount})`
      : PHASE_LABELS[phase]
  return (
    <div className={`test-wf-status-banner ${phase}`}>
      {isRunning && (
        <span className="icon-spinner-wrap">
          <Loader size={14} className="spinner" />
        </span>
      )}
      {phase === 'completed' && <CheckCircle size={14} />}
      {phase === 'error' && <XCircle size={14} />}
      <span>{label}</span>
      {serverUrls.length <= 1 && selectedServer && (
        <span style={SERVER_URL_STYLE}>{selectedServer}</span>
      )}
    </div>
  )
}
