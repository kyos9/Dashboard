import { describe, expect, it } from 'vitest'
import type { Currency, RebalanceRow } from '../types'
import { buildOrderPlan, NOISE_THRESHOLD_PCT, parseTotalOverride, toNative } from './orderPlan'

function row(overrides: Partial<RebalanceRow> & { ticker: string; currency: Currency }): RebalanceRow {
  return {
    name: null,
    target_weight_pct: 0,
    actual_weight_pct: 0,
    excess_pct: 0,
    next_review_date: '2026-12-31',
    shoulder_signal_fired_in_period: false,
    rebalance_signal: { active: false, reasons: [] },
    quantity: 0,
    last_close: null,
    current_value: 0,
    current_value_base: 0,
    ...overrides,
  }
}

describe('toNative', () => {
  it('같은 통화면 그대로 둔다', () => {
    expect(toNative(1000, 'KRW', 'KRW', { USD: 1300 })).toBe(1000)
    expect(toNative(1000, 'USD', 'USD', { USD: 1300 })).toBe(1000)
  })

  it('원화 기준에서 달러 종목 주문액을 달러로 되돌린다', () => {
    expect(toNative(1_300_000, 'USD', 'KRW', { USD: 1300 })).toBeCloseTo(1000)
  })

  it('달러 기준에서 원화 종목 주문액을 원화로 되돌린다', () => {
    expect(toNative(100, 'KRW', 'USD', { USD: 1300 })).toBeCloseTo(130_000)
  })

  it('환율을 모르면 환산하지 않는다 (0으로 나누지 않기 위해)', () => {
    expect(toNative(1000, 'USD', 'KRW', { USD: 0 })).toBe(1000)
  })
})

describe('세 통화가 섞였을 때', () => {
  it('엔화 종목 주문액을 엔으로 되돌린다', () => {
    // 1엔 = 9원이므로 90,000원짜리 주문은 10,000엔이다
    expect(toNative(90_000, 'JPY', 'KRW', { USD: 1300, JPY: 9 })).toBeCloseTo(10_000)
  })

  it('달러 기준일 때 엔 종목도 환산된다 (원을 거쳐서)', () => {
    // 100달러 = 130,000원 = 13,000엔 (환율 1300, 10)
    expect(toNative(100, 'JPY', 'USD', { USD: 1300, JPY: 10 })).toBeCloseTo(13_000)
  })

  it('그 통화의 환율만 없으면 그 종목만 환산하지 않는다', () => {
    expect(toNative(90_000, 'JPY', 'KRW', { USD: 1300 })).toBe(90_000)
    expect(toNative(1_300_000, 'USD', 'KRW', { USD: 1300 })).toBeCloseTo(1000)
  })
})

describe('parseTotalOverride', () => {
  it('비어 있으면 null (보유 합계를 쓰라는 뜻)', () => {
    expect(parseTotalOverride('')).toBeNull()
    expect(parseTotalOverride('   ')).toBeNull()
  })

  it('천단위 쉼표를 붙여넣어도 읽는다', () => {
    expect(parseTotalOverride('78,061,625')).toBe(78_061_625)
  })

  it('숫자가 아니거나 0 이하면 무시한다', () => {
    expect(parseTotalOverride('abc')).toBeNull()
    expect(parseTotalOverride('0')).toBeNull()
    expect(parseTotalOverride('-500')).toBeNull()
  })
})

describe('buildOrderPlan', () => {
  // 삼성전자 80만원 + VOO 1,000달러(환율 1300 -> 130만원) = 210만원
  const mixed = [
    row({
      ticker: '005930.KS',
      currency: 'KRW',
      target_weight_pct: 40,
      last_close: 80_000,
      quantity: 10,
      current_value: 800_000,
      current_value_base: 800_000,
    }),
    row({
      ticker: 'VOO',
      currency: 'USD',
      target_weight_pct: 60,
      last_close: 500,
      quantity: 2,
      current_value: 1_000,
      current_value_base: 1_300_000,
    }),
  ]

  it('평가금액 합계를 기준통화로 더한다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 })
    // 현지 통화끼리 더했다면 800,000 + 1,000 = 801,000이 나왔을 것이다
    expect(plan.holdingsTotal).toBe(2_100_000)
  })

  it('목표 금액을 기준통화로 배분한다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 })
    const [ks, voo] = plan.orders
    expect(ks.targetValue).toBeCloseTo(840_000) // 210만 x 40%
    expect(voo.targetValue).toBeCloseTo(1_260_000) // 210만 x 60%
  })

  it('주문 금액은 실제로 거래하는 통화로 환산한다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 })
    const voo = plan.orders.find((o) => o.ticker === 'VOO')!

    expect(voo.adjust).toBeCloseTo(-40_000) // 기준통화(원)
    expect(voo.adjustNative).toBeCloseTo(-40_000 / 1300) // 달러로 주문
  })

  it('예상 주문 주수는 현지 종가로 나눈다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 })
    const voo = plan.orders.find((o) => o.ticker === 'VOO')!
    const ks = plan.orders.find((o) => o.ticker === '005930.KS')!

    // 원화 조정액을 달러 종가로 나누면 1300배 틀린다
    expect(voo.shares).toBeCloseTo(-40_000 / 1300 / 500)
    expect(ks.shares).toBeCloseTo(40_000 / 80_000)
  })

  it('기준통화를 바꿔도 비중과 주문 주수는 같다', () => {
    const inKrw = buildOrderPlan(mixed, 'KRW', { USD: 1300 })
    const inUsd = buildOrderPlan(
      mixed.map((r) => ({ ...r, current_value_base: r.current_value_base / 1300 })),
      'USD',
      { USD: 1300 },
    )

    for (const ticker of ['005930.KS', 'VOO']) {
      const a = inKrw.orders.find((o) => o.ticker === ticker)!
      const b = inUsd.orders.find((o) => o.ticker === ticker)!
      expect(b.shares!).toBeCloseTo(a.shares!, 6)
      expect(b.action).toBe(a.action)
    }
  })

  it('종가를 모르면 주수를 계산하지 않는다', () => {
    const plan = buildOrderPlan(
      [row({ ticker: 'NEW', currency: 'USD', target_weight_pct: 100, last_close: null })],
      'KRW',
      { USD: 1300 },
    )
    expect(plan.orders[0].shares).toBeNull()
  })

  it('조정액이 총자산 대비 미미하면 유지로 본다', () => {
    const total = 1_000_000
    const tiny = (NOISE_THRESHOLD_PCT / 100) * total * 0.5
    const plan = buildOrderPlan(
      [
        row({
          ticker: 'A',
          currency: 'KRW',
          target_weight_pct: 100,
          last_close: 1000,
          current_value_base: total - tiny,
        }),
      ],
      'KRW',
      { USD: 1300 },
      String(total),
    )
    expect(plan.orders[0].action).toBe('hold')
  })

  it('밴드를 넘으면 방향에 맞는 액션을 준다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 }, '4200000') // 총자산을 두 배로 잡으면 전부 매수
    expect(plan.orders.every((o) => o.action === 'buy')).toBe(true)

    const shrunk = buildOrderPlan(mixed, 'KRW', { USD: 1300 }, '1000000')
    expect(shrunk.orders.every((o) => o.action === 'sell')).toBe(true)
  })

  it('총 운용자산을 직접 넣으면 미투자 현금이 잡힌다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 }, '3,000,000')
    expect(plan.total).toBe(3_000_000)
    expect(plan.cash).toBe(900_000)
  })

  it('보유가 전혀 없으면 0으로 나누지 않고 전부 유지', () => {
    const plan = buildOrderPlan(
      [row({ ticker: 'A', currency: 'KRW', target_weight_pct: 100, last_close: 1000 })],
      'KRW',
      { USD: 1300 },
    )
    expect(plan.total).toBe(0)
    expect(plan.orders[0].action).toBe('hold')
    expect(Number.isFinite(plan.orders[0].adjust)).toBe(true)
  })

  it('목표 비중 합계를 그대로 돌려준다 (100%가 아닌 걸 화면에서 경고하기 위해)', () => {
    expect(buildOrderPlan(mixed, 'KRW', { USD: 1300 }).targetSum).toBe(100)
  })

  it('종목이 없으면 빈 계획', () => {
    const plan = buildOrderPlan([], 'KRW', { USD: 1300 })
    expect(plan).toMatchObject({ holdingsTotal: 0, total: 0, targetSum: 0, orders: [] })
  })
})
