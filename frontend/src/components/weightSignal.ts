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
