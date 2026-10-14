import { describe, expect, it } from 'vitest'
import type { Currency, RebalanceRow } from '../types'
import { buildOrderPlan, NOISE_THRESHOLD_PCT, orderTitle, parseAmount, sharesText, toNative } from './orderPlan'

function row(overrides: Partial<RebalanceRow> & { ticker: string; currency: Currency }): RebalanceRow {
  return {
    name: null,
    target_weight_pct: 0,
    actual_weight_pct: 0,
    excess_pct: 0,
    band_pct: 5,
    shoulder_signal_fired_in_period: false,
    rebalance_signal: { active: false, reasons: [] },
    quantity: 0,
    avg_cost: null,
    last_close: null,
    current_value: 0,
    current_value_base: 0,
    cost_value: null,
    unrealized_pnl: null,
    return_pct: null,
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

describe('parseAmount', () => {
  it('비어 있으면 null (보유 합계를 쓰라는 뜻)', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
  })

  it('천단위 쉼표를 붙여넣어도 읽는다', () => {
    expect(parseAmount('78,061,625')).toBe(78_061_625)
  })

  it('숫자가 아니거나 0 이하면 무시한다', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('-500')).toBeNull()
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
    )
    expect(plan.orders[0].action).toBe('hold')
  })

  it('현금이 목표보다 많으면 종목은 전부 매수, 현금은 재원이 된다', () => {
    // 주식 210만 + 현금 210만, 현금 목표 0% → 전 종목 목표 금액이 두 배
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 }, { value_base: 2_100_000, target_pct: 0 })
    expect(plan.total).toBe(4_200_000)
    expect(plan.orders.every((o) => o.action === 'buy')).toBe(true)
    expect(plan.cash.adjust).toBe(-2_100_000)
  })

  it('목표비중은 현금까지 더한 전체 자금 대비다', () => {
    // 주식 210만 + 현금 90만 = 300만. 종목 목표(40%·60%)는 그대로 두고 현금 목표 30%를 더하면
    // 합계가 130% — 나눠 맞춰주지 않고 그대로 돌려줘 화면이 경고하게 한다
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 }, { value_base: 900_000, target_pct: 30 })
    expect(plan.total).toBe(3_000_000)
    expect(plan.targetSum).toBe(130)
    expect(plan.cash.targetValue).toBe(900_000)
    expect(plan.cash.adjust).toBe(0)
  })

  it('새로 넣을 돈은 현금에 더해 모자란 종목을 채운다', () => {
    const rows = mixed.map((r) => ({ ...r, target_weight_pct: 50 }))
    // 210만 + 새 돈 90만 = 300만 → 각 150만. 삼성(80만)은 +70만, VOO(130만)는 +20만
    const plan = buildOrderPlan(rows, 'KRW', { USD: 1300 }, { value_base: 0, target_pct: 0 }, '900,000')
    expect(plan.newMoney).toBe(900_000)
    expect(plan.total).toBe(3_000_000)
    const [ks, voo] = plan.orders
    expect(ks.adjust).toBeCloseTo(700_000)
    expect(voo.adjust).toBeCloseTo(200_000)
    // 넣은 돈이 전부 주문으로 나간다
    expect(plan.cash.adjust).toBeCloseTo(-900_000)
  })

  it('현금을 넘기지 않으면 예전처럼 보유만으로 계산한다', () => {
    const plan = buildOrderPlan(mixed, 'KRW', { USD: 1300 })
    expect(plan.total).toBe(2_100_000)
    expect(plan.cash).toEqual({ current: 0, targetValue: 0, adjust: 0, targetPct: 0 })
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

describe('팔지 않고 새 돈만 나누기 (0.42.0)', () => {
  // 목표 50:50, 지금 A 600 · B 400 (기준통화 원), 새 돈 100 → 전체 1100, 목표 550:550
  const rowsAB = [
    row({ ticker: 'A', currency: 'KRW', current_value_base: 600, target_weight_pct: 50, last_close: 10 }),
    row({ ticker: 'B', currency: 'KRW', current_value_base: 400, target_weight_pct: 50, last_close: 10 }),
  ]

  it('기본(끔)은 지금 계산 그대로 — 파는 주문도 나온다', () => {
    const plain = buildOrderPlan(rowsAB, 'KRW', {}, undefined, '100')
    const off = buildOrderPlan(rowsAB, 'KRW', {}, undefined, '100', false)
    expect(off).toEqual(plain)
    expect(plain.orders.map((o) => o.action)).toEqual(['sell', 'buy'])
    expect(plain.buyOnly).toBe(false)
  })

  it('켜면 파는 주문이 없고, 새 돈이 모자란 만큼에 비례해 간다 — 합 = 새 돈', () => {
    const plan = buildOrderPlan(rowsAB, 'KRW', {}, undefined, '100', true)
    expect(plan.buyOnly).toBe(true)
    expect(plan.orders.map((o) => [o.ticker, o.action, o.adjust])).toEqual([
      ['A', 'hold', 0],
      ['B', 'buy', 100],
    ])
    expect(plan.leftover).toBeCloseTo(0)
    expect(plan.cash.adjust).toBeCloseTo(-100)
  })

  it('모자란 합이 새 돈보다 크면 비례로 나눈다', () => {
    const three = [
      row({ ticker: 'A', currency: 'KRW', current_value_base: 0, target_weight_pct: 50, last_close: 10 }),
      row({ ticker: 'B', currency: 'KRW', current_value_base: 0, target_weight_pct: 25, last_close: 10 }),
      row({ ticker: 'C', currency: 'KRW', current_value_base: 1000, target_weight_pct: 25, last_close: 10 }),
    ]
    // 전체 1100 → 목표 550 · 275 · 275, 모자람 550 · 275 · 0 (합 825) — 새 돈 100 을 2:1 로
    const plan = buildOrderPlan(three, 'KRW', {}, undefined, '100', true)
    expect(plan.orders.map((o) => Math.round(o.adjust * 100) / 100)).toEqual([66.67, 33.33, 0])
    expect(plan.orders.reduce((a, o) => a + o.adjust, 0)).toBeCloseTo(100)
  })

  it('모자란 합이 새 돈보다 작으면 모자란 만큼만 사고 나머지는 현금', () => {
    const near = [
      row({ ticker: 'A', currency: 'KRW', current_value_base: 1000, target_weight_pct: 50, last_close: 10 }),
      row({ ticker: 'B', currency: 'KRW', current_value_base: 960, target_weight_pct: 50, last_close: 10 }),
    ]
    // 전체 2160 → 목표 1080 · 1080, 모자람 80 · 120 — 새 돈 200 을 그대로
    const plan = buildOrderPlan(near, 'KRW', {}, { value_base: 0, target_pct: 0 }, '200', true)
    expect(plan.orders.map((o) => Math.round(o.adjust))).toEqual([80, 120])
    expect(plan.leftover).toBeCloseTo(0)
    const more = buildOrderPlan(near, 'KRW', {}, { value_base: 0, target_pct: 0 }, '1000', true)
    // 전체 2960 → 목표 1480 · 1480, 모자람 480 · 520 (합 1000) = 새 돈
    expect(more.leftover).toBeCloseTo(0)
  })

  it('현금도 목표에 모자라면 한 자리로 몫을 받아 현금에 남는다', () => {
    const rows = [
      row({ ticker: 'A', currency: 'KRW', current_value_base: 800, target_weight_pct: 50, last_close: 10 }),
      row({ ticker: 'B', currency: 'KRW', current_value_base: 1000, target_weight_pct: 40, last_close: 10 }),
    ]
    // 전체 2000(새 돈 200) → 목표 A 1000 · B 800 · 현금 200 — 모자람 A 200 · 현금 200 (합 400) — 새 돈을 반반
    const plan = buildOrderPlan(rows, 'KRW', {}, { value_base: 0, target_pct: 10 }, '200', true)
    expect(plan.orders.map((o) => [o.action, Math.round(o.adjust)])).toEqual([
      ['buy', 100],
      ['hold', 0],
    ])
    expect(plan.leftover).toBeCloseTo(100)
  })

  it('나눈 몫이 잡음(0.5% 미만)이면 "유지"이고 그 몫은 현금에', () => {
    const rows = [
      row({ ticker: 'A', currency: 'KRW', current_value_base: 995, target_weight_pct: 50, last_close: 10 }),
      row({ ticker: 'B', currency: 'KRW', current_value_base: 805, target_weight_pct: 50, last_close: 10 }),
    ]
    // 전체 2000 → 모자람 A 5(0.25%) · B 195 — A 는 유지, 5 는 현금에 남는다
    const plan = buildOrderPlan(rows, 'KRW', {}, { value_base: 0, target_pct: 0 }, '200', true)
    expect(plan.orders.map((o) => [o.action, Math.round(o.adjust)])).toEqual([
      ['hold', 0],
      ['buy', 195],
    ])
    expect(plan.leftover).toBeCloseTo(5)
  })

  it('새로 넣을 돈이 없으면 켜 둬도 지금 계산', () => {
    expect(buildOrderPlan(rowsAB, 'KRW', {}, undefined, '', true)).toEqual(buildOrderPlan(rowsAB, 'KRW', {}, undefined, ''))
  })
})

describe('주문 주수 — 정수 주 + 괄호에 소수 (0.42.0)', () => {
  it.each([
    [62.17, false, '62주 (62.17)'],
    [45, false, '45주'],
    [0.45, false, '1주 미만 (0.45주)'],
    [12.1, true, '+12주 (12.1)'],
    [-3.5, true, '−3주 (3.5)'],
    [1608.63, false, '1,608주 (1,608.63)'],
  ])('%s → %s', (shares, sign, text) => {
    expect(sharesText(shares as number, sign as boolean)).toBe(text)
  })

  it('주문 제목도 같은 꼴', () => {
    expect(orderTitle('SCHD', { action: 'sell', shares: -62.17, adjustNative: -1, currency: 'USD' })).toBe('SCHD 62주 (62.17) 팔기')
  })
})
