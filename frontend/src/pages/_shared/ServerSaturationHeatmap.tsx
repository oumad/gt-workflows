import type { Server } from '../../types'
import { serverStatus } from './serverHelpers'

/**
 * Top-of-page heatmap for ops triage — one tile per server, coloured green
 * (idle) → red (saturated) based on activeJobs / maxConcurrent. Click a tile
 * to open its detail page.
 *
 * Tiles for servers without a maxConcurrent calibration render neutrally with
 * an "uncalibrated" hint; the operator can set the cap on the Settings tab.
 * Servers that are down or in maintenance render with their status colour so
 * they don't masquerade as "idle".
 */

type Props = {
  servers: Server[]
  onOpen: (id: string) => void
  /** What these records are called in this view. Drives the "N services" /
   *  "N servers" pill label so the Services tab doesn't say "servers". */
  kindLabel?: 'server' | 'service'
}

const TILE_W = 120
const TILE_H = 80

/** Returns a fill colour for a saturation ratio in [0, 1+]. Green at 0,
 *  warm yellow around 0.6, deep red at and above 1.0. */
function saturationColor(ratio: number): string {
  if (ratio <= 0) return 'color-mix(in oklab, var(--good) 22%, var(--surface))'
  if (ratio < 0.4) return `color-mix(in oklab, var(--good) ${30 + ratio * 40}%, var(--surface))`
  if (ratio < 0.8) return `color-mix(in oklab, var(--warn) ${40 + (ratio - 0.4) * 60}%, var(--surface))`
  if (ratio < 1) return `color-mix(in oklab, var(--bad) ${60 + (ratio - 0.8) * 100}%, var(--surface))`
  return 'var(--bad)'
}

export function ServerSaturationHeatmap({ servers, onOpen, kindLabel = 'server' }: Props) {
  if (servers.length === 0) return null

  return (
    <div
      className="card"
      // Inline-flowing (not sticky/fixed) so it doesn't cover the rows below
      // when the page scrolls — earlier sticky positioning was hiding content.
      style={{ marginBottom: 14 }}
    >
      <div className="card-head">
        <div className="card-title">Saturation</div>
        <span className="chip" style={{ fontSize: 10 }}>
          {servers.length} {kindLabel}
          {servers.length === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          active / max · click a tile to open
        </span>
      </div>
      <div
        className="row"
        style={{
          flexWrap: 'wrap',
          gap: 8,
          padding: 12,
        }}
      >
        {servers.map((s) => {
          const status = serverStatus(s)
          const active = s.activeJobs ?? 0
          const cap = s.maxConcurrent

          // Status takes precedence over saturation — a "down" server with
          // activeJobs=0 isn't "idle", it's broken. Maintenance is amber.
          let tone: string
          let label: string
          let title: string
          if (status === 'down') {
            tone = 'color-mix(in oklab, var(--bad) 40%, var(--surface))'
            label = 'Down'
            title = `${s.name} — ${status}. activeJobs=${active}.`
          } else if (status === 'maintenance') {
            tone = 'color-mix(in oklab, var(--warn) 40%, var(--surface))'
            label = 'Maint.'
            title = `${s.name} — in maintenance. activeJobs=${active}.`
          } else if (cap == null) {
            tone = 'color-mix(in oklab, var(--ink) 6%, var(--surface))'
            label = `${active} / —`
            title = `${s.name} — uncalibrated. Set maxConcurrent in Settings to enable saturation colouring.`
          } else {
            const ratio = cap > 0 ? active / cap : 0
            tone = saturationColor(ratio)
            label = `${active} / ${cap}`
            title = `${s.name} — ${active} of ${cap} (${Math.round(ratio * 100)}%) used.`
          }

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              title={title}
              style={{
                width: TILE_W,
                height: TILE_H,
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: tone,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: 8,
                textAlign: 'left',
                color: 'var(--ink)',
                fontFamily: 'inherit',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'block',
                }}
              >
                {s.name}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  alignSelf: 'flex-end',
                  textShadow: '0 1px 2px rgba(0,0,0,.15)',
                }}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
