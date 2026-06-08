import { ChevronRight, Workflow as WorkflowIcon } from 'lucide-react'
import type { Workflow, Server, NavigateFn } from '../../types'
import { WFCard } from './WFCard'
import { serverLabel, type CatInfo, type DragState } from './workflowsHelpers'

/** One category section in the All-workflows list: clickable header that
 *  toggles open/closed, plus the workflow grid (cards layout) or table
 *  (list layout) underneath. */
export function WorkflowCategorySection({
  cat,
  isOpen,
  onToggleOpen,
  layout,
  servers,
  isAdmin,
  drag,
  setDrag,
  onOpenDetail,
  onPatch,
  onToggleDevMode,
  onReorder,
  onImport,
  onDuplicated,
  navigate,
}: {
  cat: CatInfo
  isOpen: boolean
  onToggleOpen: () => void
  layout: 'cards' | 'list'
  servers: Server[]
  isAdmin: boolean
  drag: DragState
  setDrag: (d: DragState) => void
  onOpenDetail: (wf: Workflow) => void
  onPatch: (wf: Workflow, patch: Record<string, unknown>) => void
  onToggleDevMode: (wf: Workflow) => void
  onReorder: (fromCatId: string, fromIdx: number, toCatId: string, toIdx: number) => void
  onImport?: (wf: Workflow, file: File) => void
  onDuplicated: () => void
  navigate?: NavigateFn
}) {
  return (
    <section className="card">
      <button
        className="row"
        onClick={onToggleOpen}
        style={{
          width: '100%',
          padding: '14px var(--pad)',
          background: 'transparent',
          border: 0,
          borderBottom: isOpen ? '1px solid var(--line)' : '0',
          cursor: 'default',
          textAlign: 'left',
          gap: 10,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: cat.color,
            display: 'grid',
            placeItems: 'center',
            color: 'white',
          }}
        >
          <WorkflowIcon size={12} />
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
          {cat.name}
        </span>
        <span className="chip">{cat.items.length}</span>
        <span className="spacer" />
        <span
          style={{
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform .15s',
            color: 'var(--ink-3)',
          }}
        >
          <ChevronRight size={16} />
        </span>
      </button>

      {isOpen && (
        <div className="card-pad">
          {layout === 'cards' ? (
            <div className="grid-3">
              {cat.items.map((wf, i) => (
                <WFCard
                  key={wf.id}
                  wf={wf}
                  cat={cat}
                  seed={i}
                  servers={servers}
                  isAdmin={isAdmin}
                  drag={drag}
                  setDrag={setDrag}
                  idx={i}
                  onDrop={(fromCat, fromIdx) => onReorder(fromCat, fromIdx, cat.id, i)}
                  onOpen={() => onOpenDetail(wf)}
                  onPatch={(patch) => onPatch(wf, patch)}
                  onToggleDevMode={() => onToggleDevMode(wf)}
                  onDuplicated={onDuplicated}
                  onImport={onImport ? (file) => onImport(wf, file) : undefined}
                  navigate={navigate}
                />
              ))}
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Servers</th>
                  <th>Path</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cat.items.map((wf) => (
                  <tr key={wf.id} onClick={() => onOpenDetail(wf)} style={{ cursor: 'pointer' }}>
                    <td style={{ width: 36 }}>
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: cat.color,
                          display: 'grid',
                          placeItems: 'center',
                          color: 'white',
                        }}
                      >
                        <WorkflowIcon size={11} />
                      </span>
                    </td>
                    <td>
                      <strong>{wf.name}</strong>
                    </td>
                    <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
                      {wf.description ?? '—'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {wf.serverUrls.slice(0, 2).map((url) => (
                          <span key={url} className="chip mono" style={{ fontSize: 10 }}>
                            {serverLabel(url, servers)}
                          </span>
                        ))}
                        {wf.serverUrls.length > 2 && (
                          <span className="chip" style={{ fontSize: 10 }}>
                            +{wf.serverUrls.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {wf.path}
                    </td>
                    <td>
                      <ChevronRight size={12} style={{ color: 'var(--ink-3)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
