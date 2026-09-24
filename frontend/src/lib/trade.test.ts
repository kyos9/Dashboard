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
