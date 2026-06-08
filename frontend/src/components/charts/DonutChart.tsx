export type Slice = { name: string; color: string; value: number }

type Props = {
  slices: Slice[]
  size?: number
  thickness?: number
  centerLabel?: string
}

export function DonutChart({ slices, size = 200, thickness = 32, centerLabel = 'total' }: Props) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total <= 0 || slices.length === 0) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: '1px dashed var(--line)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ink-3)',
          fontSize: 11,
        }}
      >
        No data
      </div>
    )
  }

  const cx = size / 2,
    cy = size / 2
  const r = size / 2 - 4
  const ri = r - thickness
  let a0 = -Math.PI / 2

  const arcs = slices.map((s) => {
    const frac = s.value / total
    // Avoid degenerate path when a single slice == total
    const angle = frac >= 1 ? Math.PI * 2 - 0.0001 : frac * Math.PI * 2
    const a1 = a0 + angle
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)]
    const p2 = [cx + ri * Math.cos(a1), cy + ri * Math.sin(a1)]
    const p3 = [cx + ri * Math.cos(a0), cy + ri * Math.sin(a0)]
    const large = angle > Math.PI ? 1 : 0
    const d = `M${p0[0]},${p0[1]} A${r},${r} 0 ${large} 1 ${p1[0]},${p1[1]} L${p2[0]},${p2[1]} A${ri},${ri} 0 ${large} 0 ${p3[0]},${p3[1]} Z`
    a0 = a1
    return { d, color: s.color, name: s.name, value: s.value }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((a) => (
        <path key={a.name} d={a.d} fill={a.color} opacity={0.95}>
          <title>{`${a.name}: ${a.value} (${((a.value / total) * 100).toFixed(1)}%)`}</title>
        </path>
      ))}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize={11}
        fill="var(--ink-3)"
        fontFamily="var(--font-mono)"
        style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}
      >
        {centerLabel}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontSize={20}
        fontWeight={600}
        fill="var(--ink)"
        fontFamily="var(--font-display)"
      >
        {total.toLocaleString()}
      </text>
    </svg>
  )
}
