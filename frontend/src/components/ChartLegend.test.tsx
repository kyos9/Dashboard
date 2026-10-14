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
