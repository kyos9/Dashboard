/**
 * 스파크라인 — 축·숫자 없이 오르내림만 (목업 11 나 · 카드). 선 색은 첫 값 대비 끝 값으로 오르내림 색.
 * 그림일 뿐이라 읽어 주지 않는다(숫자는 카드 글자가 말한다).
 */
export function Sparkline({ values }: { values: number[] }) {
  const points = values.filter((v) => Number.isFinite(v))
  if (points.length < 2) return <span className="sparkline sparkline-empty" aria-hidden="true" />
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const span = hi - lo || 1
  const d = points
    .map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(2)},${(28 - ((v - lo) / span) * 26).toFixed(2)}`)
    .join(' ')
  const rising = points[points.length - 1] >= points[0]
  return (
    <svg className={`sparkline ${rising ? 'up' : 'down'}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
