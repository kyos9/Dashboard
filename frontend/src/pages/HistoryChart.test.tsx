import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { HistoryResponse, Stock } from '../types'
import { HistoryChart } from './HistoryChart'

/**
 * lightweight-charts는 실제 캔버스를 그리므로 jsdom에서 돌릴 수 없다. 여기서 확인하려는
 * 것은 그림의 모양이 아니라 **차트를 만들기는 하는가**다 — 컨테이너가 나중에 나타나면
 * 차트 생성이 영영 실행되지 않던 버그가 있었다.
 */
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  remove: vi.fn(),
  subscribeCrosshairMove: vi.fn(),
  unsubscribeCrosshairMove: vi.fn(),
  subscribeClick: vi.fn(),
  unsubscribeClick: vi.fn(),
  subscribeDblClick: vi.fn(),
  unsubscribeDblClick: vi.fn(),
  setCrosshairPosition: vi.fn(),
  timeScale: () => ({ fitContent: vi.fn() }),
}
const series = { setData: vi.fn() }
const markers = { setMarkers: vi.fn() }
const createChart = vi.fn(() => chart)

vi.mock('lightweight-charts', () => ({
  createChart: (...args: unknown[]) => createChart(...(args as [])),
  createSeriesMarkers: () => markers,
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

function stock(ticker: string, name: string): Stock {
  return {
    ticker,
    name,
    category: null,
    market: 'KR',
    currency: 'KRW',
    active: true,
    added_at: '2026-01-01T00:00:00',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    sort_order: 0,
  }
}

const HISTORY: HistoryResponse = {
  ticker: '005930.KS',
  prices: [
    { date: '2026-09-15', close: 76_000 },
    { date: '2026-09-16', close: 76_900 },
  ],
  markers: [],
  coverage: { first_date: '2021-09-16', last_date: '2026-09-16', rows: 1_250 },
}

function renderChart(path = '/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider>
        <HistoryChart />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  createChart.mockClear()
  series.setData.mockClear()
  document.documentElement.setAttribute('data-theme', 'dark')
})

describe('히스토리 차트', () => {
  it('종목을 늦게 불러와도 차트를 만든다', async () => {
    // 처음에는 종목이 없어 안내만 나오고, 목록이 도착한 뒤에야 차트 자리가 생긴다.
    // 이때 차트 생성이 다시 실행되지 않아 화면이 빈 채로 남던 버그가 있었다.
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자')])
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)

    renderChart()
    // 목록을 받기 전에는 "종목이 없습니다"를 띄우지 않는다 — 0개와 아직 못 받음을 가른다(0.45.1 B2)
    expect(screen.queryByText(/차트로 볼 종목이 없습니다/)).toBeNull()

    await waitFor(() => expect(createChart).toHaveBeenCalled())
    await waitFor(() => expect(series.setData).toHaveBeenCalled())
    expect(series.setData.mock.calls[0][0]).toHaveLength(2)
  })

  it('종목 칩에 티커가 아니라 이름을 보여준다', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자')])
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)

    renderChart()
    expect(await screen.findByRole('button', { name: '삼성전자' })).toBeInTheDocument()
  })

  it('종목이 하나도 없으면 안내만 보여준다', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([])
    const history = vi.spyOn(api, 'getHistory')

    renderChart()
    await waitFor(() => expect(screen.getByText(/차트로 볼 종목이 없습니다/)).toBeInTheDocument())
    // 누를 곳 — 리밸런싱·재무와 같은 단추 (0.45.0 D5)
    expect(screen.getByRole('link', { name: '종목 추가하러 가기' })).toHaveAttribute('href', '/stocks')
    expect(history).not.toHaveBeenCalled()
  })
})

describe('주소의 종목 (0.45.1 B2)', () => {
  it('담은 종목에 없는 티커면 영어 오류·빈 범례 대신 한 줄로 말한다', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자')])
    const { ApiError } = await import('../api/client')
    vi.spyOn(api, 'getHistory').mockRejectedValue(new ApiError(404, null, 'stock not found'))

    renderChart('/history?ticker=NOPE')

    expect(await screen.findByText('‘NOPE’ 은 담은 종목에 없습니다 — 위에서 종목을 고르세요.')).toBeInTheDocument()
    expect(screen.queryByText(/stock not found/)).toBeNull()
    expect(screen.queryByText(/매수 0일/)).toBeNull()
    // 고를 칩은 그대로 있다
    expect(screen.getByRole('button', { name: '삼성전자' })).toBeInTheDocument()
  })

  it('목록을 받은 뒤에는 없는 티커의 시세를 부르지 않는다 (기간을 바꿔도)', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자')])
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)

    renderChart('/history?ticker=NOPE')
    await screen.findByText(/담은 종목에 없습니다/)
    const calls = history.mock.calls.length
    screen.getByRole('button', { name: '5년' }).click()
    await waitFor(() => expect(screen.getByText(/담은 종목에 없습니다/)).toBeInTheDocument())
    expect(history.mock.calls.length).toBe(calls)
  })

  it('소문자 주소·비활성 종목은 지금처럼 차트를 연다', async () => {
    const hidden = { ...stock('TSLA', '테슬라'), active: false }
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자'), hidden])
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)

    const { unmount } = renderChart('/history?ticker=005930.ks')
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.ks', '1y'))
    await waitFor(() => expect(series.setData).toHaveBeenCalled())
    expect(screen.queryByText(/담은 종목에 없습니다/)).toBeNull()
    unmount()

    renderChart('/history?ticker=TSLA')
    await waitFor(() => expect(history).toHaveBeenCalledWith('TSLA', '1y'))
    expect(screen.queryByText(/담은 종목에 없습니다/)).toBeNull()
  })
})
