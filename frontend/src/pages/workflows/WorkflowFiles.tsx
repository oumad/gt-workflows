import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Folder,
  FolderOpen,
  FileText,
  FileJson,
  FileImage,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Edit3,
  FolderPlus,
  Upload,
  Save,
  RotateCcw,
  Download,
  Copy,
  Check,
  AlertCircle,
  FilePlus,
  RefreshCw,
} from 'lucide-react'
import { api } from '../../lib/api'
import { copyToClipboard } from '../../lib/clipboard'
import { loadSession } from '../../lib/storage'
import {
  JSON_COLOR,
  tokenizeJson,
  computeFoldRanges,
  computeDisplayLines,
  type FoldRange,
} from './json-overlay'
import { parseJsonFriendly, prettify } from './json-validate'

/* ─── Wire types (match api/src/services/workflowFiles.ts) ─────── */
type TreeNode = {
  path: string
  name: string
  type: 'dir' | 'file'
  size?: number
  modifiedAt?: string
  children?: TreeNode[]
}

type FileRead = {
  path: string
  name: string
  size: number
  modifiedAt: string
  text?: string
  binary?: boolean
}

type Props = {
  wfId: string
  isAdmin: boolean
}

/* ─── Misc helpers ─────────────────────────────────────────────── */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Classify a file by extension into a previewable media kind, or null for
 *  "no inline preview available". Used by the binary-file block to decide
 *  whether to show an `<img>` / `<video>` / `<audio>` instead of the
 *  "binary file" placeholder. */
function mediaKindFor(name: string): 'image' | 'video' | 'audio' | null {
  const ext = extOf(name)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(ext))
    return 'image'
  if (['mp4', 'webm', 'mov', 'ogv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
  return null
}

function isJsonName(name: string): boolean {
  return extOf(name) === 'json'
}

function isImageName(name: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(extOf(name))
}

function iconFor(node: TreeNode): React.ReactNode {
  if (node.type === 'dir') return <Folder size={13} />
  if (isJsonName(node.name)) return <FileJson size={13} style={{ color: 'var(--info)' }} />
  if (isImageName(node.name)) return <FileImage size={13} style={{ color: 'var(--pop-purple)' }} />
  return <FileText size={13} />
}

function fmtBytes(n: number | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir.replace(/\/$/, '')}/${name}` : name
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

/* ─── Tree node row ────────────────────────────────────────────── */
type TreeRowProps = {
  node: TreeNode
  depth: number
  selectedPath: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (node: TreeNode) => void
  isAdmin: boolean
  onAction: (
    action: 'rename' | 'delete' | 'newFolder' | 'newFile' | 'upload',
    node: TreeNode,
  ) => void
  onDropFile: (file: File, destDir: string) => void
}

function TreeRow({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
  isAdmin,
  onAction,
  onDropFile,
}: TreeRowProps) {
  const isRoot = node.path === ''
  const isOpen = isRoot || expanded.has(node.path)
  const isSelected = selectedPath === node.path
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

  function handleClick() {
    if (node.type === 'dir') {
      if (!isRoot) onToggle(node.path)
    } else {
      onSelect(node)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (!isAdmin) return
    if (node.type !== 'dir') return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.stopPropagation()
    setDragOver(false)
  }
  function handleDrop(e: React.DragEvent) {
    if (!isAdmin) return
    if (node.type !== 'dir') return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onDropFile(file, node.path)
  }

  // Indent uses left padding only — keeps the entire row clickable and matches
  // VS Code's tree visuals where the chevron sits at the indent boundary.
  const indent = depth * 14

  return (
    <>
      <div
        ref={rowRef}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px 3px ' + (8 + indent) + 'px',
          fontSize: 12.5,
          cursor: 'default',
          background: isSelected
            ? 'color-mix(in oklab, var(--accent) 18%, var(--surface))'
            : dragOver
              ? 'color-mix(in oklab, var(--accent) 10%, var(--surface))'
              : 'transparent',
          borderRadius: 4,
          color: isSelected ? 'var(--accent-ink)' : 'var(--ink)',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            e.currentTarget.style.background = dragOver
              ? 'color-mix(in oklab, var(--accent) 10%, var(--surface))'
              : 'transparent'
          }
        }}
      >
        {node.type === 'dir' && !isRoot ? (
          isOpen ? (
            <ChevronDown size={11} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          ) : (
            <ChevronRight size={11} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          )
        ) : (
          <span style={{ width: 11, flexShrink: 0 }} />
        )}
        <span style={{ flexShrink: 0 }}>
          {node.type === 'dir' && isOpen ? <FolderOpen size={13} /> : iconFor(node)}
        </span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: isRoot ? 600 : 400,
          }}
          title={node.path || node.name}
        >
          {isRoot ? `${node.name} /` : node.name}
        </span>
        {node.type === 'file' && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', flexShrink: 0 }}>
            {fmtBytes(node.size)}
          </span>
        )}
        {isAdmin && (node.type === 'dir' || !isRoot) && (
          <button
            className="btn btn-ghost btn-icon"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((o) => !o)
            }}
            title="More"
            style={{ width: 18, height: 18, color: 'var(--ink-3)', flexShrink: 0 }}
          >
            <MoreHorizontal size={11} />
          </button>
        )}
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: 8,
              marginTop: 22,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-lg)',
              padding: 4,
              minWidth: 160,
              zIndex: 50,
            }}
          >
            {node.type === 'dir' && (
              <>
                <MenuItem
                  icon={FolderPlus}
                  label="New folder"
                  onClick={() => {
                    setMenuOpen(false)
                    onAction('newFolder', node)
                  }}
                />
                <MenuItem
                  icon={FilePlus}
                  label="New file"
                  onClick={() => {
                    setMenuOpen(false)
                    onAction('newFile', node)
                  }}
                />
                <MenuItem
                  icon={Upload}
                  label="Upload file…"
                  onClick={() => {
                    setMenuOpen(false)
                    onAction('upload', node)
                  }}
                />
              </>
            )}
            {!isRoot && (
              <>
                {node.type === 'dir' && (
                  <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
                )}
                <MenuItem
                  icon={Edit3}
                  label="Rename"
                  onClick={() => {
                    setMenuOpen(false)
                    onAction('rename', node)
                  }}
                />
                <MenuItem
                  icon={Trash2}
                  label="Delete"
                  onClick={() => {
                    setMenuOpen(false)
                    onAction('delete', node)
                  }}
                  danger
                />
              </>
            )}
          </div>
        )}
      </div>

      {node.type === 'dir' && isOpen && node.children && (
        <>
          {node.children.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              isAdmin={isAdmin}
              onAction={onAction}
              onDropFile={onDropFile}
            />
          ))}
          {node.children.length === 0 && !isRoot && (
            <div
              style={{
                padding: '2px 8px 2px ' + (8 + (depth + 1) * 14) + 'px',
                fontSize: 11,
                color: 'var(--ink-3)',
                fontStyle: 'italic',
              }}
            >
              empty
            </div>
          )}
        </>
      )}
    </>
  )
}

/* ─── Auth-bearing media preview ─────────────────────────────────
   Fetches a workflow file's raw bytes through the auth'd api client,
   wraps the response in a blob:URL, and uses that as the src for the
   actual <img>/<video>/<audio> element. Direct `<img src="/api/..."/>`
   doesn't work because the browser can't add the JWT bearer header
   the route's requireAuth gate needs.

   Re-runs on wfId / path change (different file selected); revokes the
   previous blob URL so we don't leak memory across selections. */
function MediaPreview({
  wfId,
  path,
  name,
  size,
  kind,
}: {
  wfId: string
  path: string
  name: string
  size: number
  kind: 'image' | 'video' | 'audio'
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    setBlobUrl(null)
    setErr(null)

    const session = loadSession()
    const headers: Record<string, string> = session
      ? { Authorization: `Bearer ${session.token}` }
      : {}
    const ctrl = new AbortController()
    fetch(`/api/workflows/${wfId}/fs/raw?path=${encodeURIComponent(path)}`, {
      headers,
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (aborted) return
        const url = URL.createObjectURL(blob)
        setBlobUrl(url)
      })
      .catch((e: unknown) => {
        if (aborted || (e instanceof Error && e.name === 'AbortError')) return
        setErr(e instanceof Error ? e.message : 'Failed to load preview')
      })

    return () => {
      aborted = true
      ctrl.abort()
    }
  }, [wfId, path])

  // Revoke whenever blobUrl changes (or unmounts) so we don't leak — kept in
  // a separate effect so the cleanup runs against the value we created, not
  // the value of a subsequent render.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  const downloadHref = `/api/workflows/${wfId}/fs/raw?path=${encodeURIComponent(path)}`

  return (
    <div
      className="col"
      style={{
        padding: 16,
        gap: 10,
        alignItems: 'center',
        color: 'var(--ink-3)',
        overflow: 'auto',
      }}
    >
      <div
        className="row"
        style={{ gap: 6, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' }}
      >
        <FileImage size={14} style={{ color: 'var(--ink-2)' }} />
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
        <span style={{ fontSize: 11 }}>· {fmtBytes(size)}</span>
        <a
          href={downloadHref}
          className="btn btn-sm btn-ghost btn-icon"
          target="_blank"
          rel="noreferrer"
          title="Download (opens in a new tab — uses your session cookie if set)"
          style={{ marginLeft: 8 }}
        >
          <Download size={12} />
        </a>
      </div>

      {err && (
        <div className="row" style={{ gap: 6, color: 'var(--bad)', fontSize: 12 }}>
          <AlertCircle size={13} /> {err}
        </div>
      )}

      {!err && !blobUrl && <div style={{ fontSize: 12, padding: '24px 0' }}>Loading preview…</div>}

      {blobUrl && kind === 'image' && (
        <img
          src={blobUrl}
          alt={name}
          style={{
            maxWidth: '100%',
            maxHeight: '70vh',
            objectFit: 'contain',
            borderRadius: 6,
            background:
              'repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface) 0% 50%) 50% / 16px 16px',
            border: '1px solid var(--line)',
          }}
        />
      )}
      {blobUrl && kind === 'video' && (
        <video
          src={blobUrl}
          controls
          style={{
            maxWidth: '100%',
            maxHeight: '70vh',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
          }}
        />
      )}
      {blobUrl && kind === 'audio' && <audio src={blobUrl} controls style={{ width: '100%' }} />}
    </div>
  )
}

function MenuItem({
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 10px',
        background: 'transparent',
        border: 0,
        borderRadius: 5,
        fontSize: 12.5,
        color: danger ? 'var(--bad)' : 'var(--ink)',
        textAlign: 'left',
        cursor: 'default',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={13} /> {label}
    </button>
  )
}

/* ─── File editor (right pane) ─────────────────────────────────── */
function FileEditor({
  wfId,
  path,
  isAdmin,
  onSaved,
}: {
  wfId: string
  path: string
  isAdmin: boolean
  onSaved: (file: FileRead) => void
}) {
  const [meta, setMeta] = useState<FileRead | null>(null)
  const [raw, setRaw] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [copyOk, setCopyOk] = useState(false)

  const isJson = isJsonName(path)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    setSaveErr(null)
    try {
      const file = await api.get<FileRead>(
        `/api/workflows/${wfId}/fs/file?path=${encodeURIComponent(path)}`,
      )
      setMeta(file)
      const text = file.text ?? ''
      const formatted = isJson ? prettify(text) : text
      setRaw(formatted)
      setSaved(formatted)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [wfId, path, isJson])

  useEffect(() => {
    load()
  }, [load])

  const parse = isJson ? parseJsonFriendly(raw) : null
  const dirty = raw !== saved
  // For non-JSON files, anything is savable. For JSON we still allow saving
  // invalid JSON (matches "edit as text" intent) but warn the user.
  const canSave = isAdmin && dirty && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setSaveErr(null)
    try {
      const file = await api.put<FileRead>(`/api/workflows/${wfId}/fs/file`, {
        path,
        text: raw,
      })
      setMeta(file)
      const next = isJson && parse?.ok ? prettify(raw) : raw
      setRaw(next)
      setSaved(next)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 1500)
      onSaved(file)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function revert() {
    setRaw(saved)
    setSaveErr(null)
  }

  function format() {
    if (isJson && parse?.ok) setRaw(JSON.stringify(parse.value, null, 2))
  }

  async function copy() {
    // Uses the secure-context-or-fallback helper — navigator.clipboard alone
    // silently no-ops on plain-HTTP origins (LAN / ZeroTier deployments).
    const ok = await copyToClipboard(raw)
    if (!ok) return
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 1500)
  }

  function download() {
    const blob = new Blob([raw], {
      type: isJson ? 'application/json' : 'text/plain',
    })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: meta?.name ?? 'file',
    })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
        Loading…
      </div>
    )
  }
  if (loadErr) {
    return (
      <div
        style={{
          padding: 16,
          fontSize: 13,
          color: 'var(--bad)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <AlertCircle size={14} /> {loadErr}
      </div>
    )
  }
  if (meta?.binary) {
    // For previewable media (image / video / audio) we can't just point an
    // <img>/<video>/<audio> tag at /fs/raw — the browser won't add the JWT
    // bearer header it needs, so the GET would 401. Instead we fetch the
    // bytes through the auth'd api client, wrap them in a blob:URL, and use
    // that as the src. MediaPreview handles the lifecycle + revocation.
    const media = mediaKindFor(meta.name)
    const rawUrl = `/api/workflows/${wfId}/fs/raw?path=${encodeURIComponent(path)}`
    if (media) {
      return <MediaPreview wfId={wfId} path={path} name={meta.name} size={meta.size} kind={media} />
    }
    return (
      <div
        className="col"
        style={{ padding: 24, gap: 12, alignItems: 'center', color: 'var(--ink-3)' }}
      >
        <FileText size={28} />
        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{meta.name}</div>
        <div style={{ fontSize: 12 }}>
          Binary or oversized file ({fmtBytes(meta.size)}) — preview / edit not available.
        </div>
        <a href={rawUrl} className="btn btn-sm" target="_blank" rel="noreferrer">
          <Download size={12} /> Download
        </a>
      </div>
    )
  }

  const lineCount = raw ? raw.split('\n').length : 0
  const charCount = raw.length

  return (
    <div className="col" style={{ gap: 12, height: '100%' }}>
      {/* Header */}
      <div
        className="row"
        style={{ gap: 8, padding: '0 4px', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <span
          className="chip"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, gap: 5 }}
          title={path}
        >
          {isJson ? <FileJson size={11} /> : <FileText size={11} />}
          {meta?.name ?? path}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
          {parentOf(path) || '/'}
        </span>
        <span className="spacer" />
        {copyOk && (
          <span className="chip chip-good">
            <Check size={11} /> Copied
          </span>
        )}
        {saveOk && (
          <span className="chip chip-good">
            <Check size={11} /> Saved
          </span>
        )}
        {isAdmin && isJson && (
          <button
            className="btn btn-sm"
            disabled={!parse?.ok}
            onClick={format}
            title="Pretty-print"
          >
            Format
          </button>
        )}
        <button className="btn btn-sm btn-ghost btn-icon" onClick={copy} title="Copy">
          <Copy size={12} />
        </button>
        <button className="btn btn-sm btn-ghost btn-icon" onClick={download} title="Download">
          <Download size={12} />
        </button>
        {isAdmin && (
          <button
            className="btn btn-sm"
            disabled={!dirty}
            onClick={revert}
            style={{ opacity: dirty ? 1 : 0.5 }}
            title="Revert"
          >
            <RotateCcw size={12} /> Revert
          </button>
        )}
        {isAdmin && (
          <button
            className={`btn btn-sm ${canSave ? 'btn-accent' : ''}`}
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5 }}
            onClick={save}
          >
            <Save size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {/* JSON validity strip */}
      {isJson && parse && !parse.ok && (
        <div
          className="row"
          style={{
            gap: 10,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'color-mix(in oklab, var(--bad) 8%, var(--surface))',
            color: 'var(--bad)',
            fontSize: 12,
          }}
        >
          <AlertCircle size={13} />
          <span>Invalid JSON — {parse.error.message}</span>
          <span className="spacer" />
          <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            line {parse.error.line}
          </span>
        </div>
      )}

      {saveErr && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--bad-soft)',
            fontSize: 12,
            color: 'var(--bad)',
          }}
        >
          {saveErr}
        </div>
      )}

      {/* Editor textarea */}
      {isJson ? (
        <JsonHighlightedEditor
          text={raw}
          setText={setRaw}
          readOnly={!isAdmin}
          errLine={parse?.ok ? null : (parse?.error.line ?? null)}
        />
      ) : (
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          readOnly={!isAdmin}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 480,
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            lineHeight: 1.55,
            padding: 12,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--surface)',
            color: 'var(--ink)',
            resize: 'vertical',
            outline: 'none',
            whiteSpace: 'pre',
          }}
        />
      )}

      <div
        className="row"
        style={{
          gap: 8,
          padding: '0 4px',
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span className="mono">
          {lineCount} lines · {charCount} chars
          {meta && meta.modifiedAt ? ` · saved ${new Date(meta.modifiedAt).toLocaleString()}` : ''}
        </span>
        {!isAdmin && <span>· read-only (admin required)</span>}
      </div>
    </div>
  )
}

/* ─── Pretty JSON editor (textarea + syntax-highlight overlay) ─── */
/**
 * JsonHighlightedEditor — textarea + overlay editor with:
 *   - Syntax highlighting (tokenizeJson)
 *   - Line numbers
 *   - Brace folding ({ } / [ ]) via gutter chevrons
 *   - Error-line highlight
 *
 * Folding model: when ANY fold is active, the textarea switches to
 * read-only. Edits in folded view would silently drop the hidden range,
 * which is a classic foot-gun. Users explicitly "Unfold all" (or click
 * the active fold chevrons) to re-enter edit mode. Visually the textarea
 * stays positioned over the overlay and the overlay drives what the user
 * sees — text never disappears from `text` itself.
 */
function JsonHighlightedEditor({
  text,
  setText,
  readOnly,
  errLine,
}: {
  text: string
  setText: (v: string) => void
  readOnly: boolean
  errLine: number | null
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const [folds, setFolds] = useState<Set<number>>(() => new Set())

  const tokens = useMemo(() => tokenizeJson(text), [text])

  // Foldable ranges in the current text. Recomputed on every change so an
  // edit that breaks a range automatically prunes the now-stale fold.
  const ranges = useMemo(() => computeFoldRanges(text), [text])
  const rangeByStart = useMemo(() => {
    const m = new Map<number, FoldRange>()
    for (const r of ranges) m.set(r.startLine, r)
    return m
  }, [ranges])

  // Prune folds whose start line no longer maps to a range — e.g. user
  // deleted the `{`. Don't reset the whole set on every text change because
  // that would unfold everything on each keystroke.
  useEffect(() => {
    setFolds((prev) => {
      if (prev.size === 0) return prev
      const next = new Set<number>()
      for (const start of prev) if (rangeByStart.has(start)) next.add(start)
      return next.size === prev.size ? prev : next
    })
  }, [rangeByStart])

  const displayLines = useMemo(
    () => computeDisplayLines(text, folds, rangeByStart),
    [text, folds, rangeByStart],
  )

  // When folds are active we can't safely edit through the textarea — a paste
  // or keystroke in a folded zone would be invisible. Lock writes until the
  // user unfolds. Renders as a small banner above the editor body.
  const hasFolds = folds.size > 0
  const effectiveReadOnly = readOnly || hasFolds

  function syncScroll() {
    const ta = taRef.current
    if (!ta) return
    if (gutRef.current) gutRef.current.scrollTop = ta.scrollTop
    if (hlRef.current) {
      hlRef.current.scrollTop = ta.scrollTop
      hlRef.current.scrollLeft = ta.scrollLeft
    }
  }

  function toggleFold(line: number) {
    setFolds((prev) => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  function foldAll() {
    setFolds(new Set(ranges.map((r) => r.startLine)))
  }
  function unfoldAll() {
    setFolds(new Set())
  }

  const codeStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    lineHeight: '1.55',
    padding: '12px 14px',
    margin: 0,
    tabSize: 2,
    fontFeatureSettings: '"liga" 0, "calt" 0',
  }

  return (
    <div className="col" style={{ gap: 6, flex: 1 }}>
      <div
        className="row"
        style={{
          gap: 8,
          padding: '4px 6px',
          fontSize: 11,
          color: 'var(--ink-3)',
          alignItems: 'center',
        }}
      >
        <span>
          {ranges.length > 0
            ? `${ranges.length} foldable ${ranges.length === 1 ? 'block' : 'blocks'}`
            : 'No foldable blocks'}
        </span>
        {hasFolds && (
          <span
            className="chip"
            style={{ fontSize: 10, color: 'var(--warn)', gap: 4 }}
            title="Editing is disabled while sections are folded — unfold to edit"
          >
            <AlertCircle size={10} /> Read-only while folded
          </span>
        )}
        <span className="spacer" />
        <button
          className="btn btn-sm btn-ghost"
          onClick={foldAll}
          disabled={ranges.length === 0 || folds.size === ranges.length}
        >
          Fold all
        </button>
        <button className="btn btn-sm btn-ghost" onClick={unfoldAll} disabled={folds.size === 0}>
          Unfold all
        </button>
      </div>
      <div
        className="card"
        style={{ overflow: 'hidden', display: 'grid', gridTemplateColumns: '72px 1fr', flex: 1 }}
      >
        {/* Gutter — line numbers + fold chevrons. Rendered per displayLine so
            collapsed ranges occupy a single row. */}
        <div
          ref={gutRef}
          style={{
            background: 'var(--surface-2)',
            color: 'var(--ink-3)',
            overflow: 'hidden',
            borderRight: '1px solid var(--line)',
            userSelect: 'none',
            height: 520,
            padding: '12px 0',
          }}
        >
          {displayLines.map((dl, i) => {
            const isErr = errLine === dl.sourceLine
            return (
              <div
                key={i}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  lineHeight: '1.55',
                  padding: '0 6px 0 4px',
                  display: 'grid',
                  gridTemplateColumns: '16px 1fr',
                  alignItems: 'center',
                  color: isErr ? 'white' : undefined,
                  background: isErr ? 'var(--bad)' : undefined,
                  fontWeight: isErr ? 700 : undefined,
                }}
              >
                {dl.foldStartHere ? (
                  <button
                    type="button"
                    onClick={() => toggleFold(dl.sourceLine)}
                    title={dl.folded ? 'Unfold' : 'Fold'}
                    style={{
                      background: 'transparent',
                      border: 0,
                      cursor: 'pointer',
                      padding: 0,
                      color: 'var(--ink-3)',
                      lineHeight: 1,
                    }}
                  >
                    {dl.folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                ) : (
                  <span />
                )}
                <span style={{ textAlign: 'right' }}>{dl.sourceLine}</span>
              </div>
            )
          })}
        </div>
        {/* Content — overlay highlights the visible display lines; textarea
            below it captures keystrokes (when not folded). */}
        <div style={{ position: 'relative', height: 520 }}>
          <div
            ref={hlRef}
            aria-hidden
            style={{
              ...codeStyle,
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              whiteSpace: 'pre',
              wordBreak: 'normal',
              pointerEvents: 'none',
              color: 'var(--ink)',
            }}
          >
            {hasFolds
              ? // Folded view — render display lines directly. Tokenizer still
                // runs per-row so we keep colours inside the visible content.
                displayLines.map((dl, i) => (
                  <div key={i}>
                    {tokenizeJson(dl.content).map((tok, j) =>
                      tok.type === 'ws' ? (
                        tok.value
                      ) : (
                        <span key={j} style={{ color: JSON_COLOR[tok.type] }}>
                          {tok.value}
                        </span>
                      ),
                    )}
                    {dl.folded && <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }} />}
                  </div>
                ))
              : tokens.map((tok, i) =>
                  tok.type === 'ws' ? (
                    tok.value
                  ) : (
                    <span key={i} style={{ color: JSON_COLOR[tok.type] }}>
                      {tok.value}
                    </span>
                  ),
                )}
          </div>
          <textarea
            ref={taRef}
            value={text}
            readOnly={effectiveReadOnly}
            onChange={(e) => setText(e.target.value)}
            onScroll={syncScroll}
            spellCheck={false}
            wrap="off"
            // When folds are active, hide the textarea visually (the overlay
            // does all rendering) but keep it focusable so Esc / Tab still
            // navigate. pointer-events:none in folded mode lets clicks on the
            // overlay's fold chevrons reach the gutter.
            style={{
              ...codeStyle,
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              border: 0,
              outline: 'none',
              resize: 'none',
              background: 'transparent',
              color: 'transparent',
              caretColor: effectiveReadOnly ? 'transparent' : 'var(--ink)',
              whiteSpace: 'pre',
              overflow: hasFolds ? 'hidden' : 'auto',
              opacity: hasFolds ? 0 : 1,
              pointerEvents: hasFolds ? 'none' : undefined,
            }}
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ──────────────────────────────────────────── */
export function WorkflowFiles({ wfId, isAdmin }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [dragOverRoot, setDragOverRoot] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingUploadDir = useRef<string>('')

  async function refresh() {
    setLoading(true)
    setLoadErr(null)
    try {
      const t = await api.get<TreeNode>(`/api/workflows/${wfId}/fs/tree`)
      setTree(t)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfId])

  function onToggle(path: string) {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  }

  function onSelect(node: TreeNode) {
    setSelectedPath(node.path)
    setEditorKey((k) => k + 1) // force reload when re-clicking the same file
  }

  /* ─── Upload via input ──────────────────────────── */
  function triggerUpload(destDir: string) {
    pendingUploadDir.current = destDir
    fileInputRef.current?.click()
  }
  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await uploadFile(file, pendingUploadDir.current)
  }

  /* ─── Upload via drop ───────────────────────────── */
  async function uploadFile(file: File, destDir: string) {
    const session = loadSession()
    const fd = new FormData()
    fd.append('file', file)
    fd.append('dest', destDir)
    try {
      const res = await fetch(`/api/workflows/${wfId}/fs/upload`, {
        method: 'POST',
        body: fd,
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        alert(data.error ?? `Upload failed (HTTP ${res.status})`)
        return
      }
      // Expand the destination folder so the new file is visible.
      if (destDir) setExpanded((s) => new Set(s).add(destDir))
      await refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  /* ─── Mutations from the row dot-menu ───────────── */
  async function handleAction(
    action: 'rename' | 'delete' | 'newFolder' | 'newFile' | 'upload',
    node: TreeNode,
  ) {
    if (action === 'upload') {
      triggerUpload(node.path)
      return
    }
    if (action === 'newFolder') {
      const name = window.prompt('New folder name')?.trim()
      if (!name) return
      const path = joinPath(node.path, name)
      try {
        await api.post(`/api/workflows/${wfId}/fs/folder`, { path })
        setExpanded((s) => new Set(s).add(node.path).add(path))
        await refresh()
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Failed to create folder')
      }
      return
    }
    if (action === 'newFile') {
      const name = window.prompt('New file name (with extension)')?.trim()
      if (!name) return
      const path = joinPath(node.path, name)
      try {
        await api.put(`/api/workflows/${wfId}/fs/file`, { path, text: '' })
        setExpanded((s) => new Set(s).add(node.path))
        await refresh()
        setSelectedPath(path)
        setEditorKey((k) => k + 1)
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Failed to create file')
      }
      return
    }
    if (action === 'rename') {
      const next = window.prompt(`Rename "${node.name}" to:`, node.name)?.trim()
      if (!next || next === node.name) return
      const newPath = joinPath(parentOf(node.path), next)
      try {
        await api.post(`/api/workflows/${wfId}/fs/rename`, {
          from: node.path,
          to: newPath,
        })
        if (selectedPath === node.path) setSelectedPath(newPath)
        // Re-expand: rename keeps the parent open and (for dirs) the renamed
        // node open if it was already expanded.
        setExpanded((s) => {
          const n = new Set(s)
          if (n.has(node.path)) {
            n.delete(node.path)
            n.add(newPath)
          }
          return n
        })
        await refresh()
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Rename failed')
      }
      return
    }
    if (action === 'delete') {
      if (
        !window.confirm(
          `Delete "${node.name}"? This cannot be undone (a snapshot will be saved for rollback).`,
        )
      )
        return
      try {
        await fetch(`/api/workflows/${wfId}/fs/file?path=${encodeURIComponent(node.path)}`, {
          method: 'DELETE',
          headers: loadSession() ? { Authorization: `Bearer ${loadSession()!.token}` } : {},
        }).then(async (r) => {
          if (!r.ok) {
            const data = (await r.json().catch(() => ({}))) as { error?: string }
            throw new Error(data.error ?? `HTTP ${r.status}`)
          }
        })
        if (selectedPath === node.path || selectedPath?.startsWith(node.path + '/')) {
          setSelectedPath(null)
        }
        await refresh()
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Delete failed')
      }
    }
  }

  function rootDropHandlers() {
    if (!isAdmin) return {}
    return {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOverRoot(true)
        }
      },
      onDragLeave: () => setDragOverRoot(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        setDragOverRoot(false)
        const file = e.dataTransfer.files[0]
        if (file) uploadFile(file, '')
      },
    }
  }

  if (loading)
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
        Loading files…
      </div>
    )

  if (loadErr)
    return (
      <div
        style={{
          padding: 16,
          fontSize: 13,
          color: 'var(--bad)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <AlertCircle size={14} /> {loadErr}
      </div>
    )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: 12,
        minHeight: 560,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFilePicked}
      />

      {/* Tree panel */}
      <div
        className="card"
        {...rootDropHandlers()}
        style={{
          padding: 6,
          overflow: 'auto',
          maxHeight: 720,
          position: 'relative',
          border: dragOverRoot ? '2px dashed var(--accent)' : undefined,
          background: dragOverRoot
            ? 'color-mix(in oklab, var(--accent) 8%, var(--surface))'
            : undefined,
        }}
      >
        <div
          className="row"
          style={{
            padding: '4px 6px 8px',
            borderBottom: '1px solid var(--line)',
            marginBottom: 4,
            gap: 4,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>FOLDER</span>
          <span className="spacer" />
          <button
            className="btn btn-ghost btn-icon"
            onClick={refresh}
            title="Refresh"
            style={{ width: 22, height: 22 }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {tree && (
          <TreeRow
            node={tree}
            depth={0}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            isAdmin={isAdmin}
            onAction={handleAction}
            onDropFile={uploadFile}
          />
        )}
        {isAdmin && (
          <div
            style={{
              padding: 8,
              marginTop: 6,
              borderTop: '1px solid var(--line)',
              fontSize: 10.5,
              color: 'var(--ink-3)',
              lineHeight: 1.5,
            }}
          >
            <Upload size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Drag files onto a folder to upload. Use the ⋯ menu for rename / new folder / delete.
          </div>
        )}
      </div>

      {/* Editor panel */}
      <div
        className="card card-pad"
        style={{ minHeight: 560, display: 'flex', flexDirection: 'column' }}
      >
        {selectedPath == null ? (
          <div
            className="col"
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              gap: 8,
            }}
          >
            <FileText size={28} />
            <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>No file selected</div>
            <div style={{ fontSize: 12.5, textAlign: 'center', maxWidth: 320 }}>
              Pick a file from the tree on the left to view or edit it. JSON files get syntax
              highlighting and validation; everything else opens as plain text.
            </div>
          </div>
        ) : (
          <FileEditor
            key={`${selectedPath}__${editorKey}`}
            wfId={wfId}
            path={selectedPath}
            isAdmin={isAdmin}
            onSaved={() => {
              // Refresh tree to pick up new mtime/size on the saved file.
              refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}
