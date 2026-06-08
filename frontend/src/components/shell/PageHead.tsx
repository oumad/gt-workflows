/**
 * PageHead — the page banner with breadcrumbs, title, optional subtitle and a
 * right-aligned action slot.
 *
 * Breadcrumb design notes (kept in lockstep across the app):
 *  - Separator is "/", uppercase + tracking come from `.crumbs` in layout.css.
 *  - Pass either a raw string (rendered as a non-interactive label — use for
 *    section headers like "Admin" / "Brews" / "Workspace" that don't have a
 *    single page-destination) or `{ label, onClick }` for a clickable hop
 *    (use for page-name segments that navigate back up one level).
 *  - The CURRENT page's name (the last segment, typically also the h1)
 *    should usually be passed as a plain string — clicking your own current
 *    page is a no-op and confuses the affordance.
 *
 * Casing: source labels can be mixed-case; the `.crumbs` rule uppercases at
 * render time so "Workflows" + "WORKFLOWS" look identical to the user. Prefer
 * plain mixed-case sources so screen readers don't shout.
 */

type Crumb = string | { label: string; onClick: () => void }

type Props = {
  title: string
  sub?: string
  crumbs?: Crumb[]
  actions?: React.ReactNode
}

export function PageHead({ title, sub, crumbs, actions }: Props) {
  return (
    <div className="page-head">
      <div>
        {crumbs && crumbs.length > 0 && (
          <div className="crumbs">
            {crumbs.map((c, i) => {
              const label = typeof c === 'string' ? c : c.label
              const onClick = typeof c === 'string' ? undefined : c.onClick
              return (
                <span key={i} className="crumbs-item">
                  {i > 0 && (
                    <span className="crumbs-sep" aria-hidden>
                      /
                    </span>
                  )}
                  {onClick ? (
                    <button type="button" className="crumbs-link" onClick={onClick}>
                      {label}
                    </button>
                  ) : (
                    <span className="crumbs-static">{label}</span>
                  )}
                </span>
              )
            })}
          </div>
        )}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && (
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap', flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  )
}
