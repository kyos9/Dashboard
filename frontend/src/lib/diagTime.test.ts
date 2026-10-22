import { describe, expect, it } from 'vitest'
import { parseInstant, whenText } from './diagTime'

/** 진단 창의 시각 (0.45.2 B5) — 시험은 시간대를 넘겨 고정한다(CI 는 UTC 라 "보는 사람의 시간대"가 뜻이 없다) */
describe('진단 시각', () => {
  const at = Date.UTC(2026, 9, 22, 0, 30, 15)

  it('시간대가 붙은 글자 — +09:00 · Z · 마이크로초 · 콜론 없는 오프셋', () => {
    expect(parseInstant('2026-10-22T00:30:15+00:00')).toBe(at)
    expect(parseInstant('2026-10-22T09:30:15+09:00')).toBe(at)
    expect(parseInstant('2026-10-22T00:30:15Z')).toBe(at)
    expect(parseInstant('2026-10-22T00:30:15.123456Z')).toBe(at)
    expect(parseInstant('2026-10-21T19:30:15-0500')).toBe(at)
  })

  it('시간대가 없으면 부르는 쪽이 정한다 — UTC 로 읽거나(다시 계산), 모른다(옛 서버)', () => {
    expect(parseInstant('2026-10-22T00:30:15', 'utc')).toBe(at)
    // 사파리가 못 읽는 공백 꼴도
    expect(parseInstant('2026-10-22 00:30:15', 'utc')).toBe(at)
    expect(parseInstant('2026-10-22T00:30:15')).toBeNull()
    expect(parseInstant('어제')).toBeNull()
    expect(parseInstant(null)).toBeNull()
  })

  it('한 꼴 — 서울에서 UTC 00:30:15 는 09:30, 로그만 초까지', () => {
    expect(whenText(at, { timeZone: 'Asia/Seoul' })).toBe('10월 22일 09:30')
    expect(whenText(at, { seconds: true, timeZone: 'Asia/Seoul' })).toBe('10월 22일 09:30:15')
    expect(whenText(at, { timeZone: 'UTC' })).toBe('10월 22일 00:30')
  })

})
