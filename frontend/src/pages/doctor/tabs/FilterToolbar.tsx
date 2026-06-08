import { Search, X } from 'lucide-react'
import { ExpandingToggle } from '../../../components/ui/ExpandingToggle'
import { KIND_OPTIONS } from '../../jobs/JobsLiveFeed'
import { type JobKindFilter } from '../doctorHelpers'

/** Toolbar shared by both Failures and Slow tabs — kind filter + search.
 *  Mirrors the controls on the Jobs history/live pages so the shortcuts feel
 *  the same. State lives in the parent so a filter survives a tab switch. */
export function FilterToolbar({
  kindFilter,
  onKindFilter,
  query,
  onQuery,
}: {
  kindFilter: JobKindFilter
  onKindFilter: (k: JobKindFilter) => void
  query: string
  onQuery: (q: string) => void
}) {
  return (
    <>
      <div className="search" style={{ minWidth: 240, position: 'relative' }}>
        <span className="search-icon">
          <Search size={14} />
        </span>
        <input
          className="input"
          placeholder="Search id, name, user, service, reason…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          style={query ? { paddingRight: 28 } : undefined}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery('')}
            title="Clear search"
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 0,
              padding: 4,
              color: 'var(--ink-3)',
              display: 'flex',
              cursor: 'pointer',
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <ExpandingToggle options={KIND_OPTIONS} value={kindFilter} onChange={onKindFilter} />
    </>
  )
}
