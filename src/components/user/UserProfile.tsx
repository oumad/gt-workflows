import React, { useState, useEffect } from 'react'
import { User, Shield, Eye, Clock, LogOut, Check, Stethoscope, Bell, RotateCw } from 'lucide-react'
import { useAuth, clearStoredAuth } from '@/features/auth'
import { usePreferences } from '@/hooks/usePreferences'
import { updatePreferences } from '@/services/api/preferences'
import { getStoredSessionMaxTime } from '@/utils/auth'
import { getWeeklyRestartCheckConfig, updateWeeklyRestartCheckConfig, testWeeklyRestartCheck, type WeeklyRestartCheckConfig, type WeeklyRestartCheckTestResult } from '@/services/api/weeklyRestartCheck'
import { CalendarEvents } from './CalendarEvents'

const AUTH_TIME_KEY = 'gt-workflows-auth-time'

function getLoginTime(): Date | null {
  try {
    const v = sessionStorage.getItem(AUTH_TIME_KEY)
    if (!v) return null
    const ts = parseInt(v, 10)
    return Number.isNaN(ts) ? null : new Date(ts)
  } catch {
    return null
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// ── Session timer ────────────────────────────────────────────────────────────

function SessionTimer({ loginTime }: { loginTime: Date }) {
  const [elapsed, setElapsed] = useState(Date.now() - loginTime.getTime())

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - loginTime.getTime()), 1000)
    return () => clearInterval(id)
  }, [loginTime])

  const maxMs = getStoredSessionMaxTime() * 1000
  const remaining = Math.max(0, maxMs - elapsed)
  const pct = Math.min(100, (elapsed / maxMs) * 100)
  const isExpiring = remaining < 5 * 60 * 1000

  return (
    <div className="flex flex-col gap-[0.35rem] pt-[0.3rem]">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Active for</span>
        <span className="text-primary font-semibold tabular-nums">{formatDuration(elapsed)}</span>
      </div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Expires in</span>
        <span className={`font-semibold tabular-nums ${isExpiring ? 'text-[#d4a335]' : 'text-primary'}`}>
          {formatDuration(remaining)}
        </span>
      </div>
      <div className="h-1 rounded-sm bg-tertiary overflow-hidden mt-[0.2rem]">
        <div
          className="h-full rounded-sm"
          style={{
            width: `${pct}%`,
            background: isExpiring
              ? 'linear-gradient(90deg,#7a4000,#d4a335)'
              : 'linear-gradient(90deg,#4a2670,#9366cc)',
            transition: 'width 1s linear',
          }}
        />
      </div>
    </div>
  )
}

// ── Preference toggle ────────────────────────────────────────────────────────

function PrefToggle({ label, description, checked, onChange }: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <div className="flex flex-col gap-[0.15rem] min-w-0">
        <span className="text-sm text-primary">{label}</span>
        {description && <span className="text-sm text-muted leading-[1.35]">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`relative w-9 h-5 rounded-[10px] cursor-pointer shrink-0 transition-colors duration-200 border-none ${checked ? 'bg-accent' : 'bg-[#4a5d73]'}`}
        onClick={() => onChange(!checked)}
      >
        <span
          className={`absolute top-[3px] left-[3px] w-[14px] h-[14px] rounded-full transition-all duration-200 shadow-sm ${checked ? 'translate-x-4 bg-white' : 'translate-x-0 bg-white/70'}`}
        />
      </button>
    </label>
  )
}

// ── Section card ─────────────────────────────────────────────────────────────

const CLS_SECTION = 'bg-secondary border border-default rounded-[10px] p-[1.1rem_1.25rem] flex flex-col gap-[0.7rem] min-w-0'
const CLS_SECTION_HEADER = 'flex items-center gap-[0.4rem] text-muted mb-[0.1rem]'
const CLS_SECTION_TITLE = 'text-sm font-semibold uppercase tracking-[0.06em] text-muted m-0 flex-1'
const CLS_INFO_ROW = 'flex items-baseline justify-between gap-2 text-sm'

// ── Main component ───────────────────────────────────────────────────────────

export function UserProfile(): React.ReactElement {
  const { username, role, authEnabled, setAuthStatus } = useAuth()
  const { preferences, invalidate } = usePreferences()
  const [discordEnabled, setDiscordEnabled] = useState(false)
  useEffect(() => {
    import('@/services/api/servers').then(({ getMonitoringConfig }) =>
      getMonitoringConfig().then((cfg) => setDiscordEnabled(!!cfg.discordEnabled)).catch(() => {})
    )
  }, [])
  const loginTime = getLoginTime()

  const [saving, setSaving] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  // ── Weekly restart check config ──────────────────────────────────────────────
  const [wrc, setWrc] = useState<WeeklyRestartCheckConfig>({
    enabled: false, dayOfWeek: 1, hour: 3, minute: 0, delayMinutes: 30,
  })
  const [wrcSaving, setWrcSaving] = useState(false)
  const [wrcSaved, setWrcSaved] = useState(false)
  const [wrcTesting, setWrcTesting] = useState(false)
  const [wrcTestResult, setWrcTestResult] = useState<WeeklyRestartCheckTestResult | null>(null)
  const [wrcTestError, setWrcTestError] = useState<string | null>(null)

  useEffect(() => {
    if (role !== 'admin') return
    getWeeklyRestartCheckConfig()
      .then(setWrc)
      .catch(() => {})
  }, [role])

  const handleWrcChange = (patch: Partial<WeeklyRestartCheckConfig>) => {
    setWrc((prev) => ({ ...prev, ...patch }))
  }

  const handleWrcSave = async () => {
    setWrcSaving(true)
    try {
      const saved = await updateWeeklyRestartCheckConfig(wrc)
      setWrc(saved)
      setWrcSaved(true)
      setTimeout(() => setWrcSaved(false), 1500)
    } catch {
      // ignore
    } finally {
      setWrcSaving(false)
    }
  }

  const handleWrcTest = async () => {
    setWrcTesting(true)
    setWrcTestResult(null)
    setWrcTestError(null)
    try {
      const result = await testWeeklyRestartCheck()
      setWrcTestResult(result)
    } catch (err) {
      setWrcTestError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setWrcTesting(false)
    }
  }

  const handlePrefChange = async (key: string, value: boolean) => {
    setSaving(true)
    try {
      await updatePreferences({ [key]: value })
      invalidate()
      setSavedKey(key)
      setTimeout(() => setSavedKey(null), 1500)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    clearStoredAuth()
    setAuthStatus('required')
  }

  const initials = username ? username.slice(0, 2).toUpperCase() : '?'

  return (
    <div className="max-w-[860px] mx-auto py-8 px-6">
      {/* ── Profile card ─────────────────────────────────────────── */}
      <div className="flex items-center gap-5 bg-secondary border border-default rounded-xl p-6 mb-6">
        <div
          className="w-[60px] h-[60px] rounded-full flex items-center justify-center text-[1.3rem] font-bold text-white shrink-0 tracking-[0.02em]"
          style={{ background: 'linear-gradient(135deg,#4a2670,#7a4db0)' }}
        >
          {username ? initials : <User size={28} />}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-[0.4rem]">
          <h1 className="text-[1.3rem] font-bold text-primary m-0 leading-[1.2] overflow-hidden text-ellipsis whitespace-nowrap">{username ?? 'Anonymous'}</h1>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.2rem] rounded-[20px] text-sm font-semibold tracking-[0.02em] ${role === 'admin' ? 'bg-accent/20 text-[#c9a6f0] border border-accent/35' : 'bg-muted/10 text-muted border border-muted/20'}`}>
              <Shield size={11} />
              {role === 'admin' ? 'Administrator' : 'Guest'}
            </span>
            {!authEnabled && (
              <span className="inline-flex items-center gap-[0.3rem] px-[0.55rem] py-[0.2rem] rounded-[20px] text-sm font-semibold tracking-[0.02em] bg-semantic-success/10 text-semantic-success border border-semantic-success/20">
                Auth disabled
              </span>
            )}
          </div>
        </div>
        {authEnabled && (
          <button
            type="button"
            className="inline-flex items-center gap-[0.4rem] px-[0.9rem] py-2 bg-transparent border border-default rounded-[7px] text-muted text-sm cursor-pointer shrink-0 transition-all duration-150 hover:bg-semantic-error/10 hover:border-semantic-error/30 hover:text-semantic-error"
            onClick={handleLogout}
            title="Sign out"
          >
            <LogOut size={15} />
            Sign out
          </button>
        )}
      </div>

      {/* ── Info sections grid ───────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-4 max-[680px]:grid-cols-1">
        {/* ── Session ──────────────────────────────────────────────── */}
        <section className={CLS_SECTION}>
          <div className={CLS_SECTION_HEADER}>
            <Clock size={15} />
            <h2 className={CLS_SECTION_TITLE}>Session</h2>
          </div>
          {loginTime ? (
            <>
              <div className={CLS_INFO_ROW}>
                <span className="text-muted shrink-0">Signed in at</span>
                <span className="text-primary font-medium text-right min-w-0 overflow-hidden text-ellipsis whitespace-nowrap max-w-[60%]">{loginTime.toLocaleString()}</span>
              </div>
              <div className={CLS_INFO_ROW}>
                <span className="text-muted shrink-0">Max duration</span>
                <span className="text-primary font-medium text-right">{formatDuration(getStoredSessionMaxTime() * 1000)}</span>
              </div>
              <SessionTimer loginTime={loginTime} />
            </>
          ) : (
            <p className="text-sm text-muted m-0 py-2">No active session data.</p>
          )}
        </section>

        {/* ── Account ──────────────────────────────────────────────── */}
        <section className={CLS_SECTION}>
          <div className={CLS_SECTION_HEADER}>
            <User size={15} />
            <h2 className={CLS_SECTION_TITLE}>Account</h2>
          </div>
          <div className={CLS_INFO_ROW}>
            <span className="text-muted shrink-0">Username</span>
            <span className="font-mono text-sm text-[#c9a6f0] font-medium text-right min-w-0 overflow-hidden text-ellipsis whitespace-nowrap max-w-[60%]">{username ?? '—'}</span>
          </div>
          <div className={CLS_INFO_ROW}>
            <span className="text-muted shrink-0">Role</span>
            <span className="text-primary font-medium text-right">{role === 'admin' ? 'Administrator' : 'Guest'}</span>
          </div>
          <div className={CLS_INFO_ROW}>
            <span className="text-muted shrink-0">Authentication</span>
            <span className="text-primary font-medium text-right">{authEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className={CLS_INFO_ROW}>
            <span className="text-muted shrink-0">Access level</span>
            <span className="text-primary font-medium text-right">{role === 'admin' ? 'Full access' : 'Analytics only'}</span>
          </div>
        </section>

        {/* ── Display preferences (admin only) ─────────────────────── */}
        {role === 'admin' && (
          <section className={CLS_SECTION}>
            <div className={CLS_SECTION_HEADER}>
              <Eye size={15} />
              <h2 className={CLS_SECTION_TITLE}>Display</h2>
            </div>
            <PrefToggle
              label="Anonymise users"
              description="Replace usernames with hashed identifiers across all views"
              checked={preferences?.anonymiseUsers ?? false}
              onChange={(v) => handlePrefChange('anonymiseUsers', v)}
            />
            {savedKey === 'anonymiseUsers' && (
              <span className="inline-flex items-center gap-[0.3rem] text-sm text-semantic-success self-start">
                <Check size={11} /> Saved
              </span>
            )}
          </section>
        )}

        {/* ── Doctor preferences (admin only) ──────────────────────── */}
        {role === 'admin' && (
          <section className={CLS_SECTION}>
            <div className={CLS_SECTION_HEADER}>
              <Stethoscope size={15} />
              <h2 className={CLS_SECTION_TITLE}>Doctor</h2>
            </div>
            <PrefToggle
              label="Exclude aborted jobs"
              description="Hide jobs aborted by users from all Doctor panels by default"
              checked={preferences?.doctorHideAborted ?? false}
              onChange={(v) => handlePrefChange('doctorHideAborted', v)}
            />
            {savedKey === 'doctorHideAborted' && (
              <span className="inline-flex items-center gap-[0.3rem] text-sm text-semantic-success self-start">
                <Check size={11} /> Saved
              </span>
            )}
          </section>
        )}

        {/* ── Monitored servers (admin only) ───────────────────────── */}
        {role === 'admin' && (
          <section className={`${CLS_SECTION} col-span-full`}>
            <div className={CLS_SECTION_HEADER}>
              <Bell size={15} />
              <h2 className={CLS_SECTION_TITLE}>Monitored Servers</h2>
              <span className="text-sm font-semibold text-muted bg-tertiary px-[0.45rem] py-[0.1rem] rounded-[10px]">
                {preferences?.monitoredServers?.length ?? 0}
              </span>
            </div>
            {(preferences?.monitoredServers?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted m-0 py-2">No servers being monitored. Configure them in Settings.</p>
            ) : (
              <ul className="list-none m-0 p-0 flex flex-col gap-2">
                {preferences!.monitoredServers.map((url) => {
                  const alias = preferences?.serverAliases?.[url]
                  return (
                    <li key={url} className="flex items-start gap-[0.6rem] px-3 py-[0.55rem] bg-primary border border-default rounded-[7px]">
                      <span className="w-[7px] h-[7px] rounded-full bg-semantic-success shrink-0 mt-[0.3rem]" />
                      <div className="flex flex-col gap-[0.1rem] min-w-0">
                        {alias && <span className="text-sm font-medium text-primary overflow-hidden text-ellipsis whitespace-nowrap">{alias}</span>}
                        <span className="text-sm text-muted font-mono overflow-hidden text-ellipsis whitespace-nowrap">{url}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* ── Weekly restart check (admin only) ───────────────────── */}
      {role === 'admin' && (
        <section className={`${CLS_SECTION} mb-4`}>
          <div className={CLS_SECTION_HEADER}>
            <RotateCw size={15} />
            <h2 className={CLS_SECTION_TITLE}>Weekly Restart Check</h2>
            <PrefToggle
              label=""
              checked={wrc.enabled}
              onChange={(v) => handleWrcChange({ enabled: v })}
            />
          </div>
          <p className="text-sm text-muted leading-[1.45] m-0">
            Automatically checks all monitored servers after the weekly restart and sends a Discord notification with the result.
          </p>

          <div className={`flex flex-col gap-3 ${!wrc.enabled ? 'opacity-40 pointer-events-none select-none' : ''}`}>
            {/* Day + Time row */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-col gap-[0.25rem] min-w-0">
                <span className="text-sm font-medium text-muted uppercase tracking-[0.04em]">Day</span>
                <select
                  value={wrc.dayOfWeek}
                  onChange={(e) => handleWrcChange({ dayOfWeek: Number(e.target.value) })}
                  className="bg-primary border border-default rounded-[6px] text-sm text-primary px-2 py-[0.3rem] cursor-pointer focus:outline-none focus:border-accent/60"
                >
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                  <option value={0}>Sunday</option>
                </select>
              </div>

              <div className="flex flex-col gap-[0.25rem] min-w-0">
                <span className="text-sm font-medium text-muted uppercase tracking-[0.04em]">Restart time</span>
                <div className="flex items-center gap-1">
                  <select
                    value={wrc.hour}
                    onChange={(e) => handleWrcChange({ hour: Number(e.target.value) })}
                    className="bg-primary border border-default rounded-[6px] text-sm text-primary px-2 py-[0.3rem] cursor-pointer focus:outline-none focus:border-accent/60"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <span className="text-muted font-bold">:</span>
                  <select
                    value={wrc.minute}
                    onChange={(e) => handleWrcChange({ minute: Number(e.target.value) })}
                    className="bg-primary border border-default rounded-[6px] text-sm text-primary px-2 py-[0.3rem] cursor-pointer focus:outline-none focus:border-accent/60"
                  >
                    {[0, 15, 30, 45].map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-[0.25rem] min-w-0">
                <span className="text-sm font-medium text-muted uppercase tracking-[0.04em]">Check delay</span>
                <div className="flex items-center gap-2">
                  <select
                    value={wrc.delayMinutes}
                    onChange={(e) => handleWrcChange({ delayMinutes: Number(e.target.value) })}
                    className="bg-primary border border-default rounded-[6px] text-sm text-primary px-2 py-[0.3rem] cursor-pointer focus:outline-none focus:border-accent/60"
                  >
                    {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                  <span className="text-sm text-muted">after restart</span>
                </div>
              </div>
            </div>

            {/* Summary line */}
            {wrc.enabled && (
              <p className="text-sm text-muted m-0">
                Every{' '}
                <span className="text-primary font-medium">
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][wrc.dayOfWeek]}
                </span>{' '}
                at{' '}
                <span className="text-primary font-medium">
                  {String(wrc.hour).padStart(2, '0')}:{String(wrc.minute).padStart(2, '0')}
                </span>
                , checks all servers{' '}
                <span className="text-primary font-medium">{wrc.delayMinutes} min</span>{' '}
                after restart.
              </p>
            )}
          </div>

          {/* Save + Test buttons */}
          <div className="flex flex-col gap-2 pt-[0.1rem]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleWrcSave}
                disabled={wrcSaving}
                className="inline-flex items-center gap-[0.35rem] px-3 py-[0.35rem] bg-accent hover:bg-accent/80 disabled:opacity-50 text-white text-sm font-medium rounded-[6px] transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed"
              >
                {wrcSaving ? <RotateCw size={13} className="animate-spin" /> : null}
                Save
              </button>
              <button
                type="button"
                onClick={handleWrcTest}
                disabled={wrcTesting}
                className="inline-flex items-center gap-[0.35rem] px-3 py-[0.35rem] bg-tertiary border border-default hover:border-accent/50 hover:text-primary disabled:opacity-50 text-secondary text-sm font-medium rounded-[6px] transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed"
                title="Run a health check now and send the Discord notification immediately, bypassing the schedule"
              >
                {wrcTesting ? <RotateCw size={13} className="animate-spin" /> : <RotateCw size={13} />}
                Test now
              </button>
              {wrcSaved && (
                <span className="inline-flex items-center gap-[0.3rem] text-sm text-semantic-success">
                  <Check size={11} /> Saved
                </span>
              )}
            </div>

            {/* Test result */}
            {wrcTestError && (
              <p className="text-sm text-semantic-error m-0">{wrcTestError}</p>
            )}
            {wrcTestResult && (
              <div className={`text-sm px-3 py-2 rounded-md border ${wrcTestResult.ok ? 'bg-semantic-success/[0.07] border-semantic-success/25 text-semantic-success' : 'bg-semantic-error/[0.07] border-semantic-error/25 text-semantic-error'}`}>
                {wrcTestResult.ok
                  ? `✓ Notification sent — ${wrcTestResult.healthy} healthy, ${wrcTestResult.unhealthy} unhealthy`
                  : `✗ ${wrcTestResult.reason ?? 'Test failed'}`}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Events calendar — standalone, outside grid ───────────── */}
      <CalendarEvents preferences={preferences} discordEnabled={discordEnabled} />
    </div>
  )
}
