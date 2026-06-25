import { useState, useEffect, useCallback, useRef } from 'react'
import { GitBranch, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'
import { api } from '../../lib/api'

type GitStatus = {
  enabled: boolean
  branch: string | null
  ahead: number
  behind: number
  dirty: number
  branches: string[]
  error?: string
}

const POLL_MS = 60_000 // matches the server-side fetch cache

const UPDATE_CONFIRM =
  'Update brings in the latest version. Your current local changes are saved in ' +
  'History and can be restored. Continue?'
const DISCARD_CONFIRM =
  'Discard all your local changes? They are saved to History and can be restored. ' +
  'This does not pull the latest — use Update for that. Continue?'

/**
 * Git status as a compact chip in the page header + a click-through popover with
 * branch switch / discard / publish. Workspace-scoped (the whole workflows repo),
 * so it lives on the list header only — never in a single workflow's detail view.
 * Renders nothing when git is disabled.
 */
export function GitChip({ onChanged }: { onChanged?: () => void }) {
  const [st, setSt] = useState<GitStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    () => api.get<GitStatus>('/api/git/status').then(setSt).catch(() => {}),
    [],
  )

  useEffect(() => {
    let cancelled = false
    const tick = () => !cancelled && void load()
    tick()
    const t = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [load])

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function run(path: string, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(path, {})
      await load()
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSwitch(branch: string) {
    if (!st || branch === st.branch) return
    setBusy(true)
    setErr(null)
    try {
      await api.post('/api/git/switch', { branch })
      await load()
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Branch switch failed')
    } finally {
      setBusy(false)
    }
  }

  if (!st || !st.enabled) return null

  const incoming = st.behind
  const toPublish = st.dirty > 0 ? st.dirty : st.ahead

  // Chip tone + label. Behind (blue) takes priority over unpublished (amber).
  let tone = 'var(--good)'
  let label = 'Up to date'
  let glyph: 'dot' | 'up' | 'down' = 'dot'
  if (st.error) {
    tone = 'var(--warn)'
    label = 'Unavailable'
  } else if (incoming > 0) {
    tone = 'var(--info)'
    label = `${incoming} incoming`
    glyph = 'down'
  } else if (toPublish > 0) {
    tone = 'var(--warn)'
    label = `${toPublish} to publish`
    glyph = 'up'
  }

  const Indicator =
    glyph === 'up' ? (
      <ArrowUp size={12} style={{ color: tone }} />
    ) : glyph === 'down' ? (
      <ArrowDown size={12} style={{ color: tone }} />
    ) : (
      <span style={{ width: 7, height: 7, borderRadius: 999, background: tone }} />
    )

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="row"
        onClick={() => setOpen((o) => !o)}
        title="Workflows repo status"
        style={{
          gap: 6,
          height: 30,
          padding: '0 10px',
          borderRadius: 999,
          border: '1px solid var(--line)',
          background: open ? 'var(--surface-2)' : 'var(--surface)',
          fontSize: 12,
          cursor: 'pointer',
          color: 'var(--ink)',
        }}
      >
        <GitBranch size={12} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontWeight: 600 }} className="mono">
          {st.branch ?? '—'}
        </span>
        <span style={{ width: 1, height: 14, background: 'var(--line)' }} />
        {Indicator}
        <span style={{ color: 'var(--ink-2)' }}>{label}</span>
        <ChevronDown size={12} style={{ color: 'var(--ink-3)' }} />
      </button>

      {open && (
        <div
          className="col"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            width: 280,
            gap: 12,
            padding: 14,
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)',
            cursor: 'default',
          }}
        >
          {/* branch + switch */}
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <GitBranch size={13} style={{ color: 'var(--ink-3)' }} />
            <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
              {st.branch ?? '—'}
            </span>
            <span className="spacer" style={{ flex: 1 }} />
            {st.branches.length > 1 && (
              <select
                className="input mono"
                style={{ fontSize: 11, height: 26, padding: '0 6px', width: 'auto' }}
                value=""
                disabled={busy || st.dirty > 0}
                title={st.dirty > 0 ? 'Publish or discard changes before switching' : 'Switch branch'}
                onChange={(e) => void onSwitch(e.target.value)}
              >
                <option value="" disabled>
                  Switch…
                </option>
                {st.branches
                  .filter((b) => b !== st.branch)
                  .map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
              </select>
            )}
          </div>

          {/* counts */}
          <div className="row" style={{ gap: 16, fontSize: 12 }}>
            <span className="row" style={{ gap: 5 }}>
              <ArrowUp size={13} style={{ color: toPublish > 0 ? 'var(--warn)' : 'var(--ink-3)' }} />
              <strong>{toPublish}</strong>
              <span style={{ color: 'var(--ink-3)' }}>to publish</span>
            </span>
            <span className="row" style={{ gap: 5 }}>
              <ArrowDown size={13} style={{ color: incoming > 0 ? 'var(--info)' : 'var(--ink-3)' }} />
              <strong>{incoming}</strong>
              <span style={{ color: 'var(--ink-3)' }}>incoming</span>
            </span>
          </div>

          {/* actions */}
          {st.error ? (
            <div style={{ color: 'var(--warn)', fontSize: 11.5 }}>Git status unavailable.</div>
          ) : incoming > 0 ? (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => void run('/api/git/update', UPDATE_CONFIRM)}
            >
              {busy ? 'Working…' : `Update ${incoming}`}
            </button>
          ) : toPublish > 0 ? (
            <div className="row" style={{ gap: 6 }}>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void run('/api/git/discard', DISCARD_CONFIRM)}
              >
                Discard
              </button>
              <button
                className="btn btn-sm btn-primary"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => void run('/api/git/publish')}
              >
                {busy ? 'Working…' : `Publish ${toPublish}`}
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>Everything is up to date.</div>
          )}

          {err && <div style={{ color: 'var(--bad)', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{err}</div>}
        </div>
      )}
    </div>
  )
}
