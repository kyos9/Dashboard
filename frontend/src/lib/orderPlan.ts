import type { Currency, RebalanceRow } from '../types'

/** 조정 필요금액이 총자산의 이 비율 미만이면 주문하지 않고 "유지"로 본다 (거래비용 대비 실익 없음) */
export const NOISE_THRESHOLD_PCT = 0.5

export type OrderAction = 'buy' | 'sell' | 'hold'

export interface OrderLine {
  ticker: string
  currency: Currency
  /** 기준통화 기준 목표 금액 */
  targetValue: number
  /** 기준통화 기준 조정 필요금액 (+면 매수) */
  adjust: number
  /** 실제로 주문할 통화 기준 조정 금액 */
  adjustNative: number
  /** 예상 주문 주수. 종가를 모르면 null */
  shares: number | null
  action: OrderAction
}

export interface OrderPlan {
  /** 보유 평가금액 합계 (기준통화) */
  holdingsTotal: number
  /** 비중 계산에 쓰는 총 운용자산 — 사용자가 직접 입력하면 그 값 */
  total: number
  /** 총 운용자산에서 보유분을 뺀 미투자 현금 */
  cash: number
  targetSum: number
  orders: OrderLine[]
}

/**
 * 기준통화 금액을 그 종목을 실제로 거래하는 통화로 되돌린다.
 *
 * 비중과 목표 금액은 기준통화로 계산해야 맞지만, 주문은 현지 통화로 넣는다.
 * 주수를 구할 때도 현지 종가로 나눠야 하므로 이 환산이 필요하다.
 */
export function toNative(
  valueBase: number,
  currency: Currency,
  base: Currency,
  usdKrw: number,
): number {
  if (currency === base || !usdKrw) return valueBase
  if (base === 'KRW' && currency === 'USD') return valueBase / usdKrw
  if (base === 'USD' && currency === 'KRW') return valueBase * usdKrw
  return valueBase
}

/**
 * 사용자가 입력한 총 운용자산. 비어 있거나 숫자가 아니면 null(= 보유 합계를 쓴다).
 * 천단위 쉼표를 그대로 붙여넣는 경우가 많아 제거한 뒤 해석한다.
 */
export function parseTotalOverride(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * 목표 비중과 현재 비중의 차이를 주문 계획으로 바꾼다.
 *
 * 금액 계산은 전부 기준통화로 한다 — 통화가 섞인 상태에서 현지 금액끼리 더하면
 * (원화 80만 + 달러 1000) 숫자가 무의미해진다.
 */
export function buildOrderPlan(
  rows: RebalanceRow[],
  baseCurrency: Currency,
  usdKrw: number,
  totalOverride = '',
): OrderPlan {
  const holdingsTotal = rows.reduce((sum, row) => sum + row.current_value_base, 0)
  const total = parseTotalOverride(totalOverride) ?? holdingsTotal
  const targetSum = rows.reduce((sum, row) => sum + row.target_weight_pct, 0)

  const orders = rows.map((row): OrderLine => {
    const targetValue = (total * row.target_weight_pct) / 100
    const adjust = targetValue - row.current_value_base
    const adjustNative = toNative(adjust, row.currency, baseCurrency, usdKrw)
    const close = row.last_close
    const shares = close && close > 0 ? adjustNative / close : null
    const material = total > 0 && Math.abs(adjust) / total > NOISE_THRESHOLD_PCT / 100

    return {
      ticker: row.ticker,
      currency: row.currency,
      targetValue,
      adjust,
      adjustNative,
      shares,
      action: !material ? 'hold' : adjust > 0 ? 'buy' : 'sell',
    }
  })

  return { holdingsTotal, total, cash: total - holdingsTotal, targetSum, orders }
}
