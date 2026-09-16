import { describe, expect, it } from 'vitest'
import type { DashboardCard, KneeConditions } from '../types'
import {
  amount,
  categoryOf,
  CATEGORY_UNSET,
  kneeMetCount,
  num,
  providerLabel,
  price,
  readAdx,
  readDi,
  readDisparity,
  readMa200,
  readVolume,
  signed,
  signedAmount,
  trafficLight,
} from './display'

describe('통화 표기', () => {
  it('원화는 소수점 없이, 달러는 센트까지', () => {
    expect(price(79600, 'KRW')).toBe('₩79,600')
    expect(price(458.923, 'USD')).toBe('$458.92')
  })

  it('원화 가격을 반올림해 정수로 보여준다', () => {
    expect(price(79600.7, 'KRW')).toBe('₩79,601')
  })

  it('값이 없으면 대시', () => {
    expect(price(null, 'KRW')).toBe('—')
    expect(amount(undefined, 'USD')).toBe('—')
    expect(signedAmount(NaN, 'USD')).toBe('—')
  })

  it('금액에 통화 기호를 붙여 어느 돈인지 분명히 한다', () => {
    expect(amount(1_300_000, 'KRW')).toBe('₩1,300,000')
    expect(amount(9003.96, 'USD')).toBe('$9,003.96')
  })

  it('부호 있는 금액은 방향을 앞에 세운다', () => {
    expect(signedAmount(5201.68, 'USD')).toBe('+$5,201.68')
    expect(signedAmount(-5201.68, 'USD')).toBe('−$5,201.68')
    expect(signedAmount(0, 'KRW')).toBe('₩0')
  })

  it('알 수 없는 통화는 달러 표기로 처리한다 (화면이 깨지지 않게)', () => {
    // @ts-expect-error 백엔드가 새 통화를 보내는 상황을 가정
    expect(price(100, 'JPY')).toBe('$100.00')
  })
})

describe('숫자 표기', () => {
  it('소수 자릿수를 맞춘다', () => {
    expect(num(85.5312, 1)).toBe('85.5')
    expect(num(null)).toBe('—')
  })

  it('부호와 단위를 붙인다', () => {
    expect(signed(4.2, 2, '%')).toBe('+4.20%')
    expect(signed(-4.2, 2, '%')).toBe('-4.20%')
  })
})

describe('지표 해석', () => {
  it('이격도: MA20 위면 강세(초록), 아래면 약세(빨강)', () => {
    expect(readDisparity(3).tone).toBe('green')
    expect(readDisparity(-3).tone).toBe('red')
    expect(readDisparity(null).tone).toBe('grey')
  })

  it('ADX 20 이하는 추세 없음 — 무릎매수 조건 경계와 맞아야 한다', () => {
    expect(readAdx(19.9).note).toBe('추세 없음')
    expect(readAdx(21).note).not.toBe('추세 없음')
  })

  it('DI는 우열로 방향을 말한다', () => {
    expect(readDi(30, 20).tone).toBe('green')
    expect(readDi(20, 30).tone).toBe('red')
    expect(readDi(20, 20).tone).toBe('grey')
  })

  it('거래량비 1.1 초과가 무릎매수 대체조건', () => {
    expect(readVolume(1.2).note).toBe('거래량 증가')
    expect(readVolume(1.0).note).toBe('거래량 보통')
  })

  it('200일선 이탈 여부와 거리(%)를 함께 준다', () => {
    const above = readMa200(110, 100)
    expect(above.tone).toBe('green')
    expect(above.pct).toBeCloseTo(10)

    const below = readMa200(90, 100)
    expect(below.tone).toBe('red')
    expect(below.pct).toBeCloseTo(-10)

    expect(readMa200(100, 0).pct).toBeNull() // 0으로 나누지 않는다
  })
})

describe('종합 신호등', () => {
  const card = (overrides: Partial<DashboardCard>): DashboardCard =>
    ({
      ticker: 'VOO',
      name: null,
      category: null,
      market: 'US',
      currency: 'USD',
      data_stale: false,
      price_source: 'yahoo',
      indicators: {} as DashboardCard['indicators'],
      knee_buy_v2: false,
      knee_conditions: {} as KneeConditions,
      shoulder_sell_ref: false,
      current_period_buy: null,
      rebalance_signal: { active: false, reasons: [] },
      ...overrides,
    }) as DashboardCard

  it('시세가 오래되면 판정하지 않는다', () => {
    expect(trafficLight(card({ data_stale: true, knee_buy_v2: true })).state).toBe('stale')
  })

  it('무릎매수가 어깨매도보다 우선한다 (실행 가능한 쪽)', () => {
    expect(trafficLight(card({ knee_buy_v2: true, shoulder_sell_ref: true })).state).toBe('buy')
  })

  it('어깨매도만 뜨면 과열 주의', () => {
    expect(trafficLight(card({ shoulder_sell_ref: true })).state).toBe('hot')
  })

  it('아무 조건도 없으면 관망', () => {
    expect(trafficLight(card({})).state).toBe('watch')
  })
})

describe('무릎매수 조건 카운트', () => {
  it('충족된 조건만 센다 (판정 불가는 제외)', () => {
    expect(
      kneeMetCount({
        di_bearish: true,
        disparity_negative: true,
        volatility_or_volume: false,
        adx_trending: null,
      }),
    ).toBe(2)
  })

  it('네 조건이 모두 참이면 4', () => {
    expect(
      kneeMetCount({
        di_bearish: true,
        disparity_negative: true,
        volatility_or_volume: true,
        adx_trending: true,
      }),
    ).toBe(4)
  })
})

describe('구분(카테고리)', () => {
  it('비어 있으면 미분류로 묶는다', () => {
    expect(categoryOf(null)).toBe(CATEGORY_UNSET)
    expect(categoryOf('   ')).toBe(CATEGORY_UNSET)
    expect(categoryOf(' 지수 ')).toBe('지수')
  })
})

describe('시세 출처 표기', () => {
  it('제공자 이름을 화면에서 읽을 수 있게 바꾼다', () => {
    expect(providerLabel('naver')).toBe('네이버')
    expect(providerLabel('yahoo')).toBe('야후')
    expect(providerLabel('stooq')).toBe('Stooq')
  })

  it('출처를 모르는 예전 시세는 아무것도 붙이지 않는다', () => {
    // 출처 기록 전에 받아둔 시세다. 모르는 걸 지어내면 잘못된 근거가 된다.
    expect(providerLabel(null)).toBeNull()
    expect(providerLabel(undefined)).toBeNull()
    expect(providerLabel('')).toBeNull()
  })

  it('처음 보는 제공자는 이름 그대로 보여준다', () => {
    expect(providerLabel('krx')).toBe('krx')
  })
})
