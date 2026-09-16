import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryResponse } from '../types'
import { MARKER_COLOR, PriceChart } from './PriceChart'

/**
 * 차트에 찍히는 점만 본다.
 *
 * 예전에는 매수 실행 기록(시그널/정기)과 매도 시그널을 서로 다른 모양·색·라벨로
 * 찍었는데, 라벨이 서로 겹쳐 선을 가렸고 정기 매수는 "신호"가 아니라 그냥 달력이었다.
 * 지금은 매수/매도 두 가지 점만 남긴다.
 */

const setMarkers = vi.fn()
const series = { setData: vi.fn() }
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  remove: vi.fn(),
  timeScale: () => ({ fitContent: vi.fn() }),
}

vi.mock('lightweight-charts', () => ({
  createChart: () => chart,
  createSeriesMarkers: () => ({ setMarkers: (m: unknown) => setMarkers(m) }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

function history(markers: HistoryResponse['markers']): HistoryResponse {
  return {
    ticker: 'VOO',
    prices: [
      { date: '2026-09-14', close: 100 },
      { date: '2026-09-15', close: 101 },
      { date: '2026-09-16', close: 102 },
    ],
    markers,
    coverage: { first_date: '2020-01-02', last_date: '2026-09-16', rows: 1_680 },
  }
}

const lastMarkers = () => setMarkers.mock.lastCall![0] as Record<string, unknown>[]

beforeEach(() => setMarkers.mockClear())

describe('차트 마커', () => {
  it('매수와 매도를 색과 위치로 구분한다', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'buy' },
          { date: '2026-09-16', kind: 'sell' },
        ])}
      />,
    )

    const markers = lastMarkers()
    expect(markers).toHaveLength(2)

    const buy = markers.find((m) => m.time === '2026-09-14')!
    const sell = markers.find((m) => m.time === '2026-09-16')!
    expect(buy.color).toBe(MARKER_COLOR.buy)
    expect(sell.color).toBe(MARKER_COLOR.sell)
    expect(buy.color).not.toBe(sell.color)
    // 색만으로 구분되지 않게 위치도 나눈다
    expect(buy.position).toBe('belowBar')
    expect(sell.position).toBe('aboveBar')
  })

  it('점만 찍고 글자는 붙이지 않는다', () => {
    // 몇 달치를 한 화면에 놓으면 라벨끼리 겹쳐 선이 보이지 않았다
    render(<PriceChart history={history([{ date: '2026-09-16', kind: 'sell' }])} />)
    expect(lastMarkers()[0].text).toBeUndefined()
    expect(lastMarkers()[0].shape).toBe('circle')
  })

  it('연달아 뜬 날은 점 하나로 묶는다', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'sell' },
          { date: '2026-09-15', kind: 'sell' },
          { date: '2026-09-16', kind: 'sell' },
        ])}
      />,
    )
    expect(lastMarkers()).toHaveLength(1)
    expect(lastMarkers()[0].time).toBe('2026-09-14')
  })

  it('같은 날 매수와 매도가 함께 뜨면 둘 다 찍는다', () => {
    // 한쪽이 조용히 가려지면 화면이 사실과 달라진다
    render(
      <PriceChart
        history={history([
          { date: '2026-09-16', kind: 'buy' },
          { date: '2026-09-16', kind: 'sell' },
        ])}
      />,
    )
    expect(lastMarkers()).toHaveLength(2)
  })

  it('시그널이 없으면 점도 없다', () => {
    render(<PriceChart history={history([])} />)
    expect(lastMarkers()).toEqual([])
  })
})
