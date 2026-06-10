import { useState, useEffect } from 'react'
import { useNotifications } from '../../context/NotificationsContext'
import { api } from '../../lib/api'
import type { Server as ServerType } from '../../types'
import { type ServerPatch, validateHostOnlyUrl, normalizeHostOnlyUrl } from './serverHelpers'

export type KindLabel = 'service' | 'server'

const TITLE_FOR: Record<KindLabel, string> = {
  service: 'Service details',
  server: 'Server details',
}

/* ─── Settings ────────────────────────────────────────────────
 * The URL field has two flavours:
 *   - services:  any http(s) URL with a port — that's what defines a service.
 *     We just sanity-check the scheme and trim trailing slashes.
 *   - servers:   host-only URL (no port, no path). Validation lives in
 *     serverHelpers.validateHostOnlyUrl; onBlur snaps to canonical form. */

function validateServiceUrl(
  url: string,
): { ok: true; url: string } | { ok: false; message: string } {
  const cleanUrl = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/i.test(cleanUrl)) {
    return { ok: false, message: 'Service URL must start with http:// or https://' }
  }
  return { ok: true, url: cleanUrl }
}

export function ServerSettings({
  server,
  onSave,
  kindLabel,
}: {
  server: ServerType
  onSave: (patch: ServerPatch) => Promise<void>
  kindLabel: KindLabel
}) {
  const { notify } = useNotifications()
  const [name, setName] = useState(server.name)
  const [url, setUrl] = useState(server.url)
  const [desc, setDesc] = useState(server.description ?? '')
  const [tags, setTags] = useState(server.tags.join(', '))
  // Stored as the raw string so empty means "uncalibrated"; we only convert
  // to a number on save. Negative / non-numeric values are caught there too.
  const [maxConcurrent, setMaxConcurrent] = useState(
    server.maxConcurrent != null ? String(server.maxConcurrent) : '',
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(server.name)
    setUrl(server.url)
    setDesc(server.description ?? '')
    setTags(server.tags.join(', '))
    setMaxConcurrent(server.maxConcurrent != null ? String(server.maxConcurrent) : '')
  }, [server.name, server.url, server.description, server.tags, server.maxConcurrent])

  const dirty =
    name !== server.name ||
    url !== server.url ||
    desc !== (server.description ?? '') ||
    tags !== server.tags.join(', ') ||
    maxConcurrent !== (server.maxConcurrent != null ? String(server.maxConcurrent) : '')

  async function save() {
    const v = kindLabel === 'server' ? validateHostOnlyUrl(url) : validateServiceUrl(url)
    if (!v.ok) {
      notify({ variant: 'error', title: 'Invalid URL', body: v.message })
      return
    }
    // Parse maxConcurrent: empty string → null (clear cap); otherwise must
    // be a positive integer. Anything else is a user-facing error, not silent.
    let maxConcurrentValue: number | null
    if (maxConcurrent.trim() === '') {
      maxConcurrentValue = null
    } else {
      const n = Number(maxConcurrent)
      if (!Number.isInteger(n) || n <= 0) {
        notify({
          variant: 'error',
          title: 'Invalid max concurrent',
          body: 'Enter a positive integer or leave empty for "uncalibrated".',
        })
        return
      }
      maxConcurrentValue = n
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        url: v.url,
        description: desc.trim() || null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        maxConcurrent: maxConcurrentValue,
      })
      notify({
        variant: 'success',
        title: 'Changes were saved',
        body: `${server.name} settings updated.`,
      })
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Save failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card card-pad col" style={{ gap: 14, maxWidth: 720 }}>
      <div className="card-title">{TITLE_FOR[kindLabel]}</div>
      <div className="form-row">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-row">
        <label>URL</label>
        {kindLabel === 'server' ? (
          <>
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={(e) => {
                const n = normalizeHostOnlyUrl(e.target.value)
                if (n != null && n !== e.target.value) setUrl(n)
              }}
              placeholder="worker-03 · 10.0.0.12 · http://worker-03"
            />
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
              Hostname or IP — no port. Ports belong to services running on this server.
            </div>
          </>
        ) : (
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://host:port"
          />
        )}
      </div>
      <div className="form-row">
        <label>Description</label>
        <textarea
          className="input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={`Optional — describe this ${kindLabel}'s role, location, specs…`}
          style={{
            minHeight: 72,
            fontFamily: 'inherit',
            fontSize: 13.5,
            lineHeight: 1.6,
            resize: 'vertical',
          }}
        />
      </div>
      <div className="form-row">
        <label>Tags</label>
        <input
          className="input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="comma-separated"
        />
      </div>
      <div className="form-row">
        <label>Max concurrent jobs</label>
        <input
          className="input"
          type="number"
          min={1}
          step={1}
          value={maxConcurrent}
          onChange={(e) => setMaxConcurrent(e.target.value)}
          placeholder="e.g. 4 — leave empty for uncalibrated"
        />
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
          Soft cap powering the saturation heatmap on the {kindLabel}s list. activeJobs / max
          determines the tile colour (green → red).
        </div>
      </div>
      <button
        className="btn btn-primary btn-sm"
        style={{ alignSelf: 'flex-start' }}
        disabled={!dirty || saving}
        onClick={save}
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

/* ─── Actions ─────────────────────────────────────────────────
 * Services include ComfyUI control actions (Restart / Empty VRAM / Clear
 * cache) since those are service-level — a single ComfyUI process. Hosts
 * never expose these: a host can run multiple services so a "restart"
 * action at the host tier would be ambiguous. */

const COMFY_ACTIONS = [
  {
    id: 'restart',
    title: 'Restart ComfyUI',
    desc: 'Restart the ComfyUI process. Running jobs are interrupted; waiting jobs resume after restart.',
    btn: 'Restart ComfyUI',
    tone: 'warn',
  },
  {
    id: 'vram',
    title: 'Empty VRAM',
    desc: 'Unload all models and clear GPU memory. Next job will reload checkpoints.',
    btn: 'Empty VRAM',
    tone: '',
  },
  {
    id: 'cache',
    title: 'Clear cache',
    desc: 'Wipe local model cache, intermediate tensors, and temp render files.',
    btn: 'Clear cache',
    tone: '',
  },
] as const

export function ServerActions({
  server,
  onDelete,
  kindLabel,
}: {
  server: ServerType
  onDelete: () => void
  kindLabel: KindLabel
}) {
  const { notify } = useNotifications()
  const [confirming, setConfirming] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  async function runComfyAction(id: string) {
    const path = id === 'restart' ? 'restart' : id === 'vram' ? 'empty-vram' : 'clear-cache'
    setActionBusy(id)
    try {
      await api.post(`/api/servers/${server.id}/comfy/${path}`, {})
      notify({
        variant: 'success',
        title: 'Done',
        body: (COMFY_ACTIONS.find((a) => a.id === id)?.btn ?? '') + ' completed.',
      })
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Action failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setActionBusy(null)
    }
  }

  // Services-only: ComfyUI control actions, and only when this is a workflow
  // service (LoRA services don't run ComfyUI).
  const actions = kindLabel === 'service' && server.type !== 'lora' ? COMFY_ACTIONS : []

  return (
    <div
      className="grid-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
    >
      {actions.map((a) => (
        <div key={a.id} className="card card-pad col" style={{ gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{a.title}</strong>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{a.desc}</div>
          <button
            className={`btn btn-sm${a.tone === 'warn' ? '' : ' btn-primary'}`}
            style={{ alignSelf: 'flex-start' }}
            disabled={actionBusy !== null}
            onClick={() => runComfyAction(a.id)}
          >
            {actionBusy === a.id ? 'Working…' : a.btn}
          </button>
        </div>
      ))}
      <div className="card card-pad col" style={{ gap: 10, borderColor: 'var(--bad)' }}>
        <strong style={{ fontSize: 14, color: 'var(--bad)' }}>Delete {kindLabel}</strong>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Removes <strong>{server.name}</strong> from the database. Past jobs that referenced it are
          kept (their <code>server_id</code> becomes null). This cannot be undone.
        </div>
        {confirming ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              className="btn btn-sm"
              style={{ background: 'var(--bad)', color: 'white', borderColor: 'var(--bad)' }}
              onClick={onDelete}
            >
              Yes, delete {server.name}
            </button>
          </div>
        ) : (
          <button
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start', color: 'var(--bad)', borderColor: 'var(--bad)' }}
            onClick={() => setConfirming(true)}
          >
            Delete {kindLabel}
          </button>
        )}
      </div>
    </div>
  )
}
