import type { DashboardCard } from '../types'

/**
 * 비중조절 신호로 셀 종목 — 과중(매도 검토)·미달(매수 검토)만 (디자인 2차, 주인 결정).
 *
 * 분기 정기 리뷰 날에는 모든 종목에 "정기 리뷰" 사유가 붙어 `rebalance_signal.active` 가 다 참이 된다.
 * 그대로 세면 포트폴리오 "확인할 신호"가 "비중조절 15"인데 줄 끝 ◆ 는 3개였다(C 검토). 정기 리뷰는 신호 요약의
 * "정기 리뷰 n" 배지가 따로 말한다. 신호 요약·거르기·포트폴리오가 이 하나로 센다 — 누른 수와 걸러진 수가 같게.
 */
export function isWeightReason(reason: string): boolean {
  return reason.includes('매도 검토') || reason.includes('매수 검토')
}

export function hasWeightSignal(card: Pick<DashboardCard, 'rebalance_signal'>): boolean {
  return card.rebalance_signal.reasons.some(isWeightReason)
}

/**
 * 비중이 어느 쪽으로 벗어났나 — 신호 요약의 "비중 초과·미달" 칩이 세는 것과 거르는 것이 같게 이 하나로 (0.45.3 A).
 * 칩 수는 켜진 비중 신호의 사유로 셌다(`includes('매도')`) — 거르기도 같은 사유로 본다. 둘 다면 초과(먼저 줄일 쪽이 아니라 서버 사유 순서)
 */
export function weightSide(card: Pick<DashboardCard, 'rebalance_signal'>): 'over' | 'under' | null {
  if (!card.rebalance_signal.active) return null
  const reasons = card.rebalance_signal.reasons
  if (reasons.some((r) => r.includes('매도 검토'))) return 'over'
  if (reasons.some((r) => r.includes('매수 검토'))) return 'under'
  return null
}
