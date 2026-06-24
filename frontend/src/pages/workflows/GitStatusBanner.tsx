import { useState, useEffect, useCallback } from 'react'
import { GitBranch, Download, Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api } from '../../lib/api'

type GitStatus = {
  enabled: boolean
  branch: string | null
  ahead: number
  behind: number
  dirty: number
  branches: string[]
  /** Count of workflows referencing a globalEnv key still defaulted to
   *  localhost — i.e. a real server hasn't been bound yet. */
  needsServer: number
  error?: string
}

const POLL_MS = 60_000 // matches the server-side fetch cache; sooner just re-reads

const UPDATE_CONFIRM =
  'Update brings in the latest version. Your current local changes are saved in ' +
  'History and can be restored. Continue?'

const DISCARD_CONFIRM =
  'Discard all your local changes? They are saved to History and can be restored. ' +
  'This does not pull the latest — use Update for that. Continue?'

/**
 * Git status strip for the workflows shell — reflects real repo state and wires
 * the Update / Publish actions. Update is conflict-free (snapshot + take-theirs,
 * recoverable from History); Publish squashes + fast-forward pushes and is
 * refused when behind ("Update first"). Renders nothing when git is disabled.
 */
export function GitStatusBanner({ onChanged }: { onChanged?: () => void }) {
  const [st, setSt] = useState<GitStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      api
        .get<GitStatus>('/api/git/status')
        .then(setSt)
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) void load()
    }
    tick()
    const t = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [load])

  async function run(path: string) {
    setBusy(true)
    setActionError(null)
    try {
      await api.post(path, {})
      await load()
      onChanged?.()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  function onUpdate() {
    if (window.confirm(UPDATE_CONFIRM)) void run('/api/git/update')
  }
  function onPublish() {
    void run('/api/git/publish')
  }
  function onDiscard() {
    if (window.confirm(DISCARD_CONFIRM)) void run('/api/git/discard')
  }
  async function onSwitch(branch: string) {
    if (!st || branch === st.branch) return
    setBusy(true)
    setActionError(null)
    try {
      await api.post('/api/git/switch', { branch })
      await load()
      onChanged?.()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Branch switch failed')
    } finally {
      setBusy(false)
    }
  }

  if (!st || !st.enabled) return null

  const unpublished = st.dirty > 0 || st.ahead > 0
  let tone: string
  let Icon = CheckCircle2
  let text = 'Up to date'
  let action: { label: string; onClick: () => void } | null = null

  if (st.error) {
    tone = 'var(--warn)'
    Icon = AlertTriangle
    text = 'Git status unavailable'
  } else if (st.behind > 0) {
    tone = 'var(--info)'
    Icon = Download
    text = `${st.behind} update${st.behind === 1 ? '' : 's'} available`
    action = { label: 'Update', onClick: onUpdate }
  } else if (unpublished) {
    tone = 'var(--warn)'
    Icon = Upload
    text = 'You have unpublished changes'
    action = { label: 'Publish', onClick: onPublish }
  } else {
    tone = 'var(--good)'
  }

  return (
    <div className="git-bar" style={{ borderLeft: `3px solid ${tone}` }}>
      <div className="git-bar-row">
        <Icon size={15} style={{ color: tone }} />
        <span style={{ fontWeight: 600 }}>{text}</span>
        {st.error && (
          <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }} title={st.error}>
            {st.error.length > 80 ? st.error.slice(0, 80) + '…' : st.error}
          </span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        {st.branches.length > 1 ? (
          <span
            className="row"
            style={{ gap: 4, alignItems: 'center' }}
            title={st.dirty > 0 ? 'Publish or discard changes before switching' : 'Switch branch'}
          >
            <GitBranch size={11} style={{ color: 'var(--ink-3)' }} />
            <select
              className="input mono"
              style={{ fontSize: 11, height: 24, padding: '0 4px' }}
              value={st.branch ?? ''}
              disabled={busy || st.dirty > 0}
              onChange={(e) => void onSwitch(e.target.value)}
            >
              {st.branch && !st.branches.includes(st.branch) && (
                <option value={st.branch}>{st.branch}</option>
              )}
              {st.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </span>
        ) : (
          st.branch && (
            <span className="chip row mono" style={{ gap: 4, fontSize: 11 }} title="Current branch">
              <GitBranch size={11} /> {st.branch}
            </span>
          )
        )}
        {(st.dirty > 0 || st.ahead > 0) && (
          <button className="btn btn-sm" disabled={busy} onClick={onDiscard}>
            Discard
          </button>
        )}
        {action && (
          <button
            className="btn btn-sm"
            disabled={busy}
            style={{ opacity: busy ? 0.5 : 1 }}
            onClick={action.onClick}
          >
            {busy ? 'Working…' : action.label}
          </button>
        )}
      </div>
      {actionError && (
        <div style={{ color: 'var(--bad)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{actionError}</div>
      )}
      {st.needsServer > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>
          {st.needsServer} workflow{st.needsServer === 1 ? '' : 's'} need
          {st.needsServer === 1 ? 's' : ''} a server — set their URL in the workflow editor.
        </div>
      )}
    </div>
  )
}
