import { ChevronRight, Workflow as WorkflowIcon } from 'lucide-react'
import type { Workflow, Server, NavigateFn } from '../../types'
import { WFCard } from './WFCard'
import { serverLabel, type CatInfo, type DragState } from './workflowsHelpers'

/** One category section in the All-workflows list: a bare collapsible
 *  header (chevron + color tag + name + count — no card container), with
 *  the workflow grid (cards layout) or table (list layout) flowing
 *  directly on the page underneath. */
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
    <section>
      {/* .section-head (layout.css): sticky, hover tint, full-width rule —
       * the chevron rotates off aria-expanded. */}
      <button className="section-head" onClick={onToggleOpen} aria-expanded={isOpen}>
        <span className="section-head-chevron">
          <ChevronRight size={15} />
        </span>
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
        {/* Wordful count so a collapsed row still says what it holds. */}
        <span className="chip">
          {cat.items.length} workflow{cat.items.length === 1 ? '' : 's'}
        </span>
      </button>

      {isOpen && (
        <div style={{ marginTop: 12 }}>
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
