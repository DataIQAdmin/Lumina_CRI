// A ring that fills with the clean share, coloured by how healthy it is; the number sits inside.
export function QualityRing({ score, size }: { score: number; size: number }) {
  const stroke = size > 80 ? 10 : 6
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  const tone = score >= 85 ? 'good' : score >= 60 ? 'fix' : 'bad'
  return (
    <span className="dq-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="dq-ring-track" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={`dq-ring-value is-${tone}`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(length * Math.min(score, 100)) / 100} ${length}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className={`dq-ring-label is-${tone}`} style={{ fontSize: size > 80 ? 30 : 14 }}>
        {score < 100 ? Math.min(Math.round(score), 99) : 100}
        <small>%</small>
      </span>
    </span>
  )
}
