type Props = {
  data: number[]
  color: string
  gradientId: string
}

export function AreaChart({ data, color, gradientId }: Props) {
  const H = 110
  const W = 600

  if (data.length < 2) {
    return <div className="chart-empty">Collecting samples… ({data.length}/2)</div>
  }

  const step = W / (data.length - 1)
  const line = data
    .map((v, i) => {
      const x = i * step
      const y = H - 6 - (Math.max(0, Math.min(v, 100)) / 100) * (H - 12)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[25, 50, 75].map((g) => {
        const y = H - 6 - (g / 100) * (H - 12)
        return <line key={g} x1="0" x2={W} y1={y} y2={y} className="chart-grid" />
      })}
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
