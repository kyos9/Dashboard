import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LEGACY_SIGNAL_RULES, resetSignalRules, setSignalRules } from '../lib/signalRules'
import { ChartLegend } from './PriceChart'

afterEach(() => resetSignalRules())

describe('차트 범례 · 내 기준 (0.42.0)', () => {
  const history = { ticker: 'VOO', prices: [], markers: [], coverage: null } as never

  it('기본 기준이면 표시가 없다', () => {
    render(<ChartLegend history={history} loading={false} />)
    expect(screen.queryByText('내 기준')).toBeNull()
  })

  it('내 기준을 쓰면 점이 그 기준으로 찍혔다고 보인다', () => {
    act(() => setSignalRules({ ...LEGACY_SIGNAL_RULES, version: 'mine', custom: true }))
    render(<ChartLegend history={history} loading={false} />)
    expect(screen.getByText('내 기준')).toBeInTheDocument()
  })
})

describe('차트 범례 · 말 (디자인 2차)', () => {
  it('"구간" 대신 날 수가 먼저, 이어서 뜬 묶음 수는 괄호 — 풀이는 툴팁', () => {
    const history = {
      ticker: 'VOO',
      prices: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'].map((date) => ({ date, close: 1 })),
      markers: [
        { date: '2026-09-14', kind: 'buy' },
        { date: '2026-09-15', kind: 'buy' },
        { date: '2026-09-17', kind: 'buy' },
      ],
      coverage: null,
    } as never
    render(<ChartLegend history={history} loading={false} />)
    const buy = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '매수 3일 (2번)')
    expect(buy).toHaveAttribute('title', expect.stringContaining('한 번으로 센'))
    expect(screen.queryByText(/구간/)).toBeNull()
  })
})

describe('차트 범례 · 길게 누르기 풀이 (0.45.2 C3)', () => {
  const history = { ticker: 'VOO', prices: [{ date: '2026-09-14', close: 1 }], markers: [], coverage: null } as never

  it('손가락 기기용 풀이가 붙는다(마우스 기기는 CSS 로 숨긴다) — 불러오는 중에는 없다', () => {
    const { container, rerender } = render(<ChartLegend history={history} loading={false} />)
    const hint = container.querySelector('.touch-only')
    expect(hint).toHaveTextContent('길게 누른 채 밀면 날짜가 따라옵니다')
    rerender(<ChartLegend history={history} loading />)
    expect(container.querySelector('.touch-only')).toBeNull()
  })
})
