import { useState, useEffect } from 'react'
import {
  MoreHorizontal,
  GitBranch,
  Tag,
  Settings,
  Download,
  Activity,
  Terminal,
  Bot,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import type { Workflow, Server, NavigateFn } from '../../types'
import { loadSession } from '../../lib/storage'
import { useFileDrop } from '../../hooks/useFileDrop'
import { FileDropOverlay } from '../../components/ui/FileDropOverlay'
import { KVRow } from '../../components/ui/KVRow'
import { SetoModal } from '../../components/seto/SetoModal'
import {
  cardTint,
  thumbStyle,
  fmtDur,
  workflowCategory,
  categoryName,
  serverLabel,
  normServerUrl,
  type CatInfo,
  type DragState,
} from './workflowsHelpers'
import { ServerUrlPicker } from './ServerUrlPicker'
import { DuplicateModal } from './DuplicateModal'

/* ─── Dot menu item ──────────────────────────────────────────── */
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

/* ─── Workflow card ──────────────────────────────────────────── */
export function WFCard({
  wf,
  cat,
  seed,
  servers,
  isAdmin,
  drag,
  setDrag,
  idx,
  onDrop,
  onOpen,
  onPatch,
  onToggleDevMode,
  onDuplicated,
  onImport,
  navigate,
}: {
  wf: Workflow
  cat: CatInfo
  seed: number
  servers: Server[]
  isAdmin: boolean
  drag: DragState
  setDrag: (d: DragState) => void
  idx: number
  onDrop: (fromCat: string, fromIdx: number) => void
  onOpen: () => void
  onPatch: (patch: Record<string, unknown>) => void
  onToggleDevMode: () => void
  onDuplicated?: () => void
  /** File dropped on the card — opens the import wizard. Admin only. */
  onImport?: (file: File) => void
  /** App navigation — used by the "Service logs" menu item. */
  navigate?: NavigateFn
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [setoOpen, setSetoOpen] = useState(false)
  const [editingField, setEditingField] = useState<'servers' | 'timeout' | null>(null)
  const isComfy = wf.parser?.toLowerCase() === 'comfyui'
  const [dragOver, setDragOver] = useState(false)
  const [serverDraft, setServerDraft] = useState<string[]>([])
  const fileDrop = useFileDrop((file) => onImport?.(file), { disabled: !isAdmin })
  const isDragging = drag?.catId === cat.id && drag?.idx === idx

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpen])

  /** Download this workflow's folder as a ZIP (params + workflow + sidecars). */
  async function downloadWorkflow() {
    setMenuOpen(false)
    const session = loadSession()
    try {
      const res = await fetch(`/api/workflows/${wf.id}/export`, {
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      })
      if (!res.ok) {
        alert('Download failed')
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${wf.path}.zip`,
      })
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed')
    }
  }

  /** Open the detail page of a service this workflow runs on — where its logs
   *  live. Falls back to the services list when none is assigned. Note: the
   *  `/servers/:id` URL routes to the Services page (legacy prefix); the
   *  navigate page key for that view is 'services'. */
  function openServiceLogs() {
    setMenuOpen(false)
    const assigned = servers.find((s) =>
      wf.serverUrls.some((u) => normServerUrl(u) === normServerUrl(s.url)),
    )
    navigate?.('services', assigned ? `/servers/${assigned.id}` : '/servers')
  }

  // First couple of assigned servers, by friendly name, for the compact display.
  const serverSummary = wf.serverUrls.length
    ? wf.serverUrls
        .slice(0, 2)
        .map((u) => serverLabel(u, servers))
        .join(', ') + (wf.serverUrls.length > 2 ? ` +${wf.serverUrls.length - 2}` : '')
    : '—'

  return (
    <>
      <div
        draggable={isAdmin}
        onDragStart={
          isAdmin
            ? (e) => {
                setDrag({ catId: cat.id, idx })
                e.dataTransfer.effectAllowed = 'move'
              }
            : undefined
        }
        onDragEnd={
          isAdmin
            ? () => {
                setDrag(null)
                setDragOver(false)
              }
            : undefined
        }
        // One handler set covers two drags: an external *file* drag (types
        // includes 'Files' → import) and the internal card-reorder drag.
        onDragOver={
          isAdmin
            ? (e) => {
                if (fileDrop.onDragOver(e)) return
                if (drag) {
                  e.preventDefault()
                  setDragOver(true)
                }
              }
            : undefined
        }
        onDragLeave={
          isAdmin
            ? () => {
                setDragOver(false)
                fileDrop.onDragLeave()
              }
            : undefined
        }
        onDrop={
          isAdmin
            ? (e) => {
                if (fileDrop.onDrop(e)) {
                  setDragOver(false)
                  return
                }
                e.preventDefault()
                setDragOver(false)
                if (drag) {
                  onDrop(drag.catId, drag.idx)
                  setDrag(null)
                }
              }
            : undefined
        }
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button,input,select')) return
          onOpen()
        }}
        className="card col"
        style={{
          gap: 0,
          ...cardTint(wf.name),
          position: 'relative',
          overflow: 'hidden',
          cursor: 'pointer',
          opacity: isDragging ? 0.4 : 1,
          outline: dragOver ? '2px solid var(--accent)' : 'none',
          outlineOffset: -2,
          transition: 'opacity .15s',
        }}
      >
        {/* File-drop overlay — shown while an external file is dragged over. */}
        {fileDrop.fileDragOver && <FileDropOverlay />}

        {/* drag handle — admin only, drag-reorder calls admin-only PATCH */}
        {isAdmin && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 3,
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'rgba(255,255,255,.85)',
              backdropFilter: 'blur(6px)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink-2)',
              cursor: 'grab',
              fontSize: 11,
              lineHeight: 1,
              userSelect: 'none',
            }}
            title="Drag to reorder"
          >
            ⋮⋮
          </div>
        )}

        {/* dot menu */}
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}>
          <button
            className="btn btn-sm btn-icon"
            style={{
              background: 'rgba(255,255,255,.85)',
              backdropFilter: 'blur(6px)',
              border: 0,
              height: 24,
              width: 24,
            }}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((o) => !o)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 4px)',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                boxShadow: 'var(--shadow-lg)',
                padding: 4,
                minWidth: 192,
                zIndex: 20,
              }}
            >
              {isAdmin && (
                <DotItem
                  icon={Terminal}
                  label={wf.devMode ? 'Disable dev mode' : 'Set dev mode'}
                  onClick={() => {
                    setMenuOpen(false)
                    onToggleDevMode()
                  }}
                />
              )}
              {isAdmin && <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />}
              {isAdmin && (
                <DotItem
                  icon={GitBranch}
                  label="Duplicate"
                  onClick={() => {
                    setMenuOpen(false)
                    setDupOpen(true)
                  }}
                />
              )}
              <DotItem icon={Download} label="Download" onClick={downloadWorkflow} />
              {navigate && (
                <DotItem icon={Activity} label="Service logs" onClick={openServiceLogs} />
              )}
              <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
              <DotItem
                icon={Bot}
                label="Ask Seto"
                onClick={() => {
                  setMenuOpen(false)
                  setSetoOpen(true)
                }}
              />
            </div>
          )}
        </div>

        <div
          className="row"
          style={{
            gap: 14,
            padding: 'var(--pad)',
            paddingTop: 38,
            paddingRight: 40,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              flexShrink: 0,
              borderRadius: 10,
              position: 'relative',
              overflow: 'hidden',
              ...thumbStyle(seed, cat.color, wf.name),
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
              <WorkflowIcon size={24} />
            </span>
          </div>
          <div
            style={{
              minWidth: 0,
              flex: 1,
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 20,
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
            }}
          >
            {wf.name}
          </div>
          {wf.iconBadge && (
            <span
              title={`${wf.iconBadge.label} — badge set by this workflow's params.json`}
              style={{
                flexShrink: 0,
                padding: '5px 11px',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
                background: wf.iconBadge.bg ?? 'var(--accent)',
                color: wf.iconBadge.color ?? 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,.12)',
              }}
            >
              {wf.iconBadge.label}
            </span>
          )}
        </div>

        <div className="col" style={{ gap: 8, padding: '0 var(--pad) var(--pad)' }}>
          {wf.description && (
            <div style={{ color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.4 }}>
              {wf.description}
            </div>
          )}

          {/* Status badges */}
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {wf.tested && (
              <span className="chip chip-good" style={{ fontSize: 10, padding: '2px 7px' }}>
                ✓ Tested
              </span>
            )}
            {wf.audited && (
              <span className="chip chip-info" style={{ fontSize: 10, padding: '2px 7px' }}>
                ⚑ Audited
              </span>
            )}
            {wf.devMode && (
              <span
                className="chip"
                style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  background: 'var(--warn-soft)',
                  color: 'var(--warn)',
                  border: '1px solid var(--warn)',
                }}
              >
                DEV
              </span>
            )}
            <span className="chip" style={{ fontSize: 10, padding: '2px 7px' }}>
              <Tag size={9} /> {categoryName(workflowCategory(wf))}
            </span>
          </div>

          {/* Tags */}
          {(wf.tags ?? []).length > 0 && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(wf.tags ?? []).map((t) => (
                <span
                  key={t}
                  className="chip"
                  style={{ fontSize: 10, padding: '2px 6px', color: 'var(--ink-3)' }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="col" style={{ gap: 4, marginTop: 2 }}>
            {/* Script workflows run nowhere near a ComfyUI service and have
             * no timeout — hide the rows instead of printing dashes. */}
            {isComfy && (
              <KVRow label="Services">
                {/* Inline edit calls PATCH /api/workflows/:id (admin-only). */}
                {editingField === 'servers' && isAdmin ? (
                  <div
                    className="col"
                    style={{ gap: 5, flex: 1, minWidth: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ServerUrlPicker
                      value={serverDraft}
                      onChange={setServerDraft}
                      servers={servers}
                      autoFocus
                    />
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ fontSize: 10, height: 22, padding: '0 8px' }}
                        onClick={() => {
                          onPatch({ serverUrls: serverDraft })
                          setEditingField(null)
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ fontSize: 10, height: 22, padding: '0 8px' }}
                        onClick={() => setEditingField(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : isAdmin ? (
                  <button
                    className="editable row mono"
                    style={{ fontSize: 11 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setServerDraft(wf.serverUrls)
                      setEditingField('servers')
                    }}
                  >
                    {serverSummary}
                    <Settings size={10} />
                  </button>
                ) : (
                  <span className="mono" style={{ fontSize: 11 }}>
                    {serverSummary}
                  </span>
                )}
              </KVRow>
            )}

            {isComfy && (
              <KVRow label="Timeout">
                {editingField === 'timeout' && isAdmin ? (
                  <input
                    autoFocus
                    type="number"
                    defaultValue={wf.timeout ?? ''}
                    className="input mono"
                    style={{ height: 24, fontSize: 11, padding: '0 6px', width: 80 }}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const val = parseInt(e.currentTarget.value)
                      onPatch({ timeout: isNaN(val) ? null : val })
                      setEditingField(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseInt(e.currentTarget.value)
                        onPatch({ timeout: isNaN(val) ? null : val })
                        setEditingField(null)
                      }
                      if (e.key === 'Escape') setEditingField(null)
                    }}
                  />
                ) : isAdmin ? (
                  <button
                    className="editable row mono"
                    style={{ fontSize: 11 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingField('timeout')
                    }}
                  >
                    {wf.timeout != null ? fmtDur(wf.timeout) : '—'}
                    <Settings size={10} />
                  </button>
                ) : (
                  <span className="mono" style={{ fontSize: 11 }}>
                    {wf.timeout != null ? fmtDur(wf.timeout) : '—'}
                  </span>
                )}
              </KVRow>
            )}

            <KVRow label="Parser">
              <span className="mono" style={{ fontSize: 11 }}>
                {isComfy ? 'comfyUI' : 'script'}
              </span>
            </KVRow>
            {wf.workflowFile && (
              <KVRow label="Workflow">
                <span
                  className="mono"
                  title={wf.workflowFile}
                  style={{
                    fontSize: 11,
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {wf.workflowFile}
                </span>
              </KVRow>
            )}
            <KVRow label="Path">
              <span
                className="mono"
                title={wf.path}
                style={{
                  fontSize: 11,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {wf.path}
              </span>
            </KVRow>
          </div>
        </div>
      </div>

      {dupOpen && (
        <DuplicateModal
          wf={wf}
          onClose={() => setDupOpen(false)}
          onDone={() => {
            setDupOpen(false)
            onDuplicated?.()
          }}
        />
      )}
      {setoOpen && (
        <SetoModal kind="workflow" id={wf.id} label={wf.name} onClose={() => setSetoOpen(false)} />
      )}
    </>
  )
}
