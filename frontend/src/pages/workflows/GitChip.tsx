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
const RETRY_MS = 5_000 // before the first success (status fetch is slow / may fail)

// Last status, cached at module scope so the chip shows instantly on remount
// (navigating back to Workflows) instead of blinking out while it refetches.
let cached: GitStatus | null = null

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
  const [st, setSt] = useState<GitStatus | null>(() => cached)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // On failure keep the last status (don't blank the chip); retry fast until the
  // first success, then settle to the slow poll.
  const load = useCallback(
    () =>
      api
        .get<GitStatus>('/api/git/status')
        .then((s) => {
          cached = s
          setSt(s)
        })
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    let alive = true
    let timer: number
    const tick = async () => {
      await load()
      if (alive) timer = window.setTimeout(tick, cached ? POLL_MS : RETRY_MS)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
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

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await load()
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  function run(path: string, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    void act(() => api.post(path, {}))
  }
  function onSwitch(branch: string) {
    if (!st) return
    void act(() => api.post('/api/git/switch', { branch }))
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
            {st.branches
              .filter((b) => b !== st.branch)
              .map((b) => (
                <button
                  key={b}
                  className="btn btn-sm mono"
                  style={{ fontSize: 11, height: 24, padding: '0 8px' }}
                  disabled={busy || st.dirty > 0}
                  title={
                    st.dirty > 0
                      ? 'Publish or discard changes before switching'
                      : `Switch to ${b}`
                  }
                  onClick={() => onSwitch(b)}
                >
                  {b}
                </button>
              ))}
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
