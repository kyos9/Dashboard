import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MacroChart } from './MacroChart'

// 매크로 차트도 언어를 ko-KR 로 못 박고 눈금·십자선 날짜를 종목 차트와 같은 꼴로 (0.42.0 B3·B8)
const created: { localization: { locale: string; timeFormatter: (t: string) => string }; timeScale: { tickMarkFormatter: unknown } }[] = []
const series = { setData: vi.fn(), createPriceLine: vi.fn(), applyOptions: vi.fn() }
const chart = { addSeries: vi.fn(() => series), applyOptions: vi.fn(), remove: vi.fn(), timeScale: () => ({ fitContent: vi.fn() }) }

vi.mock('lightweight-charts', () => ({
  createChart: (_el: unknown, options: (typeof created)[number]) => {
    created.push(options)
    return chart
  },
  LineSeries: 'Line',
  LineStyle: { Dashed: 2 },
  TickMarkType: { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 },
}))

describe('매크로 차트 꼴', () => {
  it('locale ko-KR · 십자선 "2026-10-09" · 눈금 함수', () => {
    render(<MacroChart history={{ code: 'VIX', name: 'VIX', unit: '', transform: 'level', transform_label: null, points: [] }} />)
    const options = created[0]
    expect(options.localization.locale).toBe('ko-KR')
    expect(options.localization.timeFormatter('2026-10-09')).toBe('2026-10-09')
    const tick = options.timeScale.tickMarkFormatter as (t: unknown, k: number) => string
    expect(tick({ year: 2026, month: 10, day: 9 }, 2)).toBe('10.09')
  })
})
