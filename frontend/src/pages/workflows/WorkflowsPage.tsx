import { useState, useMemo, useEffect, useRef } from 'react'
import { Plus, RefreshCw, ChevronRight, Download } from 'lucide-react'
import { loadSession } from '../../lib/storage'
import { loadPrefs } from '../preferences/PreferencesPage'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { WorkflowDetail } from './WorkflowDetail'
import { useWorkflows } from '../../hooks/useWorkflows'
import { useServers } from '../../hooks/useServers'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'
import type { Workflow, NavigateFn } from '../../types'
import {
  catColor,
  workflowCategory,
  categoryName,
  compareCategories,
  type CatInfo,
  type DragState,
} from './workflowsHelpers'
import { WorkflowsInsights } from './WorkflowsInsights'
import { WorkflowsRepartition } from './WorkflowsRepartition'
import { type Range } from '../analytics/analyticsHelpers'
import { RangeSelector } from '../../components/ui/RangeSelector'
import { WorkflowsToolbar } from './WorkflowsToolbar'
import { WorkflowCategorySection } from './WorkflowCategorySection'
import { WorkflowsModalStack } from './WorkflowsModalStack'

/**
 * Workflows page — three tabs ("All", "Insights", "Repartition").
 *
 * The shell owns:
 *  - list state (filter, layout, open-categories, drag, local-order)
 *  - URL ↔ detail-id sync (/workflows/:id) + popstate handling
 *  - scroll-position restore when returning from detail
 *  - the action handlers (delete / patch / toggle / reorder / download)
 *  - modal state (create / edit / import)
 *
 * Sub-components live in sibling files:
 *  - WorkflowsToolbar         — search + layout + expand/collapse
 *  - WorkflowCategorySection  — one category card with cards-or-table rendering
 *  - WorkflowsModalStack      — the create/edit/import modals
 *  - WorkflowsInsights        — Insights tab body
 *  - WorkflowsRepartition     — Repartition tab body
 *  - WorkflowDetail           — full detail view (sub-page)
 */
export function WorkflowsPage({ navigate }: { navigate?: NavigateFn }) {
  const { user } = useAuth()
  const isAdmin = user?.isAdmin ?? false

  const { workflows, loading, error, reload } = useWorkflows()
  const { servers } = useServers()

  const [tab, setTab] = useState('all')
  const [range, setRange] = useState<Range>('7d')
  const [filter, setFilter] = useState('')
  const [layout, setLayout] = useState<'cards' | 'list'>(() => loadPrefs().workflowLayout)
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({})
  const [detailId, setDetailId] = useState<string | null>(() => {
    const m = window.location.pathname.match(/^\/workflows\/([^/]+)$/)
    return m ? m[1] : null
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Workflow | null>(null)
  const [importTarget, setImportTarget] = useState<{ wf: Workflow; file: File } | null>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [localOrder, setLocalOrder] = useState<Record<string, Workflow[]>>({})
  const [showTop, setShowTop] = useState(false)
  const scrollPosRef = useRef(0)

  const groups: CatInfo[] = useMemo(() => {
    const map = new Map<string, Workflow[]>()
    for (const w of workflows) {
      const category = workflowCategory(w)
      if (!map.has(category)) map.set(category, [])
      map.get(category)!.push(w)
    }
    return [...map.entries()]
      .sort(([a], [b]) => compareCategories(a, b))
      .map(([id, items]) => ({
        id,
        name: categoryName(id),
        color: catColor(id),
        items: localOrder[id] ?? items,
      }))
  }, [workflows, localOrder])

  const total = workflows.length

  // Derive detail from URL id — updates automatically after reload()
  const detail = useMemo<{ wf: Workflow; cat: CatInfo } | null>(() => {
    if (!detailId) return null
    for (const g of groups) {
      const wf = g.items.find((w) => w.id === detailId)
      if (wf) return { wf, cat: g }
    }
    return null
  }, [detailId, groups])

  useEffect(() => {
    if (groups.length === 0) return
    setOpenCats((prev) => {
      const next = { ...prev }
      groups.forEach((g) => {
        if (!(g.id in next)) next[g.id] = true
      })
      return next
    })
    // Deliberate: `groups` is a fresh array every render — only the SIZE
    // matters here, and the functional update reads the latest values anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length])

  useEffect(() => {
    const main = document.querySelector('.main')
    if (!main) return
    const onScroll = () => setShowTop(main.scrollTop > 400)
    main.addEventListener('scroll', onScroll)
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  // Sync browser back/forward → detailId
  useEffect(() => {
    function onPop() {
      const m = window.location.pathname.match(/^\/workflows\/([^/]+)$/)
      setDetailId(m ? m[1] : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // If detailId points to a workflow that doesn't exist, reset URL
  useEffect(() => {
    if (!loading && detailId && !detail) {
      window.history.replaceState(null, '', '/workflows')
      setDetailId(null)
    }
  }, [loading, detailId, detail])

  const filteredGroups = useMemo(() => {
    if (!filter) return groups
    const q = filter.toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (w) =>
            w.name.toLowerCase().includes(q) || (w.description ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, filter])

  // Restore scroll when returning from detail to list
  useEffect(() => {
    if (!detail && scrollPosRef.current > 0) {
      const pos = scrollPosRef.current
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.querySelector('.main')?.scrollTo({ top: pos })
        })
      })
    }
  }, [detail])

  function reorder(fromCatId: string, fromIdx: number, toCatId: string, toIdx: number) {
    setLocalOrder((prev) => {
      const fromCat = groups.find((g) => g.id === fromCatId)
      if (!fromCat) return prev
      const fromItems = (prev[fromCatId] ?? fromCat.items).slice()
      const [moved] = fromItems.splice(fromIdx, 1)
      if (fromCatId === toCatId) {
        const adj = fromIdx < toIdx ? toIdx - 1 : toIdx
        fromItems.splice(adj, 0, moved)
        fromItems.forEach((w, i) =>
          api.patch(`/api/workflows/${w.id}`, { order: i }).catch(console.error),
        )
        return { ...prev, [fromCatId]: fromItems }
      }
      const toCat = groups.find((g) => g.id === toCatId)
      const toItems = (prev[toCatId] ?? toCat?.items ?? []).slice()
      toItems.splice(toIdx, 0, { ...moved, category: toCatId })
      api.patch(`/api/workflows/${moved.id}`, { category: toCatId }).catch(console.error)
      fromItems.forEach((w, i) =>
        api.patch(`/api/workflows/${w.id}`, { order: i }).catch(console.error),
      )
      toItems.forEach((w, i) =>
        api.patch(`/api/workflows/${w.id}`, { order: i }).catch(console.error),
      )
      return { ...prev, [fromCatId]: fromItems, [toCatId]: toItems }
    })
  }

  function openDetail(wf: Workflow) {
    scrollPosRef.current = document.querySelector('.main')?.scrollTop ?? 0
    window.history.pushState(null, '', `/workflows/${wf.id}`)
    setDetailId(wf.id)
  }

  function closeDetail() {
    window.history.pushState(null, '', '/workflows')
    setDetailId(null)
  }

  async function handleDelete(wf: Workflow) {
    if (!window.confirm(`Delete "${wf.name}"? This cannot be undone.`)) return
    try {
      await api.del(`/api/workflows/${wf.id}`)
      if (detailId === wf.id) closeDetail()
      reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handlePatch(wf: Workflow, patch: Record<string, unknown>) {
    try {
      await api.patch(`/api/workflows/${wf.id}`, patch)
      reload()
    } catch (e) {
      console.error(e)
    }
  }

  async function handleToggleDevMode(wf: Workflow) {
    try {
      await api.patch(`/api/workflows/${wf.id}`, { devMode: !wf.devMode })
      reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to toggle dev mode')
    }
  }

  async function handleDownloadAll() {
    const session = loadSession()
    try {
      const resp = await fetch('/api/workflows/export', {
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      })
      if (!resp.ok) {
        alert('Export failed')
        return
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: 'workflows.zip' })
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed')
    }
  }

  /* ── Detail view ─────────────────────────────────────────── */
  if (detail) {
    return (
      <>
        <WorkflowDetail
          wf={detail.wf}
          catName={detail.cat.name}
          catColor={detail.cat.color}
          servers={servers}
          isAdmin={isAdmin}
          onBack={closeDetail}
          onDelete={() => handleDelete(detail.wf)}
          onSaved={() => reload()}
        />
        <WorkflowsModalStack
          servers={servers}
          creating={false}
          editing={editing}
          importTarget={null}
          onCloseCreating={() => setCreating(false)}
          onCloseEditing={() => setEditing(null)}
          onCloseImport={() => setImportTarget(null)}
          onReload={reload}
          onOpenDetail={openDetail}
          onCloseDetail={closeDetail}
        />
      </>
    )
  }

  /* ── Loading / error states ──────────────────────────────── */
  if (loading)
    return (
      <>
        <PageHead crumbs={['Brews', 'Workflows']} title="Workflows" sub="Loading…" />
        <div
          className="body"
          style={{ color: 'var(--ink-3)', paddingTop: 60, textAlign: 'center' }}
        >
          Loading workflows…
        </div>
      </>
    )

  if (error)
    return (
      <>
        <PageHead crumbs={['Brews', 'Workflows']} title="Workflows" sub="Error loading workflows" />
        <div className="body">
          <div
            style={{
              color: 'var(--bad)',
              background: 'var(--bad-soft)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        </div>
      </>
    )

  /* ── Main list view ──────────────────────────────────────── */
  return (
    <>
      <PageHead
        crumbs={['Brews', 'Workflows']}
        title="Workflows"
        sub={`${total} workflow${total !== 1 ? 's' : ''} across ${groups.length} categories`}
        actions={
          <>
            {(tab === 'insights' || tab === 'repartition') && (
              <RangeSelector range={range} onChange={setRange} />
            )}
            <button className="btn btn-sm" onClick={reload}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button className="btn btn-sm" onClick={handleDownloadAll}>
              <Download size={14} /> Download all
            </button>
            {isAdmin && (
              <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> New workflow
              </button>
            )}
          </>
        }
      />
      <Tabs
        tabs={[
          {
            id: 'all',
            label: 'All workflows',
            pill: filter ? filteredGroups.reduce((n, g) => n + g.items.length, 0) : total,
          },
          { id: 'insights', label: 'Insights' },
          { id: 'repartition', label: 'Repartition' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="body">
        {tab === 'all' && (
          <>
            <WorkflowsToolbar
              filter={filter}
              onFilter={setFilter}
              layout={layout}
              onLayout={setLayout}
              groups={groups}
              setOpenCats={setOpenCats}
            />

            {filteredGroups.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 60 }}>
                {filter ? 'No workflows match your search.' : 'No workflows yet.'}
              </div>
            )}

            <div className="col" style={{ gap: 18 }}>
              {filteredGroups.map((cat) => (
                <WorkflowCategorySection
                  key={cat.id}
                  cat={cat}
                  isOpen={filter ? true : !!openCats[cat.id]}
                  onToggleOpen={() => setOpenCats((o) => ({ ...o, [cat.id]: !o[cat.id] }))}
                  layout={layout}
                  servers={servers}
                  isAdmin={isAdmin}
                  drag={drag}
                  setDrag={setDrag}
                  onOpenDetail={openDetail}
                  onPatch={handlePatch}
                  onToggleDevMode={handleToggleDevMode}
                  onReorder={reorder}
                  onImport={isAdmin ? (wf, file) => setImportTarget({ wf, file }) : undefined}
                  onDuplicated={reload}
                  navigate={navigate}
                />
              ))}
            </div>
          </>
        )}

        {tab === 'insights' && (
          <WorkflowsInsights
            groups={groups}
            servers={servers}
            onOpen={(_cat, wf) => openDetail(wf)}
            range={range}
          />
        )}

        {tab === 'repartition' && <WorkflowsRepartition groups={groups} range={range} />}
      </div>

      {/* Scroll-to-top FAB */}
      <button
        onClick={() => document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })}
        className="btn btn-primary"
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 50,
          height: 42,
          width: 42,
          padding: 0,
          borderRadius: 999,
          boxShadow: 'var(--shadow-lg)',
          opacity: showTop ? 1 : 0,
          pointerEvents: showTop ? 'auto' : 'none',
          transform: showTop ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity .2s, transform .2s',
        }}
        title="Back to top"
      >
        <ChevronRight size={16} style={{ transform: 'rotate(-90deg)' }} />
      </button>

      <WorkflowsModalStack
        servers={servers}
        creating={creating}
        editing={editing}
        importTarget={importTarget}
        onCloseCreating={() => setCreating(false)}
        onCloseEditing={() => setEditing(null)}
        onCloseImport={() => setImportTarget(null)}
        onReload={reload}
        onOpenDetail={openDetail}
        onCloseDetail={closeDetail}
      />
    </>
  )
}
