import { useState, useEffect, useRef } from 'react'
import { Search, Download, Users } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { SortableHeader, type SortDir } from '../../components/ui/SortableHeader'
import { Pagination } from '../../components/ui/Pagination'
import { GtUserDetailPage } from './GtUserDetailPage'
import { avatarColor, initials, relTime } from './gtUserDetailHelpers'
import { api, isAbortError } from '../../lib/api'
import type { Page } from '../../types'

type NavigateFn = (p: Page, path?: string) => void

type GtUser = {
  id: string
  externalId: string
  email: string | null
  name: string | null
  firstSeenAt: string
  lastSeenAt: string | null // derived from MAX(job.created_at)
  totalJobs: number
}

type ListResponse = {
  items: GtUser[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

type SortKey = 'name' | 'email' | 'lastSeen' | 'jobs'

type StatsResponse = {
  total: number
  active7d: number
  totalJobs: number
  avgJobsPerUser: number
}

function writeCsv(items: GtUser[]) {
  const rows = [
    ['Username', 'Email', 'Last Seen', 'Total Jobs'],
    ...items.map((u) => [
      u.name ?? '',
      u.email ?? '',
      u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleDateString() : 'Never',
      String(u.totalJobs),
    ]),
  ]
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'gt-users.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** Fetch every row matching the current query/sort and export. Pages through
 *  the API at the server's max page size (500) so the export reflects the full
 *  filtered set instead of just whatever the visible "Load more" stack reached.
 *  Returns the row count exported. Throws on fetch failure. */
const EXPORT_PAGE = 500
async function fetchAllAndExport(q: string, sort: SortKey, dir: SortDir): Promise<number> {
  const all: GtUser[] = []
  let offset = 0
  for (;;) {
    const params = new URLSearchParams({
      limit: String(EXPORT_PAGE),
      offset: String(offset),
      sort,
      dir,
    })
    if (q) params.set('q', q)
    const res = await api.get<ListResponse>(`/api/gt-users?${params}`)
    all.push(...res.items)
    if (!res.hasMore || res.items.length === 0) break
    offset += res.items.length
    // Safety stop — gt_users in this app is a few hundred at most; if a future
    // growth pushes past 10k, the user should hit a real export endpoint.
    if (all.length >= 10_000) break
  }
  writeCsv(all)
  return all.length
}

/* ─── List view ──────────────────────────────────────────────────── */
const PAGE_LIMIT = 20

function GtUsersList({ onSelect }: { onSelect: (id: string) => void }) {
  const [items, setItems] = useState<GtUser[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('jobs')
  const [dir, setDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflightRef = useRef<AbortController | null>(null)

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_LIMIT)) : null

  async function load(q: string, pg: number, sk: SortKey, sd: SortDir) {
    inflightRef.current?.abort()
    const ctrl = new AbortController()
    inflightRef.current = ctrl
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_LIMIT),
        offset: String((pg - 1) * PAGE_LIMIT),
        sort: sk,
        dir: sd,
      })
      if (q) params.set('q', q)
      const res = await api.get<ListResponse>(`/api/gt-users?${params}`, { signal: ctrl.signal })
      if (inflightRef.current !== ctrl) return
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      if (isAbortError(e)) return
      setItems([])
    } finally {
      if (inflightRef.current === ctrl) {
        setLoading(false)
        inflightRef.current = null
      }
    }
  }

  useEffect(
    () => () => {
      inflightRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    load('', 1, sort, dir)
    api
      .get<StatsResponse>('/api/gt-users/stats')
      .then(setStats)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSearch(val: string) {
    setSearch(val)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      setQuery(val)
      setPage(1)
      load(val, 1, sort, dir)
    }, 300)
  }

  function toggleSort(k: SortKey) {
    if (sort === k) {
      const nd: SortDir = dir === 'asc' ? 'desc' : 'asc'
      setDir(nd)
      setPage(1)
      load(query, 1, k, nd)
    } else {
      const nd: SortDir = k === 'name' || k === 'email' ? 'asc' : 'desc'
      setSort(k)
      setDir(nd)
      setPage(1)
      load(query, 1, k, nd)
    }
  }

  function goToPage(pg: number) {
    setPage(pg)
    load(query, pg, sort, dir)
  }

  const activePct = stats && stats.total > 0 ? Math.round((stats.active7d / stats.total) * 100) : 0
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      await fetchAllAndExport(query, sort, dir)
    } catch {
      // Surface a minimal alert; the export button restores afterwards either way.
      alert('Export failed — please retry.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHead
        crumbs={['Admin', 'GT Users']}
        title="GT Users"
        sub="Workspace directory and per-user job throughput"
        actions={
          <button
            className="btn btn-sm btn-ghost"
            onClick={handleExport}
            disabled={exporting || items.length === 0}
            title={
              total != null && items.length < total
                ? `Exports all ${total.toLocaleString()} matching rows (not just the ${items.length} loaded)`
                : 'Export all matching rows as CSV'
            }
          >
            <Download size={13} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      <div className="body">
        {/* Stats */}
        <div className="grid-3" style={{ marginBottom: 16 }}>
          <div className="card card-pad">
            <div className="stat-label">Total users</div>
            <div className="stat-value">{stats?.total ?? '—'}</div>
            <span className="chip" style={{ marginTop: 8, fontSize: 10 }}>
              workspace-wide
            </span>
          </div>
          <div className="card card-pad">
            <div className="stat-label">Active · last 7 days</div>
            <div className="stat-value" style={{ color: 'var(--good)' }}>
              {stats?.active7d ?? '—'}
            </div>
            {stats && (
              <>
                <div className="bar" style={{ marginTop: 10 }}>
                  <i style={{ width: `${activePct}%`, background: 'var(--good)' }} />
                </div>
                <div
                  style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, textAlign: 'right' }}
                >
                  {activePct}%
                </div>
              </>
            )}
          </div>
          <div className="card card-pad">
            <div className="stat-label">Total jobs · all time</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>
              {stats ? stats.totalJobs.toLocaleString() : '—'}
            </div>
            {stats && (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
                avg {stats.avgJobsPerUser.toLocaleString()} / user
              </div>
            )}
          </div>
        </div>

        {/* Search + counter */}
        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <div className="search">
            <span className="search-icon">
              <Search size={14} />
            </span>
            <input
              className="input"
              placeholder="Search by username or email…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <span className="spacer" />
          {total != null && (
            <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'center' }}>
              {total} user{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Table */}
        {loading && items.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : (
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <SortableHeader<SortKey>
                    label="Username"
                    col="name"
                    cur={sort}
                    dir={dir}
                    onSort={toggleSort}
                  />
                  <SortableHeader<SortKey>
                    label="Email"
                    col="email"
                    cur={sort}
                    dir={dir}
                    onSort={toggleSort}
                  />
                  <SortableHeader<SortKey>
                    label="Last seen"
                    col="lastSeen"
                    cur={sort}
                    dir={dir}
                    onSort={toggleSort}
                    style={{ width: 130 }}
                  />
                  <SortableHeader<SortKey>
                    label="Total jobs"
                    col="jobs"
                    cur={sort}
                    dir={dir}
                    onSort={toggleSort}
                    num
                    style={{ width: 130 }}
                  />
                </tr>
              </thead>
              <tbody>
                {items.map((u) => {
                  const rel = relTime(u.lastSeenAt)
                  const color = avatarColor(u.id)
                  return (
                    <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(u.id)}>
                      <td>
                        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              flexShrink: 0,
                              background: color,
                              color: 'white',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {initials(u.name, u.email)}
                          </div>
                          <span style={{ fontWeight: 500 }}>
                            {u.name ?? <span style={{ color: 'var(--ink-3)' }}>Unnamed</span>}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{u.email ?? '—'}</td>
                      <td>
                        <span
                          className={`chip chip-${rel.tone}`}
                          style={{ fontSize: 10 }}
                          title={
                            u.lastSeenAt
                              ? new Date(u.lastSeenAt).toLocaleString(undefined, {
                                  dateStyle: 'full',
                                  timeStyle: 'medium',
                                })
                              : 'No activity recorded'
                          }
                        >
                          <span className="dot" /> {rel.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                          {u.totalJobs.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {items.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}
                    >
                      <div className="col" style={{ gap: 8, alignItems: 'center' }}>
                        <Users size={24} style={{ opacity: 0.3 }} />
                        <span>
                          {query
                            ? 'No users match your search.'
                            : 'No users yet — they appear as jobs are ingested.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {totalPages != null && totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={goToPage}
                disabled={loading}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}

/* ─── Page shell — controls list vs detail ───────────────────────── */
export function GtUsersPage({ navigate }: { navigate?: NavigateFn }) {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    // Accept both /gt-users/:id and the legacy /clients/:id (redirected at boot).
    const m = window.location.pathname.match(/^\/(?:gt-users|clients)\/([^/]+)$/)
    return m ? decodeURIComponent(m[1]) : null
  })

  function handleSelect(id: string) {
    window.history.pushState(null, '', `/gt-users/${id}`)
    setSelectedId(id)
  }

  function handleBack() {
    window.history.pushState(null, '', '/gt-users')
    setSelectedId(null)
  }

  if (selectedId) {
    return <GtUserDetailPage userId={selectedId} onBack={handleBack} navigate={navigate} />
  }

  return <GtUsersList onSelect={handleSelect} />
}
