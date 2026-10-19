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
const series = { setData: vi.fn(), dataByIndex: vi.fn() }
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  remove: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  setCrosshairPosition: vi.fn(),
  timeScale: () => ({ fitContent: vi.fn() }),
}

const created: unknown[] = []
vi.mock('lightweight-charts', () => ({
  createChart: (_el: unknown, options: unknown) => {
    created.push(options)
    return chart
  },
  createSeriesMarkers: () => ({ setMarkers: (m: unknown) => setMarkers(m) }),
  LineSeries: 'Line',
  MismatchDirection: { NearestLeft: -1 },
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

  it('모양만 찍고 글자는 붙이지 않는다 — 매수 ▲ · 매도 ▼', () => {
    // 몇 달치를 한 화면에 놓으면 라벨끼리 겹쳐 선이 보이지 않았다
    render(<PriceChart history={history([{ date: '2026-09-15', kind: 'buy' }, { date: '2026-09-16', kind: 'sell' }])} />)
    const [buy, sell] = lastMarkers()
    expect(buy.text).toBeUndefined()
    expect(buy.shape).toBe('arrowUp')
    expect(sell.shape).toBe('arrowDown')
  })

  it('연달아 뜬 날은 점 하나로 묶는다', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'sell' },
          { date: '2026-09-15', kind: 'sell' },
        ])}
      />,
    )
    expect(lastMarkers()).toHaveLength(1)
    expect(lastMarkers()[0].time).toBe('2026-09-14')
  })

  it('오늘(차트 마지막 날)까지 이어진 구간은 오늘에도 찍는다 — 카드의 "오늘"과 차트가 맞게 (0.42.0)', () => {
    render(
      <PriceChart
        history={history([
          { date: '2026-09-14', kind: 'buy' },
          { date: '2026-09-15', kind: 'buy' },
          { date: '2026-09-16', kind: 'buy' },
        ])}
      />,
    )
    expect(lastMarkers().map((m) => m.time)).toEqual(['2026-09-14', '2026-09-16'])
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

  it('언어를 ko-KR 로 못 박고, 세로축 가격은 그 종목 통화의 꼴로 (0.42.0 — "en-US@posix" 에서 빈 칸, "68000.00")', () => {
    created.length = 0
    chart.applyOptions.mockClear()
    render(<PriceChart history={{ ...history([]), ticker: '005930.KS' }} />)
    const options = created[0] as { localization: { locale: string; timeFormatter: (t: string) => string } }
    expect(options.localization.locale).toBe('ko-KR')
    expect(options.localization.timeFormatter('2026-10-09')).toBe('2026-10-09')
    const formatter = chart.applyOptions.mock.calls
      .map(([o]) => (o as { localization?: { priceFormatter?: (v: number) => string } }).localization?.priceFormatter)
      .find(Boolean)!
    expect(formatter(68000)).toBe('68,000')
  })
})

describe('차트 위 한 줄과 짧은 탭 (0.44.0 C1)', () => {
  type Handler = (param: { time?: string; seriesData: Map<unknown, unknown> }) => void
  const handler = (fn: unknown) => (fn as { mock: { lastCall: [Handler] } }).mock.lastCall[0]
  const at = (time: string | undefined, value?: number) => ({
    time,
    seriesData: new Map(value === undefined ? [] : [[series, { value }]]),
  })

  it('처음에는 마지막 날의 날짜·종가, 그 날이 "마지막 날"임을 말한다', () => {
    const { container } = render(<PriceChart history={history([])} />)
    const line = container.querySelector('.chart-readout')!
    expect(line).toHaveTextContent('2026-09-16 · 종가 102.00')
    expect(line).toHaveTextContent('마지막 날 — 차트를 누르면 그 날')
  })

  it('짧게 탭하면 십자선을 그 자리로 옮기고, 한 줄이 그 날을 말한다', async () => {
    const { container } = render(<PriceChart history={history([])} />)
    const { act } = await import('@testing-library/react')
    act(() => handler(chart.subscribeClick)(at('2026-09-14', 100)))
    // 앞서 있던 자리(고점 등)에 남지 않는다 — 탭한 날의 종가에
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(100, '2026-09-14', series)
    const line = container.querySelector('.chart-readout')!
    expect(line).toHaveTextContent('2026-09-14 · 종가 100.00')
    expect(line).not.toHaveTextContent('마지막 날')
  })

  it('십자선이 움직이면 그 날, 차트를 떠나면 마지막 날로 돌아간다. 빈 자리 탭은 아무것도 옮기지 않는다', async () => {
    const { container } = render(<PriceChart history={history([])} />)
    const { act } = await import('@testing-library/react')
    const line = () => container.querySelector('.chart-readout')!
    act(() => handler(chart.subscribeCrosshairMove)(at('2026-09-15', 101)))
    expect(line()).toHaveTextContent('2026-09-15 · 종가 101.00')
    act(() => handler(chart.subscribeCrosshairMove)(at(undefined)))
    expect(line()).toHaveTextContent('2026-09-16 · 종가 102.00')

    chart.setCrosshairPosition.mockClear()
    act(() => handler(chart.subscribeClick)(at(undefined)))
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled()
  })

  it('종목을 바꾸면 가리켰던 날을 버리고 새 종목의 마지막 날 (그 날·값이 새 데이터에 없다)', async () => {
    const { container, rerender } = render(<PriceChart history={history([])} />)
    const { act } = await import('@testing-library/react')
    act(() => handler(chart.subscribeClick)(at('2026-09-14', 100)))
    const other = { ...history([]), ticker: 'QQQ', prices: [{ date: '2026-09-14', close: 300 }, { date: '2026-09-16', close: 310 }] }
    rerender(<PriceChart history={other} />)
    expect(container.querySelector('.chart-readout')).toHaveTextContent('2026-09-16 · 종가 310.00')
  })

  it('오른쪽 빈 칸(날이 없는 자리)을 탭하면 마지막 날로 — 오늘로 돌아가는 길', async () => {
    const { container } = render(<PriceChart history={history([])} />)
    const { act } = await import('@testing-library/react')
    act(() => handler(chart.subscribeClick)(at('2026-09-14', 100)))
    series.dataByIndex.mockReturnValueOnce({ time: '2026-09-16', value: 102 })
    act(() => handler(chart.subscribeClick)({ ...at(undefined), logical: 4 } as never))
    expect(series.dataByIndex).toHaveBeenLastCalledWith(4, -1)
    expect(chart.setCrosshairPosition).toHaveBeenLastCalledWith(102, '2026-09-16', series)
    expect(container.querySelector('.chart-readout')).toHaveTextContent('2026-09-16 · 종가 102.00')
  })

  it('한 줄의 값은 그 종목의 통화 꼴 — 원화는 소수점 없이', () => {
    const krw = { ...history([]), ticker: '005930.KS', prices: [{ date: '2026-09-15', close: 67_900 }, { date: '2026-09-16', close: 68_000 }] }
    const { container } = render(<PriceChart history={krw} />)
    expect(container.querySelector('.chart-readout')).toHaveTextContent('2026-09-16 · 종가 68,000')
    expect(container.querySelector('.chart-readout')?.textContent).not.toMatch(/68,000\.00/)
  })

  it('닫으면 구독을 푼다', () => {
    const { unmount } = render(<PriceChart history={history([])} />)
    unmount()
    expect(chart.unsubscribeClick).toHaveBeenCalled()
    expect(chart.unsubscribeCrosshairMove).toHaveBeenCalled()
  })
})
