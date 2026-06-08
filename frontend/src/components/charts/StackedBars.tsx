export type StackSeries = {
  name: string
  color: string
  data: number[]
}

type Props = {
  series: StackSeries[]
  labels: string[]
  height?: number
  formatY?: (v: number) => string
}

export function StackedBars({ series, labels, height = 200, formatY = (v) => String(v) }: Props) {
  const W = 760,
    H = height
  const padL = 44,
    padR = 16,
    padT = 14,
    padB = 28
  const n = labels.length

  if (n === 0 || series.length === 0) {
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
        No data for this range.
      </div>
    )
  }

  const totals = Array.from({ length: n }, (_, i) =>
    series.reduce((a, s) => a + (s.data[i] ?? 0), 0),
  )
  const max = Math.max(1, ...totals)
  const slot = (W - padL - padR) / n
  const barW = Math.max(4, slot * 0.7)
  const gridY = [0, 0.5, 1]
  const tickIdx = new Set([0, Math.floor(n / 2), n - 1])

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
            {formatY(Math.round(max * (1 - g)))}
          </text>
        </g>
      ))}
      {Array.from({ length: n }).map((_, i) => {
        const x = padL + i * slot + (slot - barW) / 2
        let stackTop = H - padB
        return (
          <g key={i}>
            {series.map((s) => {
              const value = s.data[i] ?? 0
              const h = (value / max) * (H - padT - padB)
              stackTop -= h
              return (
                <rect
                  key={s.name}
                  x={x}
                  y={stackTop}
                  width={barW}
                  height={h}
                  fill={s.color}
                  opacity={0.9}
                >
                  <title>{`${s.name} · ${labels[i]}: ${value}`}</title>
                </rect>
              )
            })}
            {tickIdx.has(i) && (
              <text
                x={x + barW / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize="9"
                fill="var(--ink-3)"
                fontFamily="var(--font-mono)"
              >
                {labels[i]}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
