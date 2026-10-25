import { useMemo, useRef, useState } from 'react'
import { money } from '../utils/format'
import { axisTicks } from '../utils/report'

/**
 * Daily revenue over the selected period.
 *
 * A single series over time, so it is drawn as a line with an area wash rather
 * than bars — bars at 90 days become slivers, and the trend is the point.
 *
 * The series must already have one entry per calendar day (see
 * fillDailySeries): plotting only the days that had sales would put a quiet
 * Tuesday beside a busy Friday and misstate the time axis.
 */

const PAD = { top: 16, right: 14, bottom: 26, left: 60 }
const HEIGHT = 230
const VIEW_W = 1000 // drawn in a fixed viewBox, scaled by CSS

/**
 * "2026-09-13" as a LOCAL date.
 *
 * new Date('2026-09-13') parses as UTC midnight, which renders as the previous
 * day anywhere behind UTC — the axis would be a day out for half the world.
 */
const parseDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const shortDate = (iso) =>
  parseDay(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function RevenueChart({ series, currency }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const chart = useMemo(() => {
    const values = series.map(([, v]) => v)
    const max = Math.max(1, ...values)
    const ticks = axisTicks(max)
    const top = ticks[ticks.length - 1] || max

    const plotW = VIEW_W - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom

    // A single day would divide by zero; place it mid-plot instead.
    const xAt = (i) => (series.length === 1
      ? PAD.left + plotW / 2
      : PAD.left + (i / (series.length - 1)) * plotW)
    const yAt = (v) => PAD.top + plotH - (v / top) * plotH

    const points = series.map(([day, v], i) => ({ day, value: v, x: xAt(i), y: yAt(v) }))
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const base = PAD.top + plotH
    const area = points.length
      ? `${line} L${points[points.length - 1].x.toFixed(1)},${base} L${points[0].x.toFixed(1)},${base} Z`
      : ''

    const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0] || { value: 0 })

    return { points, line, area, ticks, top, yAt, base, plotW }
  }, [series])

  if (!series.length) return null

  const { points, line, area, ticks, yAt, base } = chart

  /** Nearest data point to the pointer, in viewBox coordinates. */
  const onMove = (e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W
    let nearest = points[0]
    points.forEach((p) => {
      if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p
    })
    setHover(nearest)
  }

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: HEIGHT, display: 'block', overflow: 'visible' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Daily revenue from ${series[0][0]} to ${series[series.length - 1][0]}`}
      >
        {/* Gridlines — hairline, solid, recessive. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={yAt(t)} y2={yAt(t)}
              stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={PAD.left - 10} y={yAt(t) + 4} textAnchor="end"
              fill="var(--text-3)" fontSize="11" fontFamily="inherit">
              {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : t}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="revWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#revWash)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {/* Crosshair and marker for the hovered day. */}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={base}
              stroke="var(--text-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={hover.x} cy={hover.y} r="5" fill="var(--brand)"
              stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        )}

        {/* Date labels: ends plus the middle, so they never collide. */}
        {[0, Math.floor(points.length / 2), points.length - 1]
          .filter((i, idx, arr) => points[i] && arr.indexOf(i) === idx)
          .map((i) => (
            <text key={i} x={points[i].x} y={HEIGHT - 8}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              fill="var(--text-3)" fontSize="11" fontFamily="inherit">
              {shortDate(points[i].day)}
            </text>
          ))}
      </svg>

      {hover && (() => {
        // Near the ends, anchor the tooltip's edge instead of its centre so it
        // does not hang outside the card.
        const pct = (hover.x / VIEW_W) * 100
        const anchor = pct < 14 ? 'left' : pct > 86 ? 'right' : 'center'
        const shift = anchor === 'left' ? '0' : anchor === 'right' ? '-100%' : '-50%'
        return (
        <div className="chart-tip" style={{
          left: `${pct}%`,
          top: `${(hover.y / HEIGHT) * 100}%`,
          transform: `translate(${shift}, calc(-100% - 14px))`,
        }}>
          <strong>{money(hover.value, currency)}</strong>
          <span>{parseDay(hover.day).toLocaleDateString(undefined, {
            weekday: 'short', day: 'numeric', month: 'short',
          })}</span>
        </div>
        )
      })()}
    </div>
  )
}
