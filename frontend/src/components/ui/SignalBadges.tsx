import type { SignalKind, SignalMark } from '../../lib/portfolio'
import { SignalShape, type ShapeKind } from '../SignalShape'

/** 신호 배지 글자 — 짧게(이미 정한 것). 풀이는 SIGNAL_LABEL 이 title·읽어 주기로 */
const BADGE_TEXT: Record<SignalKind, string> = { buy: '매수', sell: '매도', over: '비중 초과', under: '비중 미달' }
const BADGE_TONE: Record<SignalKind, string> = { buy: 'tone-buy', sell: 'tone-sell', over: 'weight', under: 'weight' }
const SHAPE_OF: Record<SignalKind, ShapeKind> = { buy: 'buy', sell: 'sell', over: 'rebalance', under: 'rebalance' }

/**
 * 모양 + 짧은 글자 배지 줄 (표시만 — 누르는 일은 감싸는 쪽이 정한다). 색만으로 가리지 않는다(8-4).
 * 홈 표의 배지(.holding-badge)와 같은 모양이다.
 */
export function SignalBadges({ signals, className = '' }: { signals: SignalMark[]; className?: string }) {
  if (signals.length === 0) return null
  return (
    <span className={`signal-badge-list ${className}`.trim()}>
      {signals.map((s) => (
        <span key={s.kind} className={`holding-badge ${BADGE_TONE[s.kind]}`} title={s.label}>
          <SignalShape kind={SHAPE_OF[s.kind]} size={9} />
          {BADGE_TEXT[s.kind]}
        </span>
      ))}
    </span>
  )
}
