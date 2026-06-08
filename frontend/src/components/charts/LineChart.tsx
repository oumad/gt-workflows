export type LineSeries = {
  name: string
  color: string
  data: number[]
  dim?: boolean
}

type Props = {
  series: LineSeries[]
  labels: string[]
  height?: number
  formatY?: (v: number) => string
  showArea?: boolean
  /** Drill-down. When provided, each datapoint becomes clickable; the handler
   *  receives the x-axis label (e.g. a date string) and the corresponding
   *  value. The cursor turns into a pointer over hit zones. */
  onPointClick?: (label: string, value: number, seriesName: string) => void
}

export function LineChart({
  series,
  labels,
  height = 220,
  formatY = (v) => String(v),
  showArea = true,
  onPointClick,
}: Props) {
  const W = 760,
    H = height
  const padL = 44,
    padR = 16,
    padT = 14,
    padB = 28
  const n = labels.length

  if (n < 2 || series.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ink-3)',
          fontSize: 12,
        }}
      >
        Not enough data to chart yet.
      </div>
    )
  }

  const allMax = Math.max(1, ...series.flatMap((s) => s.data))
  const xs = (i: number) => padL + (i / (n - 1)) * (W - padL - padR)
  const ys = (v: number) => padT + (1 - v / allMax) * (H - padT - padB)
  const path = (d: number[]) =>
    d.map((v, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(v).toFixed(1)).join(' ')
  const area = (d: number[]) =>
    path(d) +
    ` L${xs(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L${xs(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`

  const gridY = [0, 0.25, 0.5, 0.75, 1]
  const tickX = Array.from(
    new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1]),
  )

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {gridY.map((g, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={padT + g * (H - padT - padB)}
            y2={padT + g * (H - padT - padB)}
            stroke="var(--line)"
            strokeDasharray="2 4"
          />
          <text
            x={padL - 6}
            y={padT + g * (H - padT - padB) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--ink-3)"
            fontFamily="var(--font-mono)"
          >
            {formatY(Math.round(allMax * (1 - g)))}
          </text>
        </g>
      ))}
      {tickX.map((i) => (
        <text
          key={i}
          x={xs(i)}
          y={H - 10}
          textAnchor="middle"
          fontSize="9"
          fill="var(--ink-3)"
          fontFamily="var(--font-mono)"
        >
          {labels[i] ?? ''}
        </text>
      ))}
      {showArea && series.length === 1 && (
        <path d={area(series[0].data)} fill={series[0].color} opacity="0.08" />
      )}
      {series.map((s) => (
        <g key={s.name}>
          <path
            d={path(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.7}
            opacity={s.dim ? 0.2 : 0.95}
          />
          {s.data.map((v, i) => (
            <g key={i}>
              {/* Generous transparent hit zone so clicks land even when the
               *  visible dot is 1.6px. Native title gives a hover tooltip. */}
              {onPointClick && (
                <circle
                  cx={xs(i)}
                  cy={ys(v)}
                  r={10}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onPointClick(labels[i] ?? '', v, s.name)}
                >
                  <title>{`${labels[i] ?? ''} · ${formatY(v)} (click to drill)`}</title>
                </circle>
              )}
              <circle
                cx={xs(i)}
                cy={ys(v)}
                r={1.6}
                fill={s.color}
                opacity={s.dim ? 0.2 : 1}
                pointerEvents="none"
              />
            </g>
          ))}
        </g>
      ))}
    </svg>
  )
}
