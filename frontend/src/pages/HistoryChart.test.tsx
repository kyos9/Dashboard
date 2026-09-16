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
    dca_amount: 0,
    dca_period: 'monthly',
    rebalance_period: 'quarterly',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    review_date_override: null,
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
}

function renderChart() {
  return render(
    <MemoryRouter>
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
    expect(screen.getByText(/차트로 볼 종목이 없습니다/)).toBeInTheDocument()

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
    expect(history).not.toHaveBeenCalled()
  })
})
