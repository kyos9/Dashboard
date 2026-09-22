import { describe, expect, it } from 'vitest'
import { needsZeroLine } from './MacroChart'

describe('0선', () => {
  it('금리처럼 계속 양수인 지표에는 안 그린다', () => {
    // 그리면 세로축이 0까지 늘어나 4.0~4.2의 움직임이 납작해진다
    expect(needsZeroLine([{ value: 4.05 }, { value: 4.11 }])).toBe(false)
  })

  it('0을 오가면 그린다 — 부호가 바뀌는 지점이 이 차트의 전부다', () => {
    expect(needsZeroLine([{ value: 0.4 }, { value: -0.25 }])).toBe(true)
  })

  it('구간 전체가 음수여도 그린다 — "얼마나 아래인가"에 기준선이 필요하다', () => {
    expect(needsZeroLine([{ value: -0.3 }, { value: -0.25 }])).toBe(true)
  })

  it('점이 없으면 안 그린다', () => {
    expect(needsZeroLine([])).toBe(false)
  })

  it('딱 0은 음수가 아니다', () => {
    expect(needsZeroLine([{ value: 0 }, { value: 1 }])).toBe(false)
  })
})
