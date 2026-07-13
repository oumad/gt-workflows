import { useState } from 'react'
import { Upload, FileJson, FileArchive, AlertTriangle, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { analyzeImport, createImport } from '../../lib/workflowImport'
import { useFileDrop } from '../../hooks/useFileDrop'
import { FileDropOverlay } from '../../components/ui/FileDropOverlay'
import { ServerUrlPicker } from './ServerUrlPicker'
import { ErrorAlert } from '../../components/ui/Alert'
import type { Workflow, Server } from '../../types'

const CATEGORIES = ['Image', 'Training', 'Video', 'Data', 'Audio', 'Ops', 'General']

/* Shape of POST /api/workflows/import/analyze. */
type ImportResult = {
  kind: 'params' | 'workflow' | 'zip'
  params: Record<string, unknown> | null
  workflow: Record<string, unknown> | null
  nodeCount: number
  warnings: string[]
  incomingServers: string[]
  meta: {
    label: string | null
    category: string | null
    description: string | null
    parser: string | null
  }
  suggestedName: string
}

type Props = {
  initial?: Workflow
  servers: Server[]
  onSaved: (w: Workflow) => void
  onDeleted?: () => void
  onCancel: () => void
}

export function WorkflowForm({ initial, servers, onSaved, onDeleted, onCancel }: Props) {
  const isEdit = !!initial

  const [folderName, setFolderName] = useState('')
  const [label, setLabel] = useState(
    isEdit ? (initial.name !== initial.path ? initial.name : '') : '',
  )
  const [parser, setParser] = useState(initial?.parser ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [serverUrls, setServerUrls] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  // Create-mode drag & drop import.
  const [imported, setImported] = useState<
    (ImportResult & { fileName: string; file: File }) | null
  >(null)
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState<string | null>(null)
  const fileDrop = useFileDrop(handleFileDrop, { disabled: isEdit })

  /* Upload a dropped file → analyze (no write) → pre-fill the form. */
  async function handleFileDrop(file: File) {
    setImporting(true)
    setImportErr(null)
    try {
      const r = await analyzeImport<ImportResult>(file)
      setImported({ ...r, fileName: file.name, file })
      // Pre-fill — only fill empty fields / always take the import's metadata.
      if (!folderName && r.suggestedName) setFolderName(r.suggestedName)
      if (r.incomingServers.length) setServerUrls(r.incomingServers)
      if (r.meta.label) setLabel(r.meta.label)
      if (r.meta.category) setCategory(r.meta.category)
      if (r.meta.description) setDesc(r.meta.description)
      if (r.meta.parser) setParser(r.meta.parser)
      else if (r.workflow && r.nodeCount > 0) setParser('comfyui') // a node graph ⇒ ComfyUI
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setImporting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      let result: Workflow
      if (isEdit) {
        result = await api.patch<Workflow>(`/api/workflows/${initial!.id}`, {
          label: label || null,
          description: desc || null,
          category: category || undefined,
          parser: parser || null,
        })
      } else if (imported) {
        // Imported params are the base; the form fields override the metadata.
        const params: Record<string, unknown> = { ...(imported.params ?? {}) }
        if (label) params['label'] = label
        else delete params['label']
        if (category) params['category'] = category
        else delete params['category']
        if (desc) params['description'] = desc
        else delete params['description']
        if (parser) params['parser'] = parser
        else delete params['parser']
        // Servers — the single canonical field is comfyui_config.serverUrl.
        const cfg = { ...((params['comfyui_config'] as Record<string, unknown>) ?? {}) }
        cfg['serverUrl'] = serverUrls.length === 1 ? serverUrls[0] : serverUrls
        params['comfyui_config'] = cfg
        delete params['servers']
        delete params['serverIds']
        result = await createImport<Workflow>(folderName, imported.file, params)
      } else {
        result = await api.post<Workflow>('/api/workflows', {
          folderName,
          label: label || undefined,
          parser: parser || undefined,
          category: category || undefined,
          description: desc || undefined,
          serverUrls: serverUrls.length ? serverUrls : undefined,
        })
      }
      onSaved(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await api.del(`/api/workflows/${initial!.id}`)
      onDeleted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="col"
      style={{ gap: 14, position: 'relative' }}
      onDragOver={fileDrop.onDragOver}
      onDragLeave={fileDrop.onDragLeave}
      onDrop={fileDrop.onDrop}
    >
      {/* File-drop overlay */}
      {fileDrop.fileDragOver && <FileDropOverlay inset={-6} radius={10} zIndex={5} />}

      {/* Drop hint / imported summary (create only) */}
      {!isEdit && !imported && !importing && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--ink-3)',
            border: '1px dashed var(--line-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Upload size={14} style={{ flexShrink: 0 }} />
          Drop a <strong style={{ color: 'var(--ink-2)' }}>params.json</strong>,{' '}
          <strong style={{ color: 'var(--ink-2)' }}>workflow.json</strong> or{' '}
          <strong style={{ color: 'var(--ink-2)' }}>.zip</strong> here to import an existing
          workflow.
        </div>
      )}

      {!isEdit && importing && (
        <div
          className="row"
          style={{
            gap: 8,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--surface-2)',
            fontSize: 12,
            color: 'var(--ink-3)',
          }}
        >
          <RefreshCw size={14} className="spin" /> Inspecting file…
        </div>
      )}

      {!isEdit && imported && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--accent)',
            background: 'var(--accent-soft)',
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {imported.kind === 'zip' ? <FileArchive size={14} /> : <FileJson size={14} />}
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
              Importing from {imported.fileName}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setImported(null)}
            >
              Clear
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 4 }}>
            {[
              imported.params ? 'params.json' : null,
              imported.workflow
                ? `workflow file · ${imported.nodeCount} node${imported.nodeCount === 1 ? '' : 's'}`
                : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </div>
          {imported.warnings.length > 0 && (
            <div className="col" style={{ gap: 3, marginTop: 6 }}>
              {imported.warnings.map((w, i) => (
                <div key={i} className="row" style={{ gap: 5, fontSize: 11, color: 'var(--warn)' }}>
                  <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {importErr && <ErrorAlert>{importErr}</ErrorAlert>}

      {!isEdit && (
        <label className="form-field">
          <span>Folder name</span>
          <input
            className="input"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            required
            placeholder="my-workflow"
            pattern="[a-zA-Z0-9_-]+"
          />
          <small>Alphanumeric, underscores and hyphens. Becomes the directory name on disk.</small>
        </label>
      )}

      <label className="form-field">
        <span>
          Label{' '}
          <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional display name)</span>
        </span>
        <input
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={folderName || initial?.path || 'My Workflow'}
        />
      </label>

      <label className="form-field">
        <span>Parser type</span>
        <select className="input" value={parser} onChange={(e) => setParser(e.target.value)}>
          <option value="">Script</option>
          <option value="comfyui">ComfyUI</option>
        </select>
      </label>

      {!isEdit && (
        <div className="form-field">
          <span>
            Servers <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span>
          </span>
          <ServerUrlPicker value={serverUrls} onChange={setServerUrls} servers={servers} />
          <small>
            ComfyUI endpoint(s) this workflow runs on. Pick a registered server — the least-used is
            hinted — or type a URL.
          </small>
        </div>
      )}

      <label className="form-field">
        <span>Category</span>
        <input
          className="input"
          list="wf-cat-list"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Image, Training, Video…"
        />
        <datalist id="wf-cat-list">
          {CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>

      <label className="form-field">
        <span>Description</span>
        <textarea
          className="input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="What does this workflow do?"
          rows={2}
          style={{ height: 'auto', padding: '8px 10px', resize: 'vertical' }}
        />
      </label>

      {error && <ErrorAlert>{error}</ErrorAlert>}

      <div className="row" style={{ marginTop: 4 }}>
        {isEdit &&
          onDeleted &&
          (confirm ? (
            <button
              className="btn btn-danger"
              type="button"
              onClick={handleDelete}
              disabled={busy}
              style={{ marginRight: 'auto' }}
            >
              Confirm delete
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setConfirm(true)}
              style={{ marginRight: 'auto', color: 'var(--bad)' }}
            >
              Delete
            </button>
          ))}
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy || importing}>
          {busy
            ? 'Saving…'
            : isEdit
              ? 'Save changes'
              : imported
                ? 'Create & import'
                : 'Create workflow'}
        </button>
      </div>
    </form>
  )
}
