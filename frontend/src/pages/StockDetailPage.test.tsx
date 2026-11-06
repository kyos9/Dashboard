import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import { clearCache } from '../lib/cache'
import { dashCard } from '../test/cardFixture'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'
import { cardSignals } from '../lib/portfolio'
import { Sparkline } from '../components/stock/Sparkline'
import { StockDetailPage } from './StockDetailPage'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn() }),
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
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

function Where() {
  const { pathname } = useLocation()
  return <span data-testid="where">{pathname}</span>
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider>
        <Routes>
          <Route path="/stocks/:ticker" element={<StockDetailPage />} />
          <Route path="/stocks" element={<p>종목 목록</p>} />
        </Routes>
        <Where />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  clearCache()
  vi.spyOn(api, 'getHistory').mockResolvedValue({
    ticker: 'VOO',
    prices: [{ date: '2026-09-16', close: 100 }],
    markers: [],
    coverage: { first_date: '2021-09-16', last_date: '2026-09-16', rows: 1250 },
  })
  vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
  vi.spyOn(api, 'listStocks').mockResolvedValue([])
  vi.spyOn(api, 'listHoldings').mockResolvedValue([])
})

describe('종목 안 화면 (/stocks/:ticker — 묶음 3, 목업 11 가)', () => {
  it('머리에 현재가 · 등락 · 신호 배지, 위 탭 넷 — 신호가 있으면 신호 탭이 알린다', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([
      dashCard({ ticker: 'VOO', category: '지수', knee_buy_v2: true }),
      dashCard({ ticker: 'QQQ' }),
    ])
    renderAt('/stocks/VOO')
    expect(await screen.findByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('+1.01%')).toBeInTheDocument()
    expect(document.querySelector('.stock-hero-sub')).toHaveTextContent('미국 · 지수')
    expect(document.querySelector('.stock-hero-badges')).toHaveTextContent('매수')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['차트', '신호 (신호 있음)', '재무', '보유'])
    expect(screen.getByRole('tab', { name: '차트' })).toHaveAttribute('aria-selected', 'true')
  })

  it('신호 탭 — 매수 조건 줄과 비중조절이 같이, 투자 권유가 아니라는 한 줄', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([
      dashCard({ ticker: 'VOO', rebalance_signal: { active: true, reasons: ['비중 미달 (매수 검토)'] } }),
    ])
    const user = userEvent.setup()
    renderAt('/stocks/VOO')
    await screen.findByText('$100.00')
    await user.click(screen.getByRole('tab', { name: /^신호/ }))
    expect(screen.getByText('매수 조건')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '비중조절' })).toBeInTheDocument()
    expect(screen.getByText(/참고용이며 투자 권유가 아닙니다/)).toBeInTheDocument()
  })

  it('옛 주소처럼 ?tab=fundamentals 로 열면 재무부터', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'GOOG' })])
    renderAt('/stocks/GOOG?tab=fundamentals')
    expect(await screen.findByText('28.1배')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '재무' })).toHaveAttribute('aria-selected', 'true')
  })

  it('‹ 는 종목 목록으로 — 바로 열었으면 종목 탭으로 간다', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderAt('/stocks/VOO')
    await screen.findByText('$100.00')
    await user.click(screen.getByRole('button', { name: '종목 목록으로' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/stocks$/))
  })

  it('시세를 아직 못 받은 종목 — 머리에 값이 없고 신호 탭은 안내만, 화면은 깨지지 않는다', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([])
    const user = userEvent.setup()
    renderAt('/stocks/NEW')
    expect(await screen.findByRole('heading', { name: 'NEW' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '신호' }))
    expect(screen.getByText(/시세를 받으면 이 종목의 매수·매도 조건이/)).toBeInTheDocument()
  })
})

describe('종목 탭 · 부품', () => {
  it('카드 하나의 신호 — 매수 · 매도 · 비중 초과/미달, 시세가 오래되면 매수·매도는 빼고 비중은 남긴다', () => {
    const reasons = ['비중 초과 (매도 검토)']
    expect(cardSignals(dashCard({ ticker: 'A', knee_buy_v2: true, shoulder_sell_ref: true })).map((s) => s.kind)).toEqual(['buy', 'sell'])
    expect(cardSignals(dashCard({ ticker: 'A', rebalance_signal: { active: true, reasons } })).map((s) => s.kind)).toEqual(['over'])
    expect(
      cardSignals(dashCard({ ticker: 'A', knee_buy_v2: true, data_stale: true, rebalance_signal: { active: true, reasons } })).map((s) => s.kind),
    ).toEqual(['over'])
    // 옛 서버 — 비중 신호 칸이 없어도 넘어지지 않는다
    expect(cardSignals({ ...dashCard({ ticker: 'A' }), rebalance_signal: undefined } as never)).toEqual([])
  })

  it('스파크라인 — 오르면 up, 내리면 down, 값이 하나뿐이면 빈 칸', () => {
    const { container, rerender } = render(<Sparkline values={[1, 2, 3]} />)
    expect(container.querySelector('svg')).toHaveClass('up')
    rerender(<Sparkline values={[3, 2, 1]} />)
    expect(container.querySelector('svg')).toHaveClass('down')
    rerender(<Sparkline values={[5]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.sparkline-empty')).not.toBeNull()
  })
})
