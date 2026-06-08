import { Search } from 'lucide-react'
import type { CatInfo } from './workflowsHelpers'

/** Toolbar above the "All workflows" list: search, layout toggle, and the
 *  expand-all / collapse-all bulk controls. State lives in the page so a
 *  filter + layout choice survives across tab switches. */
export function WorkflowsToolbar({
  filter,
  onFilter,
  layout,
  onLayout,
  groups,
  setOpenCats,
}: {
  filter: string
  onFilter: (s: string) => void
  layout: 'cards' | 'list'
  onLayout: (l: 'cards' | 'list') => void
  groups: CatInfo[]
  setOpenCats: (next: Record<string, boolean>) => void
}) {
  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <div className="search">
        <span className="search-icon">
          <Search size={14} />
        </span>
        <input
          className="input"
          placeholder="Search workflows…"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      </div>
      <div className="toggle-group">
        <button className={layout === 'cards' ? 'active' : ''} onClick={() => onLayout('cards')}>
          Cards
        </button>
        <button className={layout === 'list' ? 'active' : ''} onClick={() => onLayout('list')}>
          List
        </button>
      </div>
      <span className="spacer" />
      <button
        className="btn btn-sm"
        onClick={() => setOpenCats(Object.fromEntries(groups.map((g) => [g.id, true])))}
      >
        Expand all
      </button>
      <button className="btn btn-sm" onClick={() => setOpenCats({})}>
        Collapse all
      </button>
    </div>
  )
}
