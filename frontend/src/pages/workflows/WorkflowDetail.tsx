import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  Stethoscope,
  Shield,
  GitBranch,
  Download,
  History as HistoryIcon,
  RotateCcw,
  Trash2,
  Tag as TagIcon,
  Workflow as WorkflowIcon,
  Clock,
  RefreshCw,
  Save,
} from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { Tabs } from '../../components/shell/Tabs'
import { WorkflowConfig } from './WorkflowConfig'
import { NodeManager } from './node-manager/NodeManager'
import { WorkflowFiles } from './WorkflowFiles'
import { api } from '../../lib/api'
import { loadSession } from '../../lib/storage'
import { fmtDuration } from '../../lib/format'
import { KVRow } from '../../components/ui/KVRow'
import { serverLabel } from './workflowsHelpers'
import type { Workflow, Server } from '../../types'
import type { UnifiedJob, UnifiedJobsPage } from '../jobs/shared'
import { History } from '../jobs/shared'
import { TestWorkflowModal, AuditDependenciesModal } from './WorkflowModals'
import { DuplicateModal } from './DuplicateModal'

/* ─── History snapshot type ──────────────────────────────────── */
type HistorySnapshot = {
  id: string
  savedAt: string
  kind: 'params' | 'workflow' | 'meta' | 'import'
  label: string
}

const KIND_TONE: Record<HistorySnapshot['kind'], { bg: string; color: string }> = {
  params: {
    bg: 'color-mix(in oklab, var(--accent) 14%, var(--surface))',
    color: 'var(--accent-ink)',
  },
  workflow: {
    bg: 'color-mix(in oklab, var(--pop-purple) 14%, var(--surface))',
    color: 'var(--pop-purple)',
  },
  meta: { bg: 'var(--surface-2)', color: 'var(--ink-2)' },
  import: { bg: 'color-mix(in oklab, var(--info) 14%, var(--surface))', color: 'var(--info)' },
}

/* ─── History modal ──────────────────────────────────────────── */
function HistoryModal({
  wf,
  isAdmin,
  onClose,
  onRestored,
}: {
  wf: Workflow
  isAdmin: boolean
  onClose: () => void
  onRestored: (w: Workflow) => void
}) {
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    setLoading(true)
    api
      .get<HistorySnapshot[]>(`/api/workflows/${wf.id}/history`)
      .then(setSnapshots)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [wf.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function restore(snapshotId: string) {
    if (
      !window.confirm(
        "Restore this snapshot? The current files will be overwritten. (Don't worry — the current state is saved as a new snapshot first so you can undo.)",
      )
    )
      return
    setRestoring(snapshotId)
    try {
      const updated = await api.post<Workflow>(
        `/api/workflows/${wf.id}/history/${snapshotId}/restore`,
        {},
      )
      onRestored(updated)
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0,0,0,.45)',
        backdropFilter: 'blur(3px)',
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-lg)',
          width: 560,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          className="row"
          style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', gap: 8 }}
        >
          <HistoryIcon size={16} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>History — {wf.name}</span>
          <span className="spacer" />
          <button
            className="btn btn-sm btn-ghost btn-icon"
            onClick={refresh}
            disabled={loading}
            title="Reload"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
          {loading && snapshots.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>Loading…</div>
          ) : error ? (
            <div
              style={{
                color: 'var(--bad)',
                padding: 16,
                background: 'var(--bad-soft)',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : snapshots.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 40 }}>
              No snapshots yet.
              <br />
              <span style={{ fontSize: 12 }}>
                A snapshot is saved automatically after each edit.
              </span>
            </div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {snapshots.map((s) => {
                const tone = KIND_TONE[s.kind]
                return (
                  <div
                    key={s.id}
                    className="row"
                    style={{
                      padding: '10px 14px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      gap: 12,
                      background: 'var(--surface-2)',
                    }}
                  >
                    <Clock size={13} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                    <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {new Date(s.savedAt).toLocaleString()}
                        </span>
                        <span
                          className="chip"
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            background: tone.bg,
                            color: tone.color,
                            fontWeight: 600,
                          }}
                        >
                          {s.label}
                        </span>
                      </div>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color: 'var(--ink-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.id}
                      </span>
                    </div>
                    {isAdmin && (
                      <button
                        className="btn btn-sm"
                        disabled={restoring === s.id}
                        onClick={() => restore(s.id)}
                      >
                        {restoring === s.id ? (
                          <RefreshCw size={12} className="spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        Restore
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ─── Utilities (shared with WorkflowsPage) ───────────────────── */
function hashHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

function thumbStyle(seed: number, imgKey: string): React.CSSProperties {
  const hue = hashHue(imgKey || String(seed))
  const c1 = `oklch(72% 0.16 ${hue})`
  const c2 = `oklch(58% 0.18 ${(hue + 40) % 360})`
  return {
    background: `radial-gradient(circle at 30% 30%, ${c1} 0%, transparent 60%),
      radial-gradient(circle at 75% 70%, ${c2} 0%, transparent 65%),
      linear-gradient(135deg, ${c1}, ${c2})`,
  }
}

/* ─── Dot-menu item ──────────────────────────────────────────── */
function DotItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="row"
      style={{
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 0,
        borderRadius: 6,
        gap: 8,
        fontSize: 13,
        color: danger ? 'var(--bad)' : 'var(--ink)',
        cursor: 'default',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

/* ─── Actions menu (sits in the tab-row trailing slot) ───────── */
function ActionsMenu({
  isAdmin,
  onDelete,
  onTest,
  onAudit,
  onDownload,
  onHistory,
  onDuplicate,
}: {
  isAdmin: boolean
  onDelete: () => void
  onTest: () => void
  onAudit: () => void
  onDownload: () => void
  onHistory: () => void
  onDuplicate: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setOpen((o) => !o)
  }

  const dropdown =
    open &&
    pos &&
    createPortal(
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: pos.top,
          right: pos.right,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-lg)',
          padding: 4,
          minWidth: 200,
          zIndex: 9999,
        }}
      >
        <DotItem
          icon={Stethoscope}
          label="Test workflow"
          onClick={() => {
            setOpen(false)
            onTest()
          }}
        />
        <DotItem
          icon={Shield}
          label="Audit dependencies"
          onClick={() => {
            setOpen(false)
            onAudit()
          }}
        />
        <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        {/* Duplicate calls POST /:id/duplicate (admin-only) — hide for non-admins. */}
        {isAdmin && (
          <DotItem
            icon={GitBranch}
            label="Duplicate"
            onClick={() => {
              setOpen(false)
              onDuplicate()
            }}
          />
        )}
        <DotItem
          icon={Download}
          label="Download"
          onClick={() => {
            setOpen(false)
            onDownload()
          }}
        />
        <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        <DotItem
          icon={HistoryIcon}
          label="Show history"
          onClick={() => {
            setOpen(false)
            onHistory()
          }}
        />
        {isAdmin && (
          <>
            <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
            <DotItem
              icon={Trash2}
              label="Delete"
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
              danger
            />
          </>
        )}
      </div>,
      document.body,
    )

  return (
    <>
      <button ref={btnRef} className="btn btn-sm row" style={{ gap: 5 }} onClick={toggle}>
        Actions <ChevronDown size={12} />
      </button>
      {dropdown}
    </>
  )
}

/* ─── Page ───────────────────────────────────────────────────── */
type Props = {
  wf: Workflow
  catName: string
  catColor: string
  servers: Server[]
  isAdmin: boolean
  onBack: () => void
  onDelete: () => void
  onSaved: (w: Workflow) => void
}

export function WorkflowDetail({
  wf,
  catName,
  catColor,
  servers,
  isAdmin,
  onBack,
  onDelete,
  onSaved,
}: Props) {
  const [tab, setTab] = useState('overview')
  const [jobs, setJobs] = useState<UnifiedJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [testOpen, setTestOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [nodeDirty, setNodeDirty] = useState(false)
  const [nodeResetKey, setNodeResetKey] = useState(0)
  const nodeSaveRef = useRef<(() => Promise<void>) | null>(null)

  const handleNodeSave = useCallback(async () => {
    await nodeSaveRef.current?.()
  }, [])
  const handleNodeDiscard = useCallback(() => {
    setNodeResetKey((k) => k + 1)
    setNodeDirty(false)
  }, [])

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    try {
      const session = loadSession()
      // Bare fetch (not api.get) because the response is a binary ZIP and
      // we want the blob, not the auto-JSON-parsing wrapper.
      const resp = await fetch(`/api/workflows/${wf.id}/export`, {
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      })
      if (!resp.ok) {
        alert('Download failed')
        return
      }
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${wf.path}.zip`,
      })
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed')
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    setJobsLoading(true)
    // Pass id (slug), path (folder name), and name (label) so the API can
    // match whatever string the BullMQ producer used as the job name.
    const params = new URLSearchParams({ workflowId: wf.id, limit: '200' })
    if (wf.path !== wf.id) params.set('workflowName', wf.path)
    else if (wf.name !== wf.id) params.set('workflowName', wf.name)
    api
      .get<UnifiedJobsPage>(`/api/jobs?${params}`)
      .then((res) => setJobs(res.items ?? []))
      .catch(() => {})
      .finally(() => setJobsLoading(false))
    // Deliberate: refetch only when the workflow identity changes — name and
    // path always change together with id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf.id])

  const isComfyUI = wf.parser?.toLowerCase() === 'comfyui'

  const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000
  const runs7d = jobs.filter(
    (j) =>
      new Date(j.createdAt).getTime() >= cutoff7d &&
      (j.status === 'completed' || j.status === 'failed'),
  ).length

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'config', label: 'Config' },
    ...(isComfyUI ? [{ id: 'nodes', label: 'Node Manager' }] : []),
    // Generic folder browser + per-file editor (JSON gets syntax highlight +
    // validation, plain text otherwise). Replaces the old "JSON files" tab,
    // which was limited to params.json + workflow.json.
    { id: 'files', label: 'Files' },
    { id: 'runs', label: 'Runs', pill: runs7d || undefined },
  ]

  return (
    <>
      <PageHead
        crumbs={['Brews', { label: 'Workflows', onClick: onBack }, catName]}
        title={wf.name}
        sub={wf.description ?? undefined}
        actions={null}
      />

      {testOpen && <TestWorkflowModal wf={wf} onClose={() => setTestOpen(false)} />}
      {auditOpen && <AuditDependenciesModal wf={wf} onClose={() => setAuditOpen(false)} />}
      {historyOpen && (
        <HistoryModal
          wf={wf}
          isAdmin={isAdmin}
          onClose={() => setHistoryOpen(false)}
          onRestored={onSaved}
        />
      )}
      {dupOpen && (
        <DuplicateModal
          wf={wf}
          onClose={() => setDupOpen(false)}
          onDone={() => {
            setDupOpen(false)
            onSaved(wf)
          }}
        />
      )}

      <Tabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        trailing={
          <ActionsMenu
            isAdmin={isAdmin}
            onDelete={onDelete}
            onTest={() => setTestOpen(true)}
            onAudit={() => setAuditOpen(true)}
            onDownload={handleDownload}
            onHistory={() => setHistoryOpen(true)}
            onDuplicate={() => setDupOpen(true)}
          />
        }
      />

      <div className="body">
        {tab === 'overview' && (
          <OverviewTab
            wf={wf}
            servers={servers}
            catName={catName}
            catColor={catColor}
            jobs={jobs}
            loading={jobsLoading}
            isComfyUI={isComfyUI}
          />
        )}

        {tab === 'config' && (
          <WorkflowConfig wf={wf} servers={servers} isAdmin={isAdmin} onSaved={onSaved} />
        )}

        {isComfyUI && (
          <NodeManager
            key={nodeResetKey}
            wf={wf}
            isAdmin={isAdmin}
            hidden={tab !== 'nodes'}
            onDirtyChange={setNodeDirty}
            saveRef={nodeSaveRef}
          />
        )}

        {tab === 'files' && <WorkflowFiles wfId={wf.id} isAdmin={isAdmin} />}

        {tab === 'runs' && <RunsTab wf={wf} />}
      </div>

      {nodeDirty && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 900,
            background: 'var(--surface)',
            borderTop: '2px solid var(--accent)',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 -4px 20px rgba(0,0,0,.15)',
          }}
        >
          <Save size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            You have unsaved changes in the Node Manager.
          </span>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={handleNodeDiscard}>
            Discard
          </button>
          <button
            className="btn btn-sm"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            onClick={handleNodeSave}
          >
            Save
          </button>
        </div>
      )}
    </>
  )
}

/* ─── Runs tab ───────────────────────────────────────────────── */
function RunsTab({ wf }: { wf: Workflow }) {
  // Embeds the full /jobs History component, locked to this workflow's id.
  // Search, sort, kind/status filters, pagination, refresh and the modal all
  // work the same way as the standalone Jobs page.
  return <History lock={{ kind: 'workflow', id: wf.id, label: wf.name }} />
}

/* ─── Overview tab ───────────────────────────────────────────── */
function OverviewTab({
  wf,
  servers,
  catName,
  catColor,
  jobs,
  loading,
  isComfyUI,
}: {
  wf: Workflow
  servers: Server[]
  catName: string
  catColor: string
  jobs: UnifiedJob[]
  loading: boolean
  isComfyUI: boolean
}) {
  const serverDisplay = wf.serverUrls.length
    ? wf.serverUrls.map((u) => serverLabel(u, servers)).join(', ')
    : '—'

  // Stats (7d, terminal jobs only)
  const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000
  const done7d = jobs.filter(
    (j) =>
      new Date(j.createdAt).getTime() >= cutoff7d &&
      (j.status === 'completed' || j.status === 'failed'),
  )
  const completed7d = done7d.filter((j) => j.status === 'completed')
  const runs7d = done7d.length
  const successPct = runs7d > 0 ? Math.round((completed7d.length / runs7d) * 100) : null
  const durations = completed7d
    .map((j) => j.durationMs ?? 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  const avgSec =
    durations.length > 0
      ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length / 1000)
      : null
  const p95Sec =
    durations.length > 0
      ? Math.round(
          durations[Math.min(Math.floor(durations.length * 0.95), durations.length - 1)] / 1000,
        )
      : null

  // Spark: last 12 days by job count
  const sparkData = Array.from({ length: 12 }, (_, i) => {
    const day = new Date()
    day.setDate(day.getDate() - (11 - i))
    day.setHours(0, 0, 0, 0)
    const next = new Date(day.getTime() + 86400000)
    return jobs.filter((j) => {
      const t = new Date(j.createdAt).getTime()
      return t >= day.getTime() && t < next.getTime()
    }).length
  })
  const sparkMax = Math.max(...sparkData, 1)

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
      <div className="col">
        {/* Hero card */}
        <div className="card card-pad row" style={{ gap: 16, alignItems: 'center' }}>
          <div
            style={{
              width: 96,
              height: 96,
              flexShrink: 0,
              borderRadius: 12,
              position: 'relative',
              overflow: 'hidden',
              ...thumbStyle(7, wf.name),
            }}
          >
            {wf.icon && (
              <img
                src={`/api/workflows/${wf.id}/icon`}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  zIndex: 2,
                }}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
            )}
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: 'white',
                textShadow: '0 1px 2px rgba(0,0,0,.3)',
                zIndex: 1,
              }}
            >
              <WorkflowIcon size={32} />
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                color: 'var(--ink-3)',
              }}
            >
              {catName}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                marginTop: 2,
              }}
            >
              {wf.name}
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
              {wf.workflowFile ?? wf.path}
            </div>
          </div>
          <span className="spacer" />
          <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
            {wf.iconBadge && (
              <span
                className="chip"
                style={{
                  fontWeight: 700,
                  background: wf.iconBadge.bg ?? 'var(--accent)',
                  color: wf.iconBadge.color ?? 'white',
                  border: '1px solid transparent',
                }}
              >
                {wf.iconBadge.label}
              </span>
            )}
            {!isComfyUI && <span className="chip chip-warn">parser: script</span>}
            {wf.tested && <span className="chip chip-good">✓ tested</span>}
            {wf.audited && <span className="chip chip-info">⚑ audited</span>}
            {wf.devMode && <span className="chip chip-warn">dev mode</span>}
          </div>
        </div>

        {/* About */}
        <div className="card card-pad col" style={{ gap: 10 }}>
          <div className="card-title">About this workflow</div>
          <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            {wf.description ?? 'No description provided.'}
            {wf.description &&
              ' Designed for batch operation with deterministic outputs and resumable runs. Pipeline definition is versioned and audited as part of the registry.'}
          </p>
          {(wf.tags?.length ?? 0) > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {wf.tags.map((t) => (
                <span key={t} className="chip">
                  <TagIcon size={9} /> {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Recent runs — full History component, locked to this workflow. */}
        <History lock={{ kind: 'workflow', id: wf.id, label: wf.name }} />
      </div>

      <div className="col">
        {/* Configuration summary */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Configuration</div>
          </div>
          <div className="card-pad col" style={{ gap: 10 }}>
            <KVRow label="Services">
              <span className="mono" style={{ fontSize: 11 }}>
                {serverDisplay}
              </span>
            </KVRow>
            <KVRow label="Timeout">
              <span className="mono" style={{ fontSize: 11 }}>
                {wf.timeout != null ? fmtDuration(wf.timeout) : '—'}
              </span>
            </KVRow>
            <KVRow label="Parser">
              <span className="mono" style={{ fontSize: 11 }}>
                {wf.parser ?? 'default'}
              </span>
            </KVRow>
            <KVRow label="Workflow">
              <span className="mono" style={{ fontSize: 11 }}>
                {wf.workflowFile ?? '—'}
              </span>
            </KVRow>
            <KVRow label="Path">
              <span className="mono" style={{ fontSize: 11 }}>
                {wf.path}
              </span>
            </KVRow>
            <KVRow label="Category">
              <span style={{ fontSize: 11 }}>{catName}</span>
            </KVRow>
            <KVRow label="Created">
              <span style={{ fontSize: 11 }}>{new Date(wf.createdAt).toLocaleDateString()}</span>
            </KVRow>
            <KVRow label="Updated">
              <span style={{ fontSize: 11 }}>{new Date(wf.updatedAt).toLocaleDateString()}</span>
            </KVRow>
          </div>
        </div>

        {/* Stats */}
        <div className="card card-pad col" style={{ gap: 8 }}>
          <div className="card-title">Stats · 7d</div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12 }}>Runs</span>
            <strong className="mono">{loading ? '…' : runs7d}</strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12 }}>Success</span>
            <strong
              className="mono"
              style={{
                color:
                  successPct == null ? undefined : successPct >= 90 ? 'var(--good)' : 'var(--warn)',
              }}
            >
              {loading ? '…' : successPct != null ? `${successPct}%` : '—'}
            </strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12 }}>Avg duration</span>
            <strong className="mono">
              {loading ? '…' : avgSec != null ? fmtDuration(avgSec) : '—'}
            </strong>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12 }}>p95</span>
            <strong className="mono">
              {loading ? '…' : p95Sec != null ? fmtDuration(p95Sec) : '—'}
            </strong>
          </div>
          <div className="spark" style={{ marginTop: 6 }}>
            {sparkData.map((count, i) => (
              <i
                key={i}
                style={{
                  height: Math.max(2, Math.round((count / sparkMax) * 42)),
                  background: catColor,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
