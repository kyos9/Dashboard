import { describe, expect, it } from 'vitest'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'
import type { FundamentalMetric } from '../types'
import {
  bigAmount,
  currentPer,
  latestQuarter,
  metricBasis,
  metricBasisParts,
  metricValue,
  perAxis,
  perAxisPos,
  perChartRows,
  perMarker,
  perPositionText,
  perTooltip,
  quarterLabel,
} from './fundamentals'

const metric = (key: FundamentalMetric['key']) => FUNDAMENTALS.metrics.find((m) => m.key === key)!

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

describe('몇 분기까지', () => {
  it('지표 근거 중 가장 늦은 분기 — 늦게 끊긴 항목에 끌려가지 않는다', () => {
    const at = (period_end: string | null) => ({ ...metric('per'), period_end })
    expect(latestQuarter([at('2026-03-31'), at('2026-06-30'), at(null), at('2025-12-31')])).toBe('2026-06-30')
    expect(latestQuarter([at('2026-06-30'), at('2026-03-31')])).toBe('2026-06-30')
    expect(latestQuarter([at(null)])).toBeNull()
    expect(latestQuarter([])).toBeNull()
  })
})

describe('PER 한눈에', () => {
  const withPer = (ticker: string, per: number | null, range: Partial<NonNullable<typeof FUNDAMENTALS.per_range>> | null) => ({
    ...FUNDAMENTALS,
    ticker,
    metrics: FUNDAMENTALS.metrics.map((m) => (m.key === 'per' ? { ...m, value: per } : m)),
    per_range: range === null ? null : { ...FUNDAMENTALS.per_range!, ...range },
  })
  const GOOG = FUNDAMENTALS
  const NVDA = withPer('NVDA', 180, { min: 25, max: 260, median: 60, current: 180, position_pct: 88 })
  const LOSS = withPer('LOSS', null, { min: 8, max: 30, median: 14, current: null, position_pct: null })
  const NEW = withPer('NEW', 12, null)
  const EMPTY = withPer('EMPTY', null, null)

  it('눈금은 모든 값을 담고, 로그라 두 배 차이는 같은 간격이다', () => {
    const axis = perAxis([GOOG, NVDA, LOSS])!
    expect(axis.lo).toBeLessThan(8)
    expect(axis.hi).toBeGreaterThan(260)
    expect(axis.ticks.every((t) => t >= axis.lo && t <= axis.hi)).toBe(true)
    expect(axis.ticks.length).toBeLessThanOrEqual(6)
    const gap1 = perAxisPos(axis, 20) - perAxisPos(axis, 10)
    const gap2 = perAxisPos(axis, 200) - perAxisPos(axis, 100)
    expect(gap1).toBeCloseTo(gap2, 6)
    expect(perAxisPos(axis, 100000)).toBe(100)
  })

  it('그릴 것이 없으면 눈금도 없다', () => {
    expect(perAxis([EMPTY])).toBeNull()
  })

  it('PER 이나 5년 범위가 있는 종목만, 위치 순은 낮은 것부터(위치 없는 것은 뒤)', () => {
    expect(perChartRows([GOOG, EMPTY, NVDA, NEW, LOSS], 'list').map((r) => r.ticker)).toEqual(['GOOG', 'NVDA', 'NEW', 'LOSS'])
    expect(perChartRows([NVDA, NEW, GOOG, LOSS], 'position').map((r) => r.ticker)).toEqual(['GOOG', 'NVDA', 'NEW', 'LOSS'])
  })

  it('지금 PER 은 0 이하면 없다', () => {
    expect(currentPer(GOOG)).toBe(28.14)
    expect(currentPer(LOSS)).toBeNull()
    expect(currentPer(withPer('NEG', -5, null))).toBeNull()
  })

  it('설명은 숫자만 — 판단하는 말이 없다', () => {
    const text = perTooltip(GOOG)
    expect(text).toContain('지금 28.1배')
    expect(text).toContain('최저 16.2 · 중앙값 24.1 · 최고 34.8')
    expect(text).toContain('지금 이하였던 날 71%')
    expect(perTooltip(LOSS)).toContain('지금 PER 없음')
    expect(perTooltip(NEW)).toContain('기록이 없습니다')
    for (const t of [text, perTooltip(NVDA)]) expect(t).not.toMatch(/싸|비싸|저평가|고평가/)
  })
})

describe('값 밑의 근거', () => {
  it('값이 있는 설명(연간 비교)은 근거에, 값이 없는 설명(적자)은 값 자리에', () => {
    const annual = { ...metric('revenue_yoy'), note: '연간 비교', period_end: '2026-03-31' }
    expect(metricBasisParts(annual)).toEqual(['2026.03까지', '연간 비교', '공시 2026-07-23'])
    const loss = { ...metric('per'), value: null, note: '적자' }
    expect(metricBasisParts(loss)).not.toContain('적자')
    expect(metricValue(loss, 'USD')).toBe('적자')
  })
})
