import type { ReactNode } from 'react'

/**
 * PC 리밸런싱 요약 띠 (디자인 5차 목업 05 가) — 전체 자금 · 팔 것 · 살 것 · 목표 합계 · 새로 넣을 돈을 한 줄 칸 다섯에.
 * 칸 제목은 위, 숫자는 왼쪽에 두고 남은 높이의 가운데 (주인: "위쪽 정렬이라 별로, 숫자는 왼쪽 가운데").
 */
export function RebalanceStrip({
  total,
  sellCount,
  sellText,
  buyCount,
  buyText,
  targetSum,
  targetGap,
  onTargets,
  money,
}: {
  /** 이미 통화로 쓴 값(가리기면 •••) */
  total: string
  sellCount: number
  sellText: string
  buyCount: number
  buyText: string
  targetSum: string
  /** 목표 합계가 100% 가 아닐 때 한 줄 ("10%p 비어 있음") — 없으면 맞음 */
  targetGap: string | null
  onTargets: () => void
  /** 새로 넣을 돈 칸 (입력 + 팔지 않고 나누기) */
  money: ReactNode
}) {
  return (
    <section className="rb-strip" aria-label="요약">
      <div className="rb-strip-cell">
        <span className="rb-strip-k">전체 자금 (현금 포함)</span>
        <div className="rb-strip-v">
          <b className="mono">{total}</b>
        </div>
      </div>
      <div className="rb-strip-cell">
        <span className="rb-strip-k">팔 것 {sellCount}종목</span>
        <div className="rb-strip-v">
          <b className="mono tone-sell">{sellText}</b>
        </div>
      </div>
      <div className="rb-strip-cell">
        <span className="rb-strip-k">살 것 {buyCount}종목</span>
        <div className="rb-strip-v">
          <b className="mono tone-buy">{buyText}</b>
        </div>
      </div>
      <button
        type="button"
        className={`rb-strip-cell rb-strip-target${targetGap ? ' warn' : ''}`}
        onClick={onTargets}
        aria-label={`목표 합계 ${targetSum}${targetGap ? `, ${targetGap}` : ''}, 목표 수정`}
      >
        <span className="rb-strip-k">목표 합계</span>
        <div className="rb-strip-v">
          <b className="mono">{targetSum}</b>
          {targetGap && <small>{targetGap}</small>}
        </div>
      </button>
      <div className="rb-strip-cell rb-strip-money">{money}</div>
    </section>
  )
}
