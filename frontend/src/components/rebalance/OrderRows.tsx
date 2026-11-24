import { useState, type ReactNode } from 'react'
import { Icon } from '../icons/Icon'

/** 한 주문 줄에 보일 것 — 계산은 리밸런싱 화면(buildOrderPlan)이 하고 여기는 그리기만 한다 */
export interface OrderRowItem {
  ticker: string
  label: string
  action: 'buy' | 'sell' | 'hold'
  /** "−1,638주" · "+621주" · 시세가 없으면 금액 */
  shares: string
  /** "−₩138,800,237" (가리기면 •••) */
  money: string
  /** "33.2% → 6%" */
  weights: string
  /** 비중이 밴드 밖(비중조절 신호) — 이름 앞 ◆ */
  weightSignal: boolean
  /** 읽기 프로그램용 한 줄 — 글씨 "사기·팔기"를 화면에서 뺐으니 여기서는 말로 ("AAPL 16주 팔기") */
  spoken: string
}

/**
 * 주문 한 줄 (디자인 4차 목업 12c) — 왼쪽 띠 색 · 부호 주수로 사고팖을 보인다. "사기 · 팔기" 글씨는 쓰지 않는다
 * (주인: "사기 팔기를 글씨로 쓰니까 별로다" · "1번에 3번 띠를 넣어줘"). 누르면 자세히 + 거래 입력 시트.
 */
export function OrderRowButton({ item, onOpen }: { item: OrderRowItem; onOpen: (ticker: string) => void }) {
  return (
    <li>
      <button
        type="button"
        className={`order-row is-${item.action}`}
        onClick={() => onOpen(item.ticker)}
        aria-label={`${item.spoken} — 자세히`}
        data-ticker={item.ticker}
      >
        <span className="order-row-name">
          <span className="order-row-title">
            {item.weightSignal && <i className="weight-dot" title="비중이 밴드 밖" aria-hidden="true" />}
            <span className="order-row-label">{item.label}</span>
          </span>
          <span className="order-row-sub mono">{item.weights}</span>
        </span>
        <span className="order-row-act">
          <b className="mono">{item.shares}</b>
          {item.action !== 'hold' && <span className="mono">{item.money}</span>}
        </span>
        <Icon name="forward" size={18} className="order-row-go" />
      </button>
    </li>
  )
}

/** 줄일 종목 · 늘릴 종목 — 둥근 카드 묶음 하나 */
export function OrderGroup({
  title,
  total,
  tone,
  items,
  limit,
  onOpen,
  children,
}: {
  title: string
  total?: string
  tone: 'buy' | 'sell' | 'hold'
  items: OrderRowItem[]
  /** 처음에 보일 줄 수 — 나머지는 "n종목 더 보기" (목업 12d A, 주인: "너무 길게 나온다") */
  limit?: number
  onOpen: (ticker: string) => void
  children?: ReactNode
}) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const folded = limit !== undefined && items.length > limit
  const shown = folded && !all ? items.slice(0, limit) : items
  return (
    <section className="order-group" aria-label={title}>
      <div className="order-group-head">
        <h4>{title}</h4>
        {total && <span className={`mono tone-${tone}`}>{total}</span>}
      </div>
      <div className="order-card">
        <ul className="order-list">
          {shown.map((item) => (
            <OrderRowButton key={item.ticker} item={item} onOpen={onOpen} />
          ))}
        </ul>
        {folded && (
          <button type="button" className="order-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
            {all ? '접기' : `${items.length - limit!}종목 더 보기`}
            <Icon name="forward" size={16} className={`order-more-go${all ? ' open' : ''}`} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** 줄일/늘릴 막대 한 줄 — 얼마를 팔고 얼마를 사는지 한눈에 */
export function OrderSplit({
  sellCount,
  buyCount,
  holdCount,
  sellTotal,
  buyTotal,
  sellText,
  buyText,
  money,
}: {
  sellCount: number
  buyCount: number
  holdCount: number
  sellTotal: number
  buyTotal: number
  sellText: string
  buyText: string
  /** 폰: 새로 넣을 돈 한 줄을 이 카드 안 아래에 (목업 12d A) */
  money?: ReactNode
}) {
  const both = sellTotal + buyTotal
  return (
    <div className="order-split" role="group" aria-label="줄일, 늘릴 합계">
      <div className="order-split-k">
        <span>
          줄일 {sellCount}종목
          <b className="mono tone-sell">{sellText}</b>
        </span>
        <span className="right">
          늘릴 {buyCount}종목
          <b className="mono tone-buy">{buyText}</b>
        </span>
      </div>
      {both > 0 && (
        <div className="order-split-bar" aria-hidden="true">
          <i className="sell" style={{ flex: sellTotal }} />
          <i className="buy" style={{ flex: buyTotal }} />
        </div>
      )}
      <div className="order-split-k faint">
        <span>유지 {holdCount}종목</span>
        <span className="right">
          <i className="weight-dot" aria-hidden="true" /> = 비중이 밴드 밖
        </span>
      </div>
      {money && <div className="order-split-money">{money}</div>}
    </div>
  )
}
