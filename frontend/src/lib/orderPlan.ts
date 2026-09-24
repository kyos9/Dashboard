import type { Currency, FxInfo, RebalanceRow } from '../types'

/** 통화코드 -> "1단위 = 몇 원". 원은 언제나 1이라 표에 넣지 않는다. */
export type KrwRates = Partial<Record<Currency, number>>

export function krwRate(currency: Currency, krwPer: KrwRates): number {
  return currency === 'KRW' ? 1 : (krwPer[currency] ?? 0)
}

/** 서버가 내려준 환율 묶음에서 계산에 쓸 표만 뽑는다. */
export function krwRatesOf(fx: FxInfo | null | undefined): KrwRates {
  const out: KrwRates = {}
  for (const [code, quote] of Object.entries(fx?.rates ?? {})) {
    if (quote) out[code as Currency] = quote.krw_rate
  }
  return out
}

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

/** 현금 한 줄. 종목처럼 목표가 있고, 모자라거나 남는 만큼이 곧 주문의 재원이다 */
export interface CashLine {
  /** 지금 현금 + 새로 넣을 돈 (기준통화) */
  current: number
  targetValue: number
  /** +면 현금을 더 쌓아야 하고, −면 그만큼 종목을 사는 데 쓸 수 있다 */
  adjust: number
  targetPct: number
}

export interface OrderPlan {
  /** 보유 평가금액 합계 (기준통화) */
  holdingsTotal: number
  /** 비중 계산에 쓰는 전체 자금 = 보유 + 현금 + 새로 넣을 돈 */
  total: number
  /** 새로 넣을 돈 (기준통화). 입력하지 않으면 0 */
  newMoney: number
  cash: CashLine
  /** 종목 목표 + 현금 목표 */
  targetSum: number
  orders: OrderLine[]
}

/** 저장된 현금 — 서버가 기준통화로 환산해서 준다 */
export interface CashInput {
  value_base: number
  target_pct: number
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
  krwPer: KrwRates,
): number {
  if (currency === base) return valueBase
  // 백엔드와 같은 방식 — 원을 거쳐 환산한다. 통화가 셋이 되면 짝마다 분기하는 방식은
  // 유지할 수 없다 (엔↔달러까지 생긴다).
  const from = krwRate(base, krwPer)
  const to = krwRate(currency, krwPer)
  // 환율을 모르면 환산하지 않고 그대로 둔다 (0으로 나누면 화면이 NaN으로 덮인다)
  if (!from || !to) return valueBase
  return (valueBase * from) / to
}

/**
 * 사람이 친 금액. 비어 있거나 숫자가 아니거나 0 이하면 null.
 * 천단위 쉼표를 그대로 붙여넣는 경우가 많아 제거한 뒤 해석한다.
 */
export function parseAmount(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * 목표 비중과 현재 비중의 차이를 주문 계획으로 바꾼다.
 *
 * **목표비중은 전체 자금 중의 비중이다** — 보유 + 현금 + (있으면) 새로 넣을 돈. 현금을
 * 빼고 계산하면 현금 30%를 들고 있어도 "100% 투자"로 보여 전 종목이 과중이 된다.
 *
 * 새로 넣을 돈은 적립하는 달에 쓴다. "이번 달 100만원을 어디에 넣나"가 곧 모자란 종목을
 * 채우는 계획이라, 따로 적립 기능을 두지 않아도 여기서 답이 나온다.
 *
 * 금액 계산은 전부 기준통화로 한다 — 통화가 섞인 상태에서 현지 금액끼리 더하면
 * (원화 80만 + 달러 1000) 숫자가 무의미해진다.
 */
export function buildOrderPlan(
  rows: RebalanceRow[],
  baseCurrency: Currency,
  krwPer: KrwRates,
  cash: CashInput = { value_base: 0, target_pct: 0 },
  newMoneyInput = '',
): OrderPlan {
  const holdingsTotal = rows.reduce((sum, row) => sum + row.current_value_base, 0)
  const newMoney = parseAmount(newMoneyInput) ?? 0
  const cashNow = cash.value_base + newMoney
  const total = holdingsTotal + cashNow
  const targetSum = rows.reduce((sum, row) => sum + row.target_weight_pct, 0) + cash.target_pct

  const orders = rows.map((row): OrderLine => {
    const targetValue = (total * row.target_weight_pct) / 100
    const adjust = targetValue - row.current_value_base
    const adjustNative = toNative(adjust, row.currency, baseCurrency, krwPer)
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

  const cashTarget = (total * cash.target_pct) / 100
  return {
    holdingsTotal,
    total,
    newMoney,
    cash: {
      current: cashNow,
      targetValue: cashTarget,
      adjust: cashTarget - cashNow,
      targetPct: cash.target_pct,
    },
    targetSum,
    orders,
  }
}
