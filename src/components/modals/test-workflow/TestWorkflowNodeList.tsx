import { memo } from 'react'
import { Circle, CheckCircle, XCircle, Loader, FastForward } from 'lucide-react'
import type { NodeState, NodeStatus } from '@/hooks/useTestWorkflow'

function NodeIcon({ status }: { status: NodeStatus }): React.ReactElement {
  switch (status) {
    case 'pending':
      return <Circle size={14} />
    case 'cached':
      return <FastForward size={14} />
    case 'executing':
      return <Loader size={14} />
    case 'done':
      return <CheckCircle size={14} />
    case 'error':
      return <XCircle size={14} />
    default: {
      const _exhaustive: never = status
      void _exhaustive
      return <Circle size={14} />
    }
  }
}

interface TestWorkflowNodeListProps {
  sortedNodes: NodeState[]
}

function TestWorkflowNodeListInner({
  sortedNodes,
}: TestWorkflowNodeListProps): React.ReactElement {
  return (
    <div className="test-wf-node-list">
      {sortedNodes.map((node) => (
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
                    style={{
                      width: `${(node.progress.value / node.progress.max) * 100}%`,
                    }}
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
  )
}

export const TestWorkflowNodeList = memo(TestWorkflowNodeListInner)
