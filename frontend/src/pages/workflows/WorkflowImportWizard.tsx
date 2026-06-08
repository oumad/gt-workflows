import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, FileJson, FileArchive, AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { analyzeImport, applyImport } from '../../lib/workflowImport'
import { serverLabel } from './workflowsHelpers'
import type { Workflow, Server } from '../../types'

/* ─── Types ───────────────────────────────────────────────────── */
type AnalyzeResult = {
  kind: 'params' | 'workflow' | 'zip'
  params: Record<string, unknown> | null
  workflow: Record<string, unknown> | null
  nodeCount: number
  warnings: string[]
  currentServers: string[]
  incomingServers: string[]
}
type ServerInsight = { serverId: string; serverName: string; totalJobs: number }
type ServerMode = 'keep' | 'use' | 'merge' | 'manual'
type Phase = 'analyzing' | 'review' | 'servers' | 'applying' | 'error'

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)))

const KIND_LABEL: Record<AnalyzeResult['kind'], string> = {
  params: 'params.json',
  workflow: 'workflow file',
  zip: 'workflow bundle (.zip)',
}

/* ═══════════════════════════════════════════════════════════════
   Import wizard — opened when a file is dropped on a workflow card.
   analyze (upload, no write) → review → [servers] → apply.
   ═══════════════════════════════════════════════════════════════ */
export function WorkflowImportWizard({
  wf,
  file,
  servers,
  onClose,
  onDone,
}: {
  wf: Workflow
  file: File
  servers: Server[]
  onClose: () => void
  onDone: (updated: Workflow) => void
}) {
  const [phase, setPhase] = useState<Phase>('analyzing')
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<ServerInsight[]>([])

  const [serverMode, setServerMode] = useState<ServerMode>('keep')
  const [manualSel, setManualSel] = useState<string[]>([])

  /* Upload + analyse on mount — no write happens server-side here. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await analyzeImport<AnalyzeResult>(file, wf.id)
        if (cancelled) return
        setResult(r)
        setManualSel(uniq([...r.currentServers, ...r.incomingServers]))
        // Least-surprising default: keep what's there; fall back to the
        // imported set only when the workflow currently has no servers.
        setServerMode(
          r.currentServers.length > 0 ? 'keep' : r.incomingServers.length > 0 ? 'use' : 'keep',
        )
        setPhase('review')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Upload failed')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wf.id, file])

  /* Run stats for the "least used" hint in the manual picker — non-blocking. */
  useEffect(() => {
    api
      .get<ServerInsight[]>('/api/servers/insights')
      .then(setInsights)
      .catch(() => {})
  }, [])

  const hasParams = !!result?.params
  const hasWorkflow = !!result?.workflow
  const hasServerStep = hasParams // servers live in params.json only

  const allServerUrls = uniq([
    ...servers.map((s) => s.url),
    ...(result?.currentServers ?? []),
    ...(result?.incomingServers ?? []),
  ]).sort()

  const leastUsedUrl = (() => {
    if (insights.length === 0) return null
    const ranked = [...insights].sort((a, b) => a.totalJobs - b.totalJobs)
    const srv = ranked[0] ? servers.find((s) => s.id === ranked[0]!.serverId) : undefined
    return srv?.url ?? null
  })()

  function resolveServers(): string[] {
    if (!result) return []
    switch (serverMode) {
      case 'keep':
        return result.currentServers
      case 'use':
        return result.incomingServers
      case 'merge':
        return uniq([...result.currentServers, ...result.incomingServers])
      case 'manual':
        return manualSel
    }
  }

  async function apply() {
    if (!result) return
    setPhase('applying')
    try {
      // Server-adjusted params override whatever params.json the file carried.
      let params: Record<string, unknown> | null = null
      if (result.params) {
        params = { ...result.params }
        // Servers — the single canonical field is comfyui_config.serverUrl.
        const urls = resolveServers()
        const cfg = { ...((params['comfyui_config'] as Record<string, unknown>) ?? {}) }
        cfg['serverUrl'] = urls.length === 1 ? urls[0] : urls
        params['comfyui_config'] = cfg
        delete params['servers']
        delete params['serverIds']
      }
      const updated = await applyImport<Workflow>(wf.id, file, params)
      onDone(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setPhase('error')
    }
  }

  /* ── Render ─────────────────────────────────────────────────── */
  const KindIcon = result?.kind === 'zip' ? FileArchive : FileJson
  const blockClose = phase === 'applying'

  return createPortal(
    <div className="modal-stage" onClick={blockClose ? undefined : onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(600px, 94vw)' }}
      >
        {/* Head */}
        <div className="modal-head">
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--accent)',
              display: 'grid',
              placeItems: 'center',
              color: 'white',
            }}
          >
            <KindIcon size={14} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
              Import to workflow
            </div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {wf.name} ← {file.name}
            </div>
          </div>
          <span className="spacer" />
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            disabled={blockClose}
            style={{ opacity: blockClose ? 0.3 : 1 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Analyzing */}
        {phase === 'analyzing' && (
          <div
            className="modal-body"
            style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)', fontSize: 13 }}
          >
            <RefreshCw size={18} className="spin" style={{ marginBottom: 8 }} />
            <div>Inspecting {file.name}…</div>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <>
            <div className="modal-body col" style={{ gap: 10 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 8,
                  fontSize: 13,
                  color: 'var(--bad)',
                  background: 'color-mix(in oklab, var(--bad) 10%, var(--surface))',
                }}
              >
                {error ?? 'Something went wrong.'}
              </div>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {/* Review */}
        {phase === 'review' && result && (
          <>
            <div className="modal-body col" style={{ gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                Detected a <strong>{KIND_LABEL[result.kind]}</strong>. The following will be applied
                to <strong>{wf.name}</strong>:
              </div>

              <div className="col" style={{ gap: 8 }}>
                {hasParams && (
                  <div
                    className="row"
                    style={{
                      gap: 10,
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                    }}
                  >
                    <Check size={15} style={{ color: 'var(--good)', flexShrink: 0 }} />
                    <div className="col" style={{ gap: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>params.json</span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        Metadata, config, tags and server assignment
                      </span>
                    </div>
                  </div>
                )}
                {hasWorkflow && (
                  <div
                    className="row"
                    style={{
                      gap: 10,
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      background: 'var(--surface-2)',
                    }}
                  >
                    <Check size={15} style={{ color: 'var(--good)', flexShrink: 0 }} />
                    <div className="col" style={{ gap: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>workflow file</span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        ComfyUI node graph · {result.nodeCount} node
                        {result.nodeCount === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {result.warnings.length > 0 && (
                <div
                  className="col"
                  style={{
                    gap: 6,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'color-mix(in oklab, var(--warn) 10%, var(--surface))',
                  }}
                >
                  {result.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="row"
                      style={{ gap: 6, fontSize: 12, color: 'var(--warn)' }}
                    >
                      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                A snapshot of the current workflow is saved before importing — you can roll it back
                from the History menu.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
                onClick={() => (hasServerStep ? setPhase('servers') : apply())}
              >
                {hasServerStep ? 'Next — servers' : 'Import'}
              </button>
            </div>
          </>
        )}

        {/* Servers */}
        {phase === 'servers' && result && (
          <>
            <div className="modal-body col" style={{ gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                Which servers should <strong>{wf.name}</strong> run on after the import?
              </div>

              <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                <ServerSet label="Currently" urls={result.currentServers} servers={servers} />
                <ServerSet label="In the import" urls={result.incomingServers} servers={servers} />
              </div>

              <div className="col" style={{ gap: 6 }}>
                <ModeRow
                  mode="keep"
                  cur={serverMode}
                  set={setServerMode}
                  title="Keep current"
                  desc="Leave the existing server assignment untouched."
                />
                <ModeRow
                  mode="use"
                  cur={serverMode}
                  set={setServerMode}
                  title="Use imported"
                  desc="Replace with the servers from the imported file."
                />
                <ModeRow
                  mode="merge"
                  cur={serverMode}
                  set={setServerMode}
                  title="Merge both"
                  desc="Union of current and imported servers."
                />
                <ModeRow
                  mode="manual"
                  cur={serverMode}
                  set={setServerMode}
                  title="Choose manually"
                  desc="Pick exactly which servers to assign."
                />
              </div>

              {serverMode === 'manual' && (
                <div
                  className="row"
                  style={{
                    gap: 6,
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                  }}
                >
                  {allServerUrls.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>No servers known.</span>
                  )}
                  {allServerUrls.map((url) => {
                    const on = manualSel.includes(url)
                    return (
                      <button
                        key={url}
                        title={url}
                        onClick={() =>
                          setManualSel((s) =>
                            s.includes(url) ? s.filter((x) => x !== url) : [...s, url],
                          )
                        }
                        className="row"
                        style={{
                          gap: 5,
                          fontSize: 11.5,
                          padding: '4px 9px',
                          borderRadius: 999,
                          fontFamily: 'var(--font-mono)',
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
                          background: on ? 'var(--accent-soft)' : 'var(--surface)',
                          color: on ? 'var(--accent-ink)' : 'var(--ink-2)',
                          cursor: 'default',
                        }}
                      >
                        {on && <Check size={10} />}
                        {serverLabel(url, servers)}
                        {url === leastUsedUrl && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--good)' }}>
                            · least used
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              <div
                className="row"
                style={{ gap: 6, fontSize: 12, alignItems: 'baseline', flexWrap: 'wrap' }}
              >
                <span style={{ color: 'var(--ink-3)' }}>Result:</span>
                {resolveServers().length === 0 ? (
                  <span style={{ color: 'var(--warn)' }}>no servers assigned</span>
                ) : (
                  resolveServers().map((u) => (
                    <span key={u} className="chip mono" style={{ fontSize: 10 }} title={u}>
                      {serverLabel(u, servers)}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPhase('review')}>
                Back
              </button>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
                onClick={apply}
              >
                Import
              </button>
            </div>
          </>
        )}

        {/* Applying */}
        {phase === 'applying' && (
          <div
            className="modal-body"
            style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)', fontSize: 13 }}
          >
            <RefreshCw size={18} className="spin" style={{ marginBottom: 8 }} />
            <div>Importing…</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ─── Small pieces ────────────────────────────────────────────── */
function ServerSet({ label, urls, servers }: { label: string; urls: string[]; servers: Server[] }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </span>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {urls.length === 0 ? (
          <span style={{ color: 'var(--ink-3)' }}>—</span>
        ) : (
          urls.map((u) => (
            <span key={u} className="chip mono" style={{ fontSize: 10 }} title={u}>
              {serverLabel(u, servers)}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function ModeRow({
  mode,
  cur,
  set,
  title,
  desc,
}: {
  mode: ServerMode
  cur: ServerMode
  set: (m: ServerMode) => void
  title: string
  desc: string
}) {
  const on = cur === mode
  return (
    <button
      onClick={() => set(mode)}
      className="row"
      style={{
        gap: 10,
        alignItems: 'flex-start',
        textAlign: 'left',
        width: '100%',
        padding: '9px 11px',
        borderRadius: 8,
        cursor: 'default',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
        background: on ? 'color-mix(in oklab, var(--accent) 8%, var(--surface))' : 'var(--surface)',
      }}
    >
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: 999,
          flexShrink: 0,
          marginTop: 1,
          border: '2px solid ' + (on ? 'var(--accent)' : 'var(--line-2)'),
          background: on ? 'var(--accent)' : 'transparent',
          boxShadow: on ? 'inset 0 0 0 2px var(--surface)' : 'none',
        }}
      />
      <div className="col" style={{ gap: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{desc}</span>
      </div>
    </button>
  )
}
