import { Workflow as WorkflowIcon } from 'lucide-react'
import type { Workflow } from '../../types'
import { type NavigateFn } from './serverHelpers'

/** Workflows assigned to one server/service. Both pages render this; the only
 *  difference is the noun ("service" vs "server") in the title and empty-state
 *  copy — passed in via `kindLabel`. */
export function ServerWorkflows({
  wfs,
  navigate,
  kindLabel,
}: {
  wfs: Workflow[]
  navigate?: NavigateFn
  kindLabel: 'service' | 'server'
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Workflows on this {kindLabel}</div>
        <span className="chip">{wfs.length}</span>
      </div>
      {wfs.length === 0 ? (
        <div className="card-pad" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
          No workflows are assigned to this {kindLabel}.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>Category</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {wfs.map((w) => (
              <tr
                key={w.id}
                onClick={() => navigate?.('workflows', `/workflows/${w.id}`)}
                style={{ cursor: navigate ? 'pointer' : 'default' }}
              >
                <td style={{ width: 30 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      background: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'white',
                    }}
                  >
                    <WorkflowIcon size={10} />
                  </span>
                </td>
                <td>
                  <strong>{w.name}</strong>
                </td>
                <td style={{ fontSize: 12 }}>{w.category}</td>
                <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{w.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
