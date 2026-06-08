import { useState, useEffect } from 'react'
import { Bot, Check } from 'lucide-react'
import { PageHead } from '../../components/shell/PageHead'
import { api } from '../../lib/api'
import { useNotifications } from '../../context/NotificationsContext'

/* ────────────────────────────────────────────────────────────────────
 * SetoPage — admin-only thresholds for the "Ask Seto" assistant. One
 * row in the seto_config table; this page just renders a form against
 * it and PATCHes back when the admin clicks Save.
 *
 * Defaults below mirror the backend's so the form looks "filled in"
 * even on a brand-new install before the row has been materialised.
 * ──────────────────────────────────────────────────────────────────── */

type Config = {
  maxUserJobs: number
  maxServiceJobs: number
  maxServerJobs: number
  maxWaitTimeSec: number
  maxLinkedWf: number
  maxServerLatencyMs: number
  maxServerServices: number
}

const DEFAULTS: Config = {
  maxUserJobs: 3,
  maxServiceJobs: 3,
  maxServerJobs: 3,
  maxWaitTimeSec: 600,
  maxLinkedWf: 3,
  maxServerLatencyMs: 100,
  maxServerServices: 2,
}

type Field = {
  key: keyof Config
  label: string
  hint: string
  unit: string
  min: number
  max: number
}

const FIELDS: Field[] = [
  {
    key: 'maxUserJobs',
    label: 'Max user jobs',
    hint: 'us_many_jobs · warns when a user has at least this many running or waiting jobs.',
    min: 1,
    max: 100,
    unit: 'jobs',
  },
  {
    key: 'maxServiceJobs',
    label: 'Max service jobs',
    hint: 'si_many_jobs · warns when a single service has at least this many running or waiting jobs.',
    min: 1,
    max: 100,
    unit: 'jobs',
  },
  {
    key: 'maxServerJobs',
    label: 'Max server jobs',
    hint: 'sv_many_jobs · warns when all services on a server have at least this many running or waiting.',
    min: 1,
    max: 1000,
    unit: 'jobs',
  },
  {
    key: 'maxWaitTimeSec',
    label: 'Max wait time',
    hint: 'jo_slow · warns when a job waited longer than this before starting.',
    min: 10,
    max: 86_400,
    unit: 'sec',
  },
  {
    key: 'maxLinkedWf',
    label: 'Max workflows / service',
    hint: 'si_many_wf · warns when more than this many distinct workflows run on one service.',
    min: 1,
    max: 1000,
    unit: 'wf',
  },
  {
    key: 'maxServerLatencyMs',
    label: 'Max server latency',
    hint: "sv_slow_net · warns when a server's last ping latency exceeds this.",
    min: 1,
    max: 60_000,
    unit: 'ms',
  },
  {
    key: 'maxServerServices',
    label: 'Max services / server',
    hint: 'sv_many_services · warns when more than this many services run on a single host.',
    min: 1,
    max: 1000,
    unit: 'svc',
  },
]

export function SetoPage() {
  const { notify } = useNotifications()
  const [cfg, setCfg] = useState<Config>(DEFAULTS)
  const [saved, setSaved] = useState<Config>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .get<Config>('/api/seto/config')
      .then((c) => {
        setCfg(c)
        setSaved(c)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load config'))
      .finally(() => setLoading(false))
  }, [])

  const dirty = FIELDS.some((f) => cfg[f.key] !== saved[f.key])

  async function save() {
    setBusy(true)
    try {
      const next = await api.patch<Config>('/api/seto/config', cfg)
      setCfg(next)
      setSaved(next)
      notify({ variant: 'success', title: 'Seto config saved', autoDismiss: 3000 })
    } catch (e) {
      notify({
        variant: 'error',
        title: 'Save failed',
        body: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  function resetToDefaults() {
    setCfg(DEFAULTS)
  }

  return (
    <>
      <PageHead
        crumbs={['Admin', 'Seto']}
        title="Seto · assistant settings"
        sub="Thresholds that drive the in-app doc's diagnoses"
        actions={
          <>
            <button className="btn btn-sm" onClick={resetToDefaults} disabled={busy}>
              Reset defaults
            </button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      />
      <div className="body">
        {/* Persona banner — same visual language as the Ask-Seto modal so
         * the admin knows what they're configuring at a glance. */}
        <div
          className="card card-pad row"
          style={{ marginBottom: 16, gap: 14, alignItems: 'center' }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'color-mix(in oklab, var(--accent) 22%, var(--surface))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--accent)',
              border: '1px solid color-mix(in oklab, var(--accent) 35%, transparent)',
              flexShrink: 0,
            }}
          >
            <Bot size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>
              Seto, the in-app doc
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 2 }}>
              When a user clicks "Ask Seto" on a job, service or server card, Seto runs these checks
              and lists any concerns. Crossing a threshold triggers the matching finding (code in
              the hint).
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--ink-3)', padding: 40, textAlign: 'center' }}>Loading…</div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : (
          <div className="card card-pad col" style={{ gap: 16, maxWidth: 760 }}>
            <div className="card-title">Thresholds</div>
            {FIELDS.map((f) => (
              <div key={f.key} className="form-row">
                <label>{f.label}</label>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input
                    className="input mono"
                    type="number"
                    min={f.min}
                    max={f.max}
                    value={cfg[f.key]}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      if (Number.isFinite(n)) setCfg((c) => ({ ...c, [f.key]: n }))
                    }}
                    style={{ width: 140 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{f.unit}</span>
                  {cfg[f.key] !== saved[f.key] && (
                    <span className="chip chip-warn" style={{ fontSize: 10 }}>
                      changed
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                  {f.hint}
                </div>
              </div>
            ))}
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 4 }}>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              {!dirty && !busy && (
                <span className="row" style={{ gap: 5, fontSize: 12, color: 'var(--good)' }}>
                  <Check size={12} /> Up to date
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
