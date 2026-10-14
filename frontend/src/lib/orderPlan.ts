import { amount } from './display'
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
  /** 0.42.0 — "팔지 않고 새 돈만 나누기"로 계산했나 (새로 넣을 돈이 있을 때만 켜진다) */
  buyOnly: boolean
  /** 새 돈만 나누기에서 어느 종목에도 가지 않고 현금에 남는 돈 (기준통화). 그 밖에는 0 */
  leftover: number
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
  /** 0.42.0 — 팔지 않고 새 돈만 나누기. 새로 넣을 돈이 없으면 무시한다(지금과 같은 계산) */
  buyOnlyWanted = false,
): OrderPlan {
  const holdingsTotal = rows.reduce((sum, row) => sum + row.current_value_base, 0)
  const newMoney = parseAmount(newMoneyInput) ?? 0
  const cashNow = cash.value_base + newMoney
  const total = holdingsTotal + cashNow
  const targetSum = rows.reduce((sum, row) => sum + row.target_weight_pct, 0) + cash.target_pct

  const buyOnly = buyOnlyWanted && newMoney > 0
  if (buyOnly) return buyOnlyPlan(rows, baseCurrency, krwPer, cash, newMoney, holdingsTotal, total, targetSum)

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
    buyOnly: false,
    leftover: 0,
  }
}

/**
 * 팔지 않고 새 돈만 나누기 (0.42.0, 명세 6.4).
 *
 * 새로 넣을 돈만을 **목표에 모자란 만큼에 비례해** 나눈다 — 앱이 종목을 고르지 않고, 내가 정한 목표 비중이 정한다
 * (시그널이 뜬 종목을 먼저 채우거나 순서를 매기지 않는다 — ROADMAP 3절). 현금도 목표보다 모자라면 한 자리로 친다.
 *
 * - 모자란 합이 새 돈보다 작으면 모자란 만큼만 사고 나머지는 현금에 남는다.
 * - 나눈 몫이 **새 돈의** 0.5% 미만인 종목은 "유지" — 그 몫도 현금에 남는다. 전체 자금 기준(다시 맞추기의 잡음 기준)을
 *   쓰면 큰 포트폴리오에 적립금을 넣을 때 몫이 모두 그 아래라 아무것도 사지 않았다(4.8억에 100만 원 — 0.42.0 브라우저 확인).
 * - 파는 주문은 없다.
 */
function buyOnlyPlan(
  rows: RebalanceRow[],
  baseCurrency: Currency,
  krwPer: KrwRates,
  cash: CashInput,
  newMoney: number,
  holdingsTotal: number,
  total: number,
  targetSum: number,
): OrderPlan {
  const targets = rows.map((row) => (total * row.target_weight_pct) / 100)
  const gaps = rows.map((row, i) => Math.max(0, targets[i] - row.current_value_base))
  const cashTarget = (total * cash.target_pct) / 100
  const cashGap = Math.max(0, cashTarget - cash.value_base)
  const gapSum = gaps.reduce((a, b) => a + b, 0) + cashGap
  const share = gapSum > newMoney ? newMoney / gapSum : 1

  let spent = 0
  const orders = rows.map((row, i): OrderLine => {
    const raw = gaps[i] * share
    const material = raw > (newMoney * NOISE_THRESHOLD_PCT) / 100
    const adjust = material ? raw : 0
    spent += adjust
    const adjustNative = toNative(adjust, row.currency, baseCurrency, krwPer)
    const close = row.last_close
    return {
      ticker: row.ticker,
      currency: row.currency,
      targetValue: targets[i],
      adjust,
      adjustNative,
      shares: close && close > 0 ? adjustNative / close : null,
      action: material ? 'buy' : 'hold',
    }
  })

  const cashNow = cash.value_base + newMoney
  return {
    holdingsTotal,
    total,
    newMoney,
    cash: { current: cashNow, targetValue: cashTarget, adjust: -spent, targetPct: cash.target_pct },
    targetSum,
    orders,
    buyOnly: true,
    leftover: newMoney - spent,
  }
}

/**
 * 주문 주수를 글로 — **정수 주 + 괄호에 소수** (0.42.0, 주인 결정). "62.17주"는 초보에게 "0.17주를 어떻게 사지?"가 된다.
 * 금액·비중 계산은 그대로이고, 1주 미만이면 그렇게 말한다. `sign` 이면 앞에 +/−.
 */
export function sharesText(shares: number, sign = false): string {
  // 보유 수량(`qty`)과 달리 금액 가리기에도 보인다 — 주수만으로는 얼마를 가졌는지 모른다 (9-3)
  const count = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  const abs = Math.abs(shares)
  const whole = Math.trunc(Number(abs.toFixed(4)))
  const prefix = sign ? (shares > 0 ? '+' : shares < 0 ? '−' : '') : ''
  const exact = Number(abs.toFixed(2))
  if (whole === 0) return `${prefix}1주 미만 (${count(exact)}주)`
  if (exact === whole) return `${prefix}${count(whole)}주`
  return `${prefix}${count(whole)}주 (${count(exact)})`
}

/** "SCHD 78주 팔기" — 폰 카드의 제목. 주수를 모르면(시세 없음) 금액으로 */
export function orderTitle(label: string, order: Pick<OrderLine, 'action' | 'shares' | 'adjustNative' | 'currency'>): string {
  if (order.action === 'hold') return `${label} 유지`
  const verb = order.action === 'buy' ? '사기' : '팔기'
  if (order.shares === null) return `${label} ${amount(Math.abs(order.adjustNative), order.currency)}어치 ${verb}`
  return `${label} ${sharesText(order.shares)} ${verb}`
}
