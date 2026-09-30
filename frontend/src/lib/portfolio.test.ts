/**
 * 평가손익을 한 통화로 (ROADMAP 9-12) — 지금 환율 하나로 바꾸고, 모르면 바꾸지 않는다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { FxInfo, FxQuote, RebalanceRow } from '../types'
import { convertAmount, loadPnlCurrency, pnlCurrencyOptions, pnlIn, savePnlCurrency } from './portfolio'

function quote(currency: 'USD' | 'JPY', krw_rate: number): FxQuote {
  return { currency, krw_rate, source: 'stored', updated_at: null, is_estimate: false }
}

const FX: FxInfo = { rates: { USD: quote('USD', 1350), JPY: quote('JPY', 9) }, is_estimate: false }

function row(o: Partial<RebalanceRow>): RebalanceRow {
  return {
    ticker: 'X',
    name: null,
    currency: 'USD',
    target_weight_pct: 0,
    actual_weight_pct: 0,
    excess_pct: 0,
    band_pct: 5,
    shoulder_signal_fired_in_period: false,
    rebalance_signal: { active: false, reasons: [] },
    quantity: 1,
    avg_cost: 1,
    last_close: 1,
    current_value: 1,
    current_value_base: 1,
    cost_value: 1,
    unrealized_pnl: null,
    return_pct: null,
    ...o,
  }
}

beforeEach(() => localStorage.clear())

describe('convertAmount', () => {
  it('원을 사이에 두고 바꾼다 — 달러→원, 원→달러, 엔→달러', () => {
    expect(convertAmount(100, 'USD', 'KRW', FX)).toBe(135_000)
    expect(convertAmount(135_000, 'KRW', 'USD', FX)).toBe(100)
    expect(convertAmount(15_000, 'JPY', 'USD', FX)).toBe(100)
    expect(convertAmount(7, 'USD', 'USD', FX)).toBe(7)
  })

  it('환율을 모르면 null — 0 으로 보이면 거짓말이다', () => {
    const noJpy: FxInfo = { rates: { USD: quote('USD', 1350) }, is_estimate: false }
    expect(convertAmount(100, 'JPY', 'KRW', noJpy)).toBeNull()
    expect(convertAmount(100, 'KRW', 'JPY', noJpy)).toBeNull()
  })
})

describe('pnlIn', () => {
  it('종목별이면 서버가 준 그대로 — 환율 효과를 켠 줄은 원화', () => {
    expect(pnlIn(row({ unrealized_pnl: 10 }), 'local', FX)).toEqual({ value: 10, currency: 'USD' })
    const withFx = row({ unrealized_pnl: 10, shown_pnl: 20_000, shown_currency: 'KRW' })
    expect(pnlIn(withFx, 'local', FX)).toEqual({ value: 20_000, currency: 'KRW' })
  })

  it('고른 통화로 바꾼다 — 환율 효과를 켠 줄은 원화 손익을 바꾼다', () => {
    expect(pnlIn(row({ unrealized_pnl: 10 }), 'KRW', FX)).toEqual({ value: 13_500, currency: 'KRW' })
    const withFx = row({ unrealized_pnl: 10, shown_pnl: 27_000, shown_currency: 'KRW' })
    expect(pnlIn(withFx, 'USD', FX)).toEqual({ value: 20, currency: 'USD' })
    const krw = row({ currency: 'KRW', unrealized_pnl: 13_500, shown_currency: 'KRW' })
    expect(pnlIn(krw, 'USD', FX)).toEqual({ value: 10, currency: 'USD' })
  })

  it('평단가를 몰라 손익이 없으면 없는 채로', () => {
    expect(pnlIn(row({ unrealized_pnl: null }), 'KRW', FX)).toEqual({ value: null, currency: 'KRW' })
  })
})

describe('pnlCurrencyOptions', () => {
  it('환율을 아는 통화만 — 원은 늘 된다', () => {
    expect(pnlCurrencyOptions(FX, ['USD', 'KRW'])).toEqual(['local', 'KRW', 'USD', 'JPY'])
    const usdOnly: FxInfo = { rates: { USD: quote('USD', 1350) }, is_estimate: false }
    expect(pnlCurrencyOptions(usdOnly, ['USD', 'KRW'])).toEqual(['local', 'KRW', 'USD'])
  })

  it('내 종목 중 하나라도 환율을 모르면 종목별만 남는다', () => {
    const none: FxInfo = { rates: {}, is_estimate: false }
    expect(pnlCurrencyOptions(none, ['USD', 'KRW'])).toEqual(['local'])
    expect(pnlCurrencyOptions(none, ['KRW'])).toEqual(['local', 'KRW'])
  })
})

describe('기억', () => {
  it('고른 통화를 기억하고, 이상한 값은 종목별로', () => {
    expect(loadPnlCurrency()).toBe('local')
    savePnlCurrency('USD')
    expect(loadPnlCurrency()).toBe('USD')
    localStorage.setItem('dashboard.pnl-currency', 'EUR')
    expect(loadPnlCurrency()).toBe('local')
  })
})
