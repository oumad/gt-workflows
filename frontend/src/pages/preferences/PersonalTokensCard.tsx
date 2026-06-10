import { useState, useEffect, useCallback } from 'react'
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  X,
  AlertCircle,
  Terminal,
} from 'lucide-react'
import { api } from '../../lib/api'
import { copyToClipboard } from '../../lib/clipboard'

/* ─── Wire DTOs (match api/src/services/personalTokens.ts) ─────── */
type PersonalToken = {
  id: string
  userId: string
  label: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

type CreateResult = PersonalToken & { token: string }

/* ─── Helpers ──────────────────────────────────────────────────── */
function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function mcpConfigSnippet(token: string): string {
  const url = `${window.location.origin}/api/mcp`
  return JSON.stringify(
    {
      mcpServers: {
        'coffee-maker': {
          url,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  )
}

function claudeCodeSnippet(token: string): string {
  const url = `${window.location.origin}/api/mcp`
  return `claude mcp add coffee-maker --transport http --url ${url} --header "Authorization: Bearer ${token}"`
}

/* ─── Component ───────────────────────────────────────────────── */
export function PersonalTokensCard() {
  const [tokens, setTokens] = useState<PersonalToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [freshToken, setFreshToken] = useState<CreateResult | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.get<PersonalToken[]>('/api/personal-tokens')
      setTokens(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tokens')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const activeTokens = tokens.filter((t) => !t.revokedAt)

  async function createToken(label: string) {
    setCreating(true)
    try {
      const r = await api.post<CreateResult>('/api/personal-tokens', { label })
      setFreshToken(r)
      setCreateOpen(false)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  async function revokeToken(id: string) {
    if (
      !window.confirm(
        'Revoke this token? Any MCP client or script using it stops working immediately.',
      )
    )
      return
    setRevoking(id)
    try {
      await api.del(`/api/personal-tokens/${id}`)
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revoke')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <>
      <div className="card card-pad col" style={{ gap: 12 }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="card-title">Personal tokens</div>
          <span className="chip" style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)' }}>
            new
          </span>
          <span className="spacer" />
          <button
            className="btn btn-sm btn-ghost btn-icon"
            onClick={refresh}
            disabled={loading}
            title="Reload"
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setCreateOpen(true)}
            disabled={creating}
          >
            <Plus size={12} /> New token
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          Long-lived bearer tokens for programmatic access and MCP. Use as{' '}
          <code>Authorization: Bearer cm_pat_…</code> against{' '}
          <code>{window.location.origin}/api</code>. Tokens inherit your role — a viewer's token is
          read-only, a designer's can edit workflows. Revoke individually any time.
        </div>

        {error && (
          <div
            className="row"
            style={{
              gap: 8,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--bad-soft)',
              color: 'var(--bad)',
              fontSize: 12,
            }}
          >
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Loading…</div>
        ) : activeTokens.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              padding: '8px 0',
              fontStyle: 'italic',
            }}
          >
            No tokens yet. Click <strong>New token</strong> to generate one — you'll see the secret
            once.
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {activeTokens.map((t) => (
              <div
                key={t.id}
                className="row"
                style={{
                  gap: 10,
                  padding: '8px 12px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  alignItems: 'center',
                }}
              >
                <KeyRound size={13} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{t.label}</strong>
                    <span
                      className="mono"
                      style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
                      title={t.prefix}
                    >
                      {t.prefix}…
                    </span>
                  </div>
                  <div className="row" style={{ gap: 8, fontSize: 10.5, color: 'var(--ink-3)' }}>
                    <span>created {relTime(t.createdAt)}</span>
                    <span>·</span>
                    <span>last used {relTime(t.lastUsedAt)}</span>
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'var(--bad)', flexShrink: 0 }}
                  onClick={() => revokeToken(t.id)}
                  disabled={revoking === t.id}
                  title="Revoke"
                >
                  {revoking === t.id ? (
                    <RefreshCw size={11} className="spin" />
                  ) : (
                    <Trash2 size={11} />
                  )}
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateTokenModal
          onCancel={() => setCreateOpen(false)}
          onCreate={createToken}
          busy={creating}
        />
      )}

      {freshToken && <FreshTokenModal token={freshToken} onClose={() => setFreshToken(null)} />}
    </>
  )
}

/* ─── Create-token modal ───────────────────────────────────────── */
function CreateTokenModal({
  onCancel,
  onCreate,
  busy,
}: {
  onCancel: () => void
  onCreate: (label: string) => void
  busy: boolean
}) {
  const [label, setLabel] = useState('')

  function submit() {
    const trimmed = label.trim()
    if (!trimmed) return
    onCreate(trimmed)
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,.4)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card card-pad col"
        style={{ gap: 14, width: 440, maxWidth: '100%' }}
      >
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <KeyRound size={18} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 15 }}>New personal token</strong>
          <span className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onCancel} title="Cancel">
            <X size={14} />
          </button>
        </div>

        <div className="form-row">
          <label>Label</label>
          <input
            className="input"
            autoFocus
            placeholder="Claude on my laptop, gt-plugins sync, …"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim() && !busy) submit()
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Helps you tell tokens apart later — appears in the list and in audit logs.
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={!label.trim() || busy}
          >
            {busy ? 'Generating…' : 'Generate token'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Fresh-token modal (one-time reveal) ──────────────────────── */
function FreshTokenModal({
  token,
  onClose,
}: {
  token: PersonalToken & { token: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'token' | 'mcp' | 'cli' | null>(null)
  const mcp = mcpConfigSnippet(token.token)
  const cli = claudeCodeSnippet(token.token)

  async function copy(kind: 'token' | 'mcp' | 'cli', text: string) {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(kind)
      setTimeout(() => setCopied(null), 1800)
    } else {
      // Both the modern API and the execCommand fallback failed — rare, but
      // the user deserves to know rather than wondering why the chip never
      // appeared. window.alert keeps the dependency surface tiny here.
      window.alert('Copy failed — your browser blocked clipboard access. Select the text manually.')
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,.45)',
        backdropFilter: 'blur(2px)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card card-pad col"
        style={{ gap: 14, width: 640, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto' }}
      >
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <KeyRound size={18} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 15 }}>{token.label}</strong>
          <span className="spacer" />
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>

        <div
          className="row"
          style={{
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'color-mix(in oklab, var(--warn) 14%, var(--surface))',
            color: 'var(--warn)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>Copy this token now.</strong> It will not be shown again — if you lose it,
            generate a new one and revoke this one.
          </span>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>Token</label>
          <div className="row" style={{ gap: 6 }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {token.token}
            </code>
            <button
              className="btn btn-sm"
              onClick={() => copy('token', token.token)}
              style={{ flexShrink: 0 }}
            >
              {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
              {copied === 'token' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>
            <Terminal size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Claude Desktop — add to <code>claude_desktop_config.json</code>
          </label>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              fontSize: 11.5,
              fontFamily: 'var(--font-mono)',
              overflow: 'auto',
              maxHeight: 180,
              position: 'relative',
            }}
          >
            {mcp}
          </pre>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => copy('mcp', mcp)}
            style={{ alignSelf: 'flex-end' }}
          >
            {copied === 'mcp' ? <Check size={11} /> : <Copy size={11} />}
            {copied === 'mcp' ? 'Copied' : 'Copy snippet'}
          </button>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>
            <Terminal size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Claude Code — one-liner
          </label>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              fontSize: 11.5,
              fontFamily: 'var(--font-mono)',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {cli}
          </pre>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => copy('cli', cli)}
            style={{ alignSelf: 'flex-end' }}
          >
            {copied === 'cli' ? <Check size={11} /> : <Copy size={11} />}
            {copied === 'cli' ? 'Copied' : 'Copy command'}
          </button>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onClose}>
            I've saved the token
          </button>
        </div>
      </div>
    </div>
  )
}
