import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import type { DashboardCard } from '../types'
import { readAdx, readVolume, trafficLight } from './display'
import {
  buyRuleSentence,
  cardConditions,
  conditionByMetric,
  countWord,
  ensureSignalRules,
  LEGACY_SIGNAL_RULES,
  resetSignalRules,
} from './signalRules'

beforeEach(() => {
  vi.restoreAllMocks()
  resetSignalRules()
})
afterEach(() => resetSignalRules())

describe('시그널 규칙 — 옛 서버용 규칙 (0.40.0 의 기준, 이름은 0.42.0 에 하나로 맞춤)', () => {
  it('설명 줄·열 머리·칩 이름', () => {
    expect(buyRuleSentence(LEGACY_SIGNAL_RULES)).toBe(
      '매수 시그널 = 이격도 < 0 · ADX > 20 · DI 약세(-DI > +DI) · 변동성·거래량(StdDev20 축소 또는 거래량비 > 1.1) — 네 조건을 모두 만족할 때.',
    )
    const byMetric = conditionByMetric(LEGACY_SIGNAL_RULES)
    expect(Object.keys(byMetric).sort()).toEqual(['adx', 'di', 'disparity', 'volume'])
    expect(byMetric.adx).toMatchObject({ key: 'adx_trending', label: 'ADX > 20', header: '> 20' })
    expect(byMetric.volume).toMatchObject({ label: '변동성·거래량', header: '변동성↓ 또는 >1.1' })
  })

  it('조건 수를 글로', () => {
    expect([countWord(3), countWord(4), countWord(5), countWord(12)]).toEqual(['세', '네', '다섯', '12'])
  })

  it('풀이의 기준값은 규칙을 따른다 (기본은 0.40.0 의 값)', () => {
    expect(readAdx(19.9).note).toBe('추세 없음')
    expect(readAdx(22).note).toBe('추세 형성')
    expect(readAdx(22, 25).note).toBe('추세 없음')
    expect(readAdx(24.9).note).toBe('추세 형성')
    expect(readAdx(25).note).toBe('추세 강함')
    expect(readAdx(27, 25).note).toBe('추세 형성') // 기준을 올려도 '추세 형성' 구간이 남는다
    expect(readVolume(1.15).note).toBe('거래량 증가')
    expect(readVolume(1.15, 1.2).note).toBe('거래량 보통')
  })

  it('신호등 풀이의 조건 수', () => {
    const card = { data_stale: false, knee_buy_v2: true, shoulder_sell_ref: false } as DashboardCard
    expect(trafficLight(card).desc).toBe('매수 시그널 — 매수 조건 4개를 모두 만족합니다.')
  })
})

describe('카드의 조건별 판정', () => {
  const base = {
    knee_conditions: { di_bearish: true, disparity_negative: false, volatility_or_volume: null, adx_trending: true },
  } as DashboardCard

  it('옛 서버(새 필드 없음 · 빈 값)는 knee_conditions', () => {
    expect(cardConditions(base)).toEqual(base.knee_conditions)
    expect(cardConditions({ ...base, buy_conditions: {} })).toEqual(base.knee_conditions)
  })

  it('새 서버는 buy_conditions', () => {
    expect(cardConditions({ ...base, buy_conditions: { x: true } })).toEqual({ x: true })
  })
})

describe('규칙 받기', () => {
  it('한 번만 묻고, 같은 판이면 다시 묻지 않는다', async () => {
    const get = vi.spyOn(api, 'getSignalRules').mockResolvedValue(LEGACY_SIGNAL_RULES)
    await Promise.all([ensureSignalRules(), ensureSignalRules()])
    await ensureSignalRules(LEGACY_SIGNAL_RULES.version)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('옛 서버(404)면 0.40.0 규칙으로 계속 그리고, 판을 말하는 카드가 오면 다시 묻는다', async () => {
    const get = vi.spyOn(api, 'getSignalRules').mockRejectedValue(new ApiError(404, null, 'Not Found', null))
    await ensureSignalRules()
    await ensureSignalRules() // 판을 모르면 다시 묻지 않는다
    expect(get).toHaveBeenCalledTimes(1)
    await ensureSignalRules('abc')
    expect(get).toHaveBeenCalledTimes(2)
  })
})
