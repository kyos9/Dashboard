import { describe, expect, it } from 'vitest'
import { applyTrade } from './trade'

describe('applyTrade — 산 것', () => {
  it('수량을 더하고 평단가를 가중평균으로 다시 낸다', () => {
    // 10주 @400 + 30주 @500 = 40주 @475 (단순평균이면 450이 나온다)
    const r = applyTrade({ quantity: 10, avg_cost: 400 }, 'buy', 30, 500)
    expect(r).toEqual({ ok: true, position: { quantity: 40, avg_cost: 475 } })
  })

  it('처음 사면 그 가격이 곧 평단가다', () => {
    expect(applyTrade({ quantity: 0, avg_cost: null }, 'buy', 3, 72_000)).toEqual({
      ok: true,
      position: { quantity: 3, avg_cost: 72_000 },
    })
  })

  it('들고 있던 몫의 평단가를 모르면 평균을 지어내지 않는다', () => {
    const r = applyTrade({ quantity: 5, avg_cost: null }, 'buy', 5, 100)
    expect(r).toEqual({ ok: true, position: { quantity: 10, avg_cost: null } })
  })

  it('가격이 없거나 0이면 거절한다', () => {
    expect(applyTrade({ quantity: 1, avg_cost: 1 }, 'buy', 1, null)).toEqual({
      ok: false,
      reason: '매수 가격을 입력하세요.',
    })
    expect(applyTrade({ quantity: 1, avg_cost: 1 }, 'buy', 1, 0).ok).toBe(false)
  })
})

describe('applyTrade — 판 것', () => {
  it('수량만 빼고 평단가는 그대로다', () => {
    expect(applyTrade({ quantity: 10, avg_cost: 400 }, 'sell', 4, null)).toEqual({
      ok: true,
      position: { quantity: 6, avg_cost: 400 },
    })
  })

  it('전부 팔면 평단가를 비운다 — 다음에 사는 값이 새 평단가다', () => {
    expect(applyTrade({ quantity: 0.3, avg_cost: 400 }, 'sell', 0.3, null)).toEqual({
      ok: true,
      position: { quantity: 0, avg_cost: null },
    })
  })

  it('가진 것보다 많이 팔 수는 없다', () => {
    const r = applyTrade({ quantity: 2, avg_cost: 400 }, 'sell', 3, null)
    expect(r.ok).toBe(false)
  })
})

it('수량이 0 이하면 거절한다', () => {
  expect(applyTrade({ quantity: 1, avg_cost: 1 }, 'buy', 0, 1).ok).toBe(false)
  expect(applyTrade({ quantity: 1, avg_cost: 1 }, 'sell', -1, null).ok).toBe(false)
})

describe('applyTrade — 산 환율 (ROADMAP 8-3)', () => {
  it('금액 가중 평균 — 손으로 계산한 값과 같다', () => {
    // 10주 @$400 @1,200원 + 30주 @$500 @1,400원
    // (10×400×1200 + 30×500×1400) ÷ (10×400 + 30×500) = (4,800,000 + 21,000,000) ÷ 19,000 = 1,357.894…
    const r = applyTrade({ quantity: 10, avg_cost: 400, avg_fx: 1200 }, 'buy', 30, 500, 1400)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.position.avg_fx).toBeCloseTo(25_800_000 / 19_000, 9)
    // 수량 가중(1,350)이 아니다
    expect(r.position.avg_fx).not.toBeCloseTo(1350, 3)
    expect(r.position.avg_cost).toBe(475)
  })

  it('처음 사면 그날 환율이 곧 산 환율이다', () => {
    expect(applyTrade({ quantity: 0, avg_cost: null, avg_fx: null }, 'buy', 3, 410, 1380)).toEqual({
      ok: true,
      position: { quantity: 3, avg_cost: 410, avg_fx: 1380 },
    })
  })

  it('들고 있던 몫의 환율이나 평단가를 모르면 평균을 지어내지 않는다', () => {
    const noFx = applyTrade({ quantity: 5, avg_cost: 100, avg_fx: null }, 'buy', 5, 100, 1300)
    expect(noFx.ok && noFx.position.avg_fx).toBeNull()
    const noCost = applyTrade({ quantity: 5, avg_cost: null, avg_fx: 1300 }, 'buy', 5, 100, 1300)
    expect(noCost.ok && noCost.position.avg_fx).toBeNull()
  })

  it('외화 종목을 살 때 환율이 없으면 거절한다', () => {
    expect(applyTrade({ quantity: 1, avg_cost: 1, avg_fx: 1300 }, 'buy', 1, 1, null)).toEqual({
      ok: false,
      reason: '산 날의 환율을 입력하세요.',
    })
    expect(applyTrade({ quantity: 1, avg_cost: 1, avg_fx: 1300 }, 'buy', 1, 1, 0).ok).toBe(false)
  })

  it('팔면 산 환율은 그대로, 전부 팔면 비운다', () => {
    const some = applyTrade({ quantity: 10, avg_cost: 400, avg_fx: 1250 }, 'sell', 4, null, 1400)
    expect(some).toEqual({ ok: true, position: { quantity: 6, avg_cost: 400, avg_fx: 1250 } })
    const all = applyTrade({ quantity: 10, avg_cost: 400, avg_fx: 1250 }, 'sell', 10, null, 1400)
    expect(all).toEqual({ ok: true, position: { quantity: 0, avg_cost: null, avg_fx: null } })
  })

  it('원화 종목은 환율을 넘기지 않고, 결과에도 산 환율이 없다', () => {
    const r = applyTrade({ quantity: 10, avg_cost: 400 }, 'buy', 30, 500)
    expect(r).toEqual({ ok: true, position: { quantity: 40, avg_cost: 475 } })
  })
})
