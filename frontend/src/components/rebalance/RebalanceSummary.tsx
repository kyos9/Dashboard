import type { ReactNode } from 'react'
import { setHideAmounts, usePrefs } from '../../lib/prefs'

/**
 * 리밸런싱 맨 위 (디자인 4차 목업 12c) — 큰 전체 자금 · 알약(현금 · 밴드 · 목표 합계).
 * 손익 · 최근 거래일 대비는 홈에 있다 — 여기는 "얼마를 어디에 나눌까"에 쓰는 숫자만.
 * 목표 합계가 100% 가 아니면 호박 알약이 되고, 누르면 목표 · 밴드 시트가 열린다.
 */
export function RebalanceSummary({
  total,
  cash,
  band,
  targetSum,
  targetOk,
  notes,
  onTargets,
}: {
  /** 이미 통화로 쓴 값(가리기면 •••) */
  total: string
  cash: string
  band: string
  targetSum: string
  targetOk: boolean
  /** "현금 포함 · 원 기준" 같은 작은 풀이 */
  notes?: ReactNode
  onTargets: () => void
}) {
  const { hideAmounts } = usePrefs()
  return (
    <section className="rb-summary" aria-label="내 자산">
      <div className="rb-summary-title">
        <span className="kpi-title">전체 자금</span>
        <button className="link-like money-hide" aria-pressed={hideAmounts} onClick={() => setHideAmounts(!hideAmounts)}>
          {hideAmounts ? '금액 보기' : '금액 가리기'}
        </button>
      </div>
      <div className="rb-summary-big summary-num">{total}</div>
      {notes && <p className="hint rb-summary-note">{notes}</p>}
      <div className="rb-pills">
        <span className="rb-pill">
          현금 <b className="mono">{cash}</b>
        </span>
        <span className="rb-pill">
          기본 밴드 <b className="mono">{band}</b>
        </span>
        <button
          type="button"
          className={`rb-pill${targetOk ? '' : ' warn'}`}
          onClick={onTargets}
          aria-label={`목표 합계 ${targetSum}${targetOk ? '' : ' — 100%가 아님'} · 목표 · 밴드 고치기`}
        >
          {!targetOk && '⚠ '}목표 합계 <b className="mono">{targetSum}</b>
        </button>
      </div>
    </section>
  )
}
