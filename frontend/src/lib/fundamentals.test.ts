import { describe, expect, it } from 'vitest'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'
import type { FundamentalMetric } from '../types'
import {
  bigAmount,
  metricBasis,
  metricValue,
  perMarker,
  perPositionText,
  quarterLabel,
  summaryLine,
} from './fundamentals'

const metric = (key: FundamentalMetric['key']) => FUNDAMENTALS.metrics.find((m) => m.key === key)!

describe('재무 한 줄', () => {
  it('PER · ROE · 매출 전년비', () => {
    expect(summaryLine({ per: 28.14, per_note: null, roe: 31.2, revenue_yoy: 6.4, period_end: '2026-06-30' })).toBe(
      'PER 28.1 · ROE 31% · 매출 +6%',
    )
  })

  it('적자면 PER 자리에 이유를 쓰고, 없는 값은 뺀다', () => {
    expect(summaryLine({ per: null, per_note: '적자', roe: null, revenue_yoy: -12, period_end: null })).toBe(
      'PER 적자 · 매출 -12%',
    )
  })

  it('값이 하나도 없으면 줄을 그리지 않는다', () => {
    expect(summaryLine({ per: null, per_note: null, roe: null, revenue_yoy: null, period_end: null })).toBeNull()
    expect(summaryLine(null)).toBeNull()
  })
})

describe('재무 숫자', () => {
  it('큰 금액은 달러 B·T, 원 조·억', () => {
    expect(bigAmount(119_796_000_000, 'USD')).toBe('$119.8B')
    expect(bigAmount(-2_500_000, 'USD')).toBe('−$2.5M')
    expect(bigAmount(1_270_000_000_000, 'USD')).toBe('$1.27T')
    expect(bigAmount(79_140_000_000_000, 'KRW')).toBe('₩79.1조')
    expect(bigAmount(null, 'USD')).toBe('—')
  })

  it('지표마다 단위가 다르다', () => {
    expect(metricValue(metric('per'), 'USD')).toBe('28.1배')
    expect(metricValue(metric('pbr'), 'USD')).toBe('4.70배')
    expect(metricValue(metric('dividend_yield'), 'USD')).toBe('0.34%')
    expect(metricValue(metric('operating_income_yoy'), 'USD')).toBe('-3.2%')
    expect(metricValue(metric('revenue_yoy'), 'USD')).toBe('+24.6%')
    expect(metricValue(metric('fcf'), 'USD')).toBe('—')
    expect(metricValue({ ...metric('per'), value: null, note: '적자' }, 'USD')).toBe('적자')
  })

  it('근거 — 어느 분기까지, 언제 공시', () => {
    expect(metricBasis(metric('per'))).toBe('2026.06까지 · 공시 2026-07-23')
    expect(metricBasis({ ...metric('per'), estimated: true })).toBe('2026.06까지 · 공시 2026-07-23 (추정)')
    expect(metricBasis({ ...metric('per'), period_end: null })).toBe('공시에 없음')
    expect(quarterLabel('2026-07-26')).toBe('2026.07')
  })
})

describe('PER 5년 위치', () => {
  it('사실만 적는다 — 판단하는 말이 없다', () => {
    const text = perPositionText(FUNDAMENTALS.per_range!)!
    expect(text).toBe('지난 2021.09부터 PER이 지금(28.1배) 이하였던 날은 71%입니다.')
    expect(text).not.toMatch(/저평가|고평가|싸|비싸|매수|매도/)
  })

  it('막대 위 위치는 0~100 안에 머문다', () => {
    const range = FUNDAMENTALS.per_range!
    expect(perMarker(range, range.min)).toBe(0)
    expect(perMarker(range, range.max)).toBe(100)
    expect(perMarker(range, 99)).toBe(100)
    expect(perMarker(range, null)).toBeNull()
  })
})
