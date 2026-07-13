import { useState } from 'react'
import { api } from '../../lib/api'
import type { Workflow } from '../../types'

export function DuplicateModal({
  wf,
  onClose,
  onDone,
}: {
  wf: Workflow
  onClose: () => void
  onDone: () => void
}) {
  const slug = wf.path.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '')
  const [folderName, setFolderName] = useState(`${slug}-copy`)
  const [label, setLabel] = useState(`${wf.name} (copy)`)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      await api.post(`/api/workflows/${wf.id}/duplicate`, {
        folderName: folderName.trim(),
        label: label.trim(),
      })
      onDone()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Duplicate failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-stage" onClick={onClose}>
      <form
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ padding: 24, gap: 16 }}
      >
        <div style={{ fontWeight: 600, fontSize: 16 }}>Duplicate "{wf.name}"</div>
        <div className="form-row">
          <label>Folder name</label>
          <input
            className="input mono"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="my-workflow-copy"
            required
            autoFocus
          />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            Only letters, numbers, hyphens, underscores
          </span>
        </div>
        <div className="form-row">
          <label>Label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Display name"
          />
        </div>
        {err && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--bad)',
              background: 'var(--bad-soft)',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            {err}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={saving || !folderName.trim()}
          >
            {saving ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </form>
    </div>
  )
}
