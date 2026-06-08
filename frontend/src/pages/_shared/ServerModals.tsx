import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useNotifications } from '../../context/NotificationsContext'
import { api } from '../../lib/api'
import type { Server as ServerType, ServerKind } from '../../types'
import { validateHostOnlyUrl, normalizeHostOnlyUrl } from './serverHelpers'

export type KindLabel = 'service' | 'server'

/* ═══════════════════════════════════════════════
   ADD SERVER MODAL
   Two flavours selected by `kindLabel`:
     - 'service': pick a registered host, choose type (workflow/lora), give it
        a port. URL is composed as `<host>:<port>` and POSTed to /api/servers.
     - 'server':  host-only URL (no port). Type is service-level so isn't
        collected here; payload defaults to 'workflow' for back-compat with
        /api/servers (which still requires a type until the schema splits
        hosts and services).
   The forms share the modal shell, name + tags inputs, error display, and
   footer; the middle (host picker+port+type vs URL+help) branches inline. */

const DEFAULT_PORT: Record<ServerKind, number> = {
  workflow: 8188,
  lora: 8675,
}

const TITLE_FOR: Record<KindLabel, string> = {
  service: 'Add service',
  server: 'Add server',
}

const NAME_LABEL_FOR: Record<KindLabel, string> = {
  service: 'Service name',
  server: 'Server name',
}

const NAME_PLACEHOLDER_FOR: Record<KindLabel, string> = {
  service: 'e.g. worker-03-comfy',
  server: 'e.g. worker-03',
}

const SUBMIT_FOR: Record<KindLabel, string> = {
  service: 'Create service',
  server: 'Create server',
}

type AddServerModalProps = {
  onClose: () => void
  onCreated: (s: ServerType) => void
  defaultUrl?: string
} & ({ kindLabel: 'service'; servers: ServerType[] } | { kindLabel: 'server'; servers?: never })

export function AddServerModal(props: AddServerModalProps) {
  const { kindLabel, onClose, onCreated, defaultUrl } = props
  const servers = kindLabel === 'service' ? props.servers : []

  // Deep-link seed: /(services|servers)?addUrl=… pre-selects the matching host
  // (services) or pre-fills the URL field (servers). Harmless no-op if the
  // URL can't be parsed.
  const seed = (() => {
    if (!defaultUrl) return null
    try {
      const u = new URL(/^https?:\/\//i.test(defaultUrl) ? defaultUrl : `http://${defaultUrl}`)
      return { host: u.hostname, port: u.port ? parseInt(u.port, 10) : null }
    } catch {
      return null
    }
  })()
  const hostOf = (s: ServerType): string | null => {
    try {
      const u = new URL(/^https?:\/\//i.test(s.url) ? s.url : `http://${s.url}`)
      return u.hostname
    } catch {
      return null
    }
  }
  const seededServer =
    kindLabel === 'service' && seed ? (servers.find((s) => hostOf(s) === seed.host) ?? null) : null

  const [name, setName] = useState(seed?.host?.split('.')[0] ?? '')
  // Tags + busy + err are shared between both flavours.
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // services-only state (initialised unconditionally so hook order is stable).
  const [serverId, setServerId] = useState(seededServer?.id ?? servers[0]?.id ?? '')
  const [type, setType] = useState<ServerKind>('workflow')
  const [port, setPort] = useState<number>(seed?.port ?? DEFAULT_PORT.workflow)
  // servers-only state.
  const [url, setUrl] = useState(seed?.host ?? '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) {
      setErr(`${kindLabel === 'service' ? 'Service' : 'Server'} name is required.`)
      return
    }
    let composedUrl: string
    let typeToPost: ServerKind
    if (kindLabel === 'service') {
      const selected = servers.find((s) => s.id === serverId)
      if (!selected) {
        setErr('Please select a server.')
        return
      }
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        setErr('Port must be between 1 and 65535.')
        return
      }
      // Compose URL from the server's host + chosen port. Strip any port already
      // attached to the server's URL — the host record should be port-less.
      try {
        const u = new URL(
          /^https?:\/\//i.test(selected.url) ? selected.url : `http://${selected.url}`,
        )
        composedUrl = `${u.protocol}//${u.hostname}:${port}`
      } catch {
        setErr('Selected server has an invalid URL.')
        return
      }
      typeToPost = type
    } else {
      const v = validateHostOnlyUrl(url)
      if (!v.ok) {
        setErr(v.message)
        return
      }
      composedUrl = v.url
      // Type is service-level; servers are type-less. Default to 'workflow' so
      // the existing backend schema (which still requires a type) is satisfied
      // — this can come out once the schema splits hosts and services.
      typeToPost = 'workflow'
    }
    setBusy(true)
    try {
      const created = await api.post<ServerType>('/api/servers', {
        id: crypto.randomUUID(),
        name: name.trim(),
        url: composedUrl,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        type: typeToPost,
      })
      onCreated(created)
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : `Failed to create ${kindLabel === 'service' ? 'service' : 'server'}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    kindLabel === 'service'
      ? !!serverId && name.trim().length > 0 && port > 0 && !busy
      : name.trim().length > 0 && url.trim().length > 0 && !busy

  return (
    <Modal title={TITLE_FOR[kindLabel]} onClose={onClose}>
      <form onSubmit={submit} className="col" style={{ gap: 14 }}>
        <div className="form-row">
          <label>{NAME_LABEL_FOR[kindLabel]}</label>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={NAME_PLACEHOLDER_FOR[kindLabel]}
          />
        </div>
        {kindLabel === 'service' ? (
          <>
            <div className="form-row">
              <label>Server</label>
              {servers.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  No servers registered — add one in the Servers tool first.
                </div>
              ) : (
                <select
                  className="input select"
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                >
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.url}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-row">
              <label>Type</label>
              <div className="toggle-group">
                <button
                  type="button"
                  className={type === 'workflow' ? 'active' : ''}
                  onClick={() => setType('workflow')}
                >
                  Workflow
                </button>
                <button
                  type="button"
                  className={type === 'lora' ? 'active' : ''}
                  onClick={() => setType('lora')}
                >
                  LoRA
                </button>
              </div>
            </div>
            <div className="form-row">
              <label>Port</label>
              <input
                className="input mono"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                placeholder={String(DEFAULT_PORT[type])}
              />
            </div>
          </>
        ) : (
          <div className="form-row">
            <label>URL</label>
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
          </div>
        )}
        <div className="form-row">
          <label>Tags</label>
          <input
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="comma-separated (e.g. worker, gpu)"
          />
        </div>
        {err && (
          <div className="alert alert-error" style={{ fontSize: 12 }}>
            {err}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!canSubmit}>
            {busy ? 'Creating…' : SUBMIT_FOR[kindLabel]}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ═══════════════════════════════════════════════
   REPORT ISSUE MODAL
   Identical between services and servers — only the field label differs
   ("Service" vs "Server"). Parameterized via `kindLabel`. */

const RIM_LABEL_FOR: Record<KindLabel, string> = {
  service: 'Service',
  server: 'Server',
}

export function ReportIssueModal({
  server,
  onClose,
  kindLabel,
}: {
  server: ServerType
  onClose: () => void
  kindLabel: KindLabel
}) {
  const { notify } = useNotifications()
  const [issue, setIssue] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      await api.post(`/api/servers/${server.id}/report`, { message: issue.trim() })
      notify({ variant: 'success', title: `Issue for ${server.name} sent`, autoDismiss: 4000 })
      onClose()
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Failed to send report',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title="Report issue" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="form-row">
          <label>{RIM_LABEL_FOR[kindLabel]}</label>
          <input className="input" value={server.name} readOnly style={{ color: 'var(--ink-3)' }} />
        </div>
        <div className="form-row">
          <label>Issue</label>
          <textarea
            className="input"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Describe the issue…"
            style={{
              minHeight: 100,
              fontFamily: 'inherit',
              fontSize: 13.5,
              lineHeight: 1.6,
              resize: 'vertical',
            }}
            autoFocus
          />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={send}
            disabled={!issue.trim() || sending}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
