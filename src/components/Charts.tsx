import { useId } from 'react'

export interface TrendPoint {
  label: string
  actual: number | null
  ideal: number
}

export function SalesTrendChart({ points, ariaLabel = 'Πορεία πωλήσεων' }: { points: TrendPoint[]; ariaLabel?: string }) {
  const rawId = useId()
  const gid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const W = 800
  const H = 240
  const padL = 44
  const padR = 12
  const padT = 14
  const padB = 28

  if (points.length === 0) return null

  const max = Math.max(1, ...points.map((p) => Math.max(p.ideal, p.actual ?? 0)))
  const n = points.length
  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1))
  const y = (v: number) => padT + (H - padT - padB) * (1 - Math.min(v, max) / max)

  const idealPath = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.ideal).toFixed(1)}`).join(' ')
  const actualIdx = points.map((p, i) => ({ p, i })).filter((o) => o.p.actual != null)
  const actualPath = actualIdx
    .map((o, k) => `${k ? 'L' : 'M'}${x(o.i).toFixed(1)},${y(o.p.actual as number).toFixed(1)}`)
    .join(' ')
  const area = actualIdx.length > 0
    ? `${actualPath} L${x(actualIdx[actualIdx.length - 1].i).toFixed(1)},${H - padB} L${x(actualIdx[0].i).toFixed(1)},${H - padB} Z`
    : ''

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const labelStep = Math.max(1, Math.ceil(n / 8))
  const last = actualIdx[actualIdx.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={`grad-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3866ed" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#3866ed" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((f) => {
        const v = max * f
        return (
          <g key={f}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#edf0f5" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#9aa5b5">{Math.round(v)}</text>
          </g>
        )
      })}

      {area && <path d={area} fill={`url(#grad-${gid})`} />}
      <path d={idealPath} fill="none" stroke="#c9d2e3" strokeWidth="2" strokeDasharray="6 5" />
      {actualPath && (
        <path d={actualPath} fill="none" stroke="#3866ed" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {points.map((p, i) => (i % labelStep === 0 || i === n - 1) ? (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#9aa5b5">{p.label}</text>
      ) : null)}

      {last && (
        <circle cx={x(last.i)} cy={y(last.p.actual as number)} r="4" fill="#3866ed" stroke="#fff" strokeWidth="2" />
      )}
    </svg>
  )
}
