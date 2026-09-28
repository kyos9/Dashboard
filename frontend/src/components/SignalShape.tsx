import { reasonBadge } from '../lib/display'

/**
 * 시그널의 모양 — 매수 ▲ · 매도 ▼ · 비중조절 ◆ (ROADMAP 8-4).
 *
 * "상승 빨강"을 고른 사람에게는 빨강이 "올랐다"와 "매도 시그널" 둘을 뜻한다. 그래서 시그널은
 * 색만으로 보이지 않게 모양을 같이 붙인다. 글자(▲)가 아니라 그림으로 그린다 — 글꼴마다 크기·
 * 높이가 달라 줄이 흔들리고, 어떤 폰은 ◆ 를 그림 문자로 바꿔 그린다. 색은 둘레 글자색을 따른다.
 */
export type ShapeKind = 'buy' | 'sell' | 'rebalance'

const POINTS: Record<ShapeKind, string> = {
  buy: '6,1 11.5,10.5 0.5,10.5',
  sell: '0.5,1.5 11.5,1.5 6,11',
  rebalance: '6,0.5 11.5,6 6,11.5 0.5,6',
}

export function SignalShape({ kind, size = 10 }: { kind: ShapeKind; size?: number }) {
  return (
    <svg className={`signal-shape ${kind}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <polygon points={POINTS[kind]} fill="currentColor" />
    </svg>
  )
}

/** 비중조절 사유 배지 — 짧은 이름 + ◆, 풀이는 설명으로. 배지 안에서는 꺾이지 않는다 */
export function ReasonTag({ reason }: { reason: string }) {
  const badge = reasonBadge(reason)
  return (
    <span className="badge badge-purple badge-nowrap" title={badge.desc}>
      {badge.rebalance && <SignalShape kind="rebalance" size={9} />}
      {badge.label}
    </span>
  )
}

/** 매수 신호등 옆에서 매도 조건도 같이 충족했음을 알린다 — 신호등은 매수를 보여주므로 매도가 조용히 사라지지 않게 */
export function SellTooTag() {
  return (
    <span className="badge badge-red badge-nowrap" title="매도 조건도 충족(참고) — 두 시그널이 같이 뜨면 신호등은 매수를 보여줍니다.">
      <SignalShape kind="sell" size={9} />
      매도 조건도
    </span>
  )
}
