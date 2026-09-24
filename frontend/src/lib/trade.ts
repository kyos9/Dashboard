/**
 * 거래 한 건을 보유수량·평단가에 반영한다.
 *
 * 매수 기록을 따로 두지 않는다 — 리밸런싱에 필요한 건 지금 수량뿐이고, 평단가는 손익을
 * 보여주는 데만 쓴다. 그래서 "샀다/팔았다"를 받아 두 숫자를 고쳐 쓰는 것으로 끝낸다.
 *
 * - 매수: 수량을 더하고 평단가는 **가중평균**으로 다시 낸다
 * - 매도: 수량만 뺀다. 평단가는 판다고 바뀌지 않는다 (남은 주식을 산 값은 그대로다)
 * - 전부 팔면 평단가를 비운다 — 다음에 새로 사면 그 값이 곧 평단가다
 */

export type TradeSide = 'buy' | 'sell'

export interface Position {
  quantity: number
  /** 모르면 null */
  avg_cost: number | null
}

export type TradeResult = { ok: true; position: Position } | { ok: false; reason: string }

export function applyTrade(
  position: Position,
  side: TradeSide,
  quantity: number,
  price: number | null,
): TradeResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: '수량을 0보다 크게 입력하세요.' }
  }

  if (side === 'sell') {
    // 부동소수 오차로 "10주 중 10주"가 음수가 되지 않게 아주 작은 차이는 같은 것으로 본다
    if (quantity > position.quantity + 1e-9) {
      return { ok: false, reason: `보유 ${position.quantity}주보다 많이 팔 수 없습니다.` }
    }
    const left = Math.max(0, position.quantity - quantity)
    return {
      ok: true,
      position: { quantity: left < 1e-9 ? 0 : left, avg_cost: left < 1e-9 ? null : position.avg_cost },
    }
  }

  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: '매수 가격을 입력하세요.' }
  }
  const total = position.quantity + quantity
  let avg: number | null
  if (position.quantity <= 0) {
    avg = price
  } else if (position.avg_cost === null) {
    // 들고 있던 몫의 값을 모르면 평균을 낼 수 없다 — 틀린 평단가보다 "모름"이 낫다
    avg = null
  } else {
    avg = (position.quantity * position.avg_cost + quantity * price) / total
  }
  return { ok: true, position: { quantity: total, avg_cost: avg } }
}
