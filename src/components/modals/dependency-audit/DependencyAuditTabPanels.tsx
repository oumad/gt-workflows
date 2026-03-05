import { memo } from 'react'
import type { DisplayResult, AuditPhase } from './types'
import { sortMissingFirst } from './utils'
import { DependencyAuditServerBlock } from './DependencyAuditPrimitives'
import { DependencyAuditItemRow } from './DependencyAuditPrimitives'

interface TabPanelProps {
  displayResults: DisplayResult[]
  phase: AuditPhase
  loading: boolean
  collapsedServers: Set<string>
  onToggleServer: (key: string) => void
}

function NodesTabInner({ displayResults, phase, loading, collapsedServers, onToggleServer }: TabPanelProps): React.ReactElement {
  const multiServer = displayResults.length > 1
  const suffix = ':nodes'
  return (
    <>
      {displayResults.map((result) => {
        const key = result.serverUrl + suffix
        const collapsed = collapsedServers.has(key)
        const nodes = phase === 'done' ? sortMissingFirst(result.nodes) : result.nodes
        return (
          <DependencyAuditServerBlock
            key={result.serverUrl}
            serverUrl={result.serverUrl}
            collapsed={collapsed}
            onToggle={() => onToggleServer(key)}
            showHeader={multiServer}
          >
            <>
              {result.nodeError && <div className="dep-audit-error">{result.nodeError}</div>}
              {result.nodes.length > 0 && (
                <div className="dep-audit-list">
                  {nodes.map((node) => (
                    <DependencyAuditItemRow key={node.name} name={node.name} available={node.available} />
                  ))}
                </div>
              )}
              {result.nodes.length === 0 && !loading && (
                <div className="dep-audit-empty">No custom node types found in workflow.</div>
              )}
            </>
          </DependencyAuditServerBlock>
        )
      })}
    </>
  )
}

function ModelsTabInner({ displayResults, phase, loading, collapsedServers, onToggleServer }: TabPanelProps): React.ReactElement {
  const multiServer = displayResults.length > 1
  const suffix = ':models'
  return (
    <>
      {displayResults.map((result) => {
        const key = result.serverUrl + suffix
        const collapsed = collapsedServers.has(key)
        const modelCategories = Object.entries(result.models).filter(([, items]) => items.length > 0)
        return (
          <DependencyAuditServerBlock
            key={result.serverUrl}
            serverUrl={result.serverUrl}
            collapsed={collapsed}
            onToggle={() => onToggleServer(key)}
            showHeader={multiServer}
          >
            <>
              {modelCategories.map(([category, items]) => {
                const sorted = phase === 'done' ? sortMissingFirst(items) : items
                return (
                  <div key={category} className="dep-audit-category">
                    <div className="dep-audit-category-header">{category} ({items.length})</div>
                    <div className="dep-audit-list">
                      {sorted.map((model) => (
                        <DependencyAuditItemRow key={model.name} name={model.name} available={model.available} />
                      ))}
                    </div>
                  </div>
                )
              })}
              {modelCategories.length === 0 && !loading && (
                <div className="dep-audit-empty">No model references found in workflow.</div>
              )}
            </>
          </DependencyAuditServerBlock>
        )
      })}
    </>
  )
}

const INPUT_HINT = 'Input files referenced in the workflow. These may be placeholders replaced at runtime.'

function InputsTabInner({ displayResults, phase, loading, collapsedServers, onToggleServer }: TabPanelProps): React.ReactElement {
  const multiServer = displayResults.length > 1
  const suffix = ':inputs'
  return (
    <>
      <div className="dep-audit-input-hint">{INPUT_HINT}</div>
      {displayResults.map((result) => {
        const key = result.serverUrl + suffix
        const collapsed = collapsedServers.has(key)
        const files = phase === 'done' ? sortMissingFirst(result.files) : result.files
        return (
          <DependencyAuditServerBlock
            key={result.serverUrl}
            serverUrl={result.serverUrl}
            collapsed={collapsed}
            onToggle={() => onToggleServer(key)}
            showHeader={multiServer}
          >
            <>
              {result.files.length > 0 ? (
                <div className="dep-audit-list">
                  {files.map((file) => (
                    <DependencyAuditItemRow
                      key={file.name}
                      name={file.name}
                      available={file.available}
                      variant={file.available === false ? 'warn' : 'default'}
                    />
                  ))}
                </div>
              ) : !loading && (
                <div className="dep-audit-empty">No input file references found in workflow.</div>
              )}
            </>
          </DependencyAuditServerBlock>
        )
      })}
    </>
  )
}

export const DependencyAuditNodesTab = memo(NodesTabInner)
export const DependencyAuditModelsTab = memo(ModelsTabInner)
export const DependencyAuditInputsTab = memo(InputsTabInner)
