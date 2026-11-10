import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fragment } from 'react'
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import { clearCache } from '../lib/cache'
import { dashCard } from '../test/cardFixture'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'
import { cardSignals } from '../lib/portfolio'
import { Sparkline } from '../components/stock/Sparkline'
import { StockDetailPage } from './StockDetailPage'
import type { Stock } from '../types'
import { ApiError } from '../api/client'

function stock(ticker: string, name: string | null = null, active = true): Stock {
  return {
    ticker,
    name,
    category: null,
    market: ticker.endsWith('.KS') ? 'KR' : 'US',
    currency: ticker.endsWith('.KS') ? 'KRW' : 'USD',
    active,
    added_at: '2026-01-01T00:00:00',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    sort_order: 0,
  }
}

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

/** 앱처럼 주소가 바뀌면 화면을 새로 만든다(App 의 PageBoundary key={pathname}) */
function Keyed() {
  const { pathname } = useLocation()
  return (
    <Fragment key={pathname}>
      <StockDetailPage />
    </Fragment>
  )
}

function renderAt(path: string) {
  window.history.replaceState(null, '', path)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppStateProvider>
        <Routes>
          <Route path="/stocks/:ticker" element={<Keyed />} />
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
  vi.spyOn(api, 'listStocks').mockResolvedValue([stock('VOO'), stock('QQQ'), stock('GOOG'), stock('NEW')])
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

describe('종목 안 · 사용자 확인 보완 (묶음 3)', () => {
  it('오늘 매수·매도가 아니면 머리에 한 줄 — "매수 조건 n/4"가 사라는 뜻으로 읽히지 않게', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'VOO' })])
    renderAt('/stocks/VOO')
    expect(await screen.findByText(/오늘은 매수·매도 신호가 없습니다/)).toBeInTheDocument()
  })

  it('매수 신호가 뜬 날은 그 한 줄이 없다', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'VOO', knee_buy_v2: true })])
    renderAt('/stocks/VOO')
    await screen.findByText('$100.00')
    expect(screen.queryByText(/오늘은 매수·매도 신호가 없습니다/)).toBeNull()
  })

  it('AI 분석은 머리의 단추 — 첫 화면에 있고, 뒤로가기는 AI 만 닫아 차트로 (사용자 확인 찾지 못한 것 1)', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderAt('/stocks/VOO')
    await screen.findByText('$100.00')
    const ai = screen.getByRole('button', { name: 'AI 분석' })
    expect(ai.closest('.stock-detail-bar')).not.toBeNull()
    await user.click(ai)
    expect(screen.getByRole('region', { name: 'AI 분석' })).toBeInTheDocument()
    expect(ai).toHaveAttribute('aria-pressed', 'true')
    window.history.back()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'AI 분석' })).toBeNull())
    expect(screen.getByRole('tab', { name: '차트' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/stocks/VOO')
  })

  it('AI 를 연 채로 ‹ 를 누르면 한 번에 종목 목록으로 — 실제 브라우저 기록으로, 앱 안에서 들어온 경우 (재검토 조건 3)', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'VOO' })])
    const user = userEvent.setup()
    // MemoryRouter 는 window.history 의 idx 가 없어 늘 "바로 연 주소" 길로 간다 — 고친 줄을 지나가지 않았다(두 번째 재검토)
    window.history.replaceState(null, '', '/stocks')
    render(
      <BrowserRouter>
        <AppStateProvider>
          <Routes>
            <Route path="/stocks/:ticker" element={<Keyed />} />
            <Route path="/stocks" element={<Link to="/stocks/VOO">VOO 열기</Link>} />
          </Routes>
          <Where />
        </AppStateProvider>
      </BrowserRouter>,
    )
    await user.click(await screen.findByRole('link', { name: 'VOO 열기' }))
    await screen.findByText('$100.00')
    const idxIn = window.history.state?.idx
    expect(idxIn).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'AI 분석' }))
    expect(screen.getByRole('region', { name: 'AI 분석' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '종목 목록으로' }))
    await waitFor(() => expect(window.location.pathname).toBe('/stocks'))
    // 목록 칸으로 돌아왔다 — AI 칸·종목 안 칸이 둘 다 빠졌다(앞으로 가는 칸이 아니라 뒤로)
    await waitFor(() => expect(window.history.state?.idx).toBe(idxIn - 1))
    expect(await screen.findByRole('link', { name: 'VOO 열기' })).toBeInTheDocument()
  })

  it('재무 탭에서 여러 종목 재무로 가는 길이 있다 (사용자 확인 찾지 못한 것 2)', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'GOOG' })])
    renderAt('/stocks/GOOG?tab=fundamentals')
    await screen.findByText('28.1배')
    expect(screen.getByRole('link', { name: /여러 종목 재무 한눈에/ })).toHaveAttribute('href', '/fundamentals')
  })

  it('신호 탭의 비중조절 — 지금 · 목표 · 허용 폭 숫자 (목업 11 의 비중 줄)', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: 'VOO' })])
    vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue({
      base_currency: 'KRW',
      rows: [{ ticker: 'VOO', actual_weight_pct: 17.2, target_weight_pct: 18, band_pct: 3 }],
    } as never)
    const user = userEvent.setup()
    renderAt('/stocks/VOO')
    await screen.findByText('$100.00')
    await user.click(screen.getByRole('tab', { name: /^신호/ }))
    expect(await screen.findByText('17.2%')).toBeInTheDocument()
    expect(screen.getByText('(허용 ±3.0%p)')).toBeInTheDocument()
  })
})

describe('주소의 종목 — 옛 차트 화면(0.45.1 B2·BCD)이 하던 일을 종목 안이 잇는다 (묶음 3 검토 조건 1)', () => {
  it('담은 종목에 없는 티커면 영어 오류·빈 범례 대신 한 줄로 말하고, 종목 탭으로 가는 길을 준다', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자')])
    vi.spyOn(api, 'getDashboard').mockResolvedValue([])
    vi.spyOn(api, 'getHistory').mockRejectedValue(new ApiError(404, null, 'stock not found'))
    renderAt('/stocks/NOPE')
    expect(await screen.findByRole('heading', { name: '‘NOPE’은(는) 담은 종목에 없습니다' })).toBeInTheDocument()
    expect(screen.queryByText(/stock not found/)).toBeNull()
    expect(screen.queryByText(/매수 0일/)).toBeNull()
    expect(screen.getByRole('link', { name: '종목 탭으로' })).toHaveAttribute('href', '/stocks')
    // 담을 길이 없는 종목에 AI 분석 단추를 두지 않는다(사용자 확인 막힌 곳 1)
    expect(screen.queryByRole('button', { name: /AI 분석/ })).toBeNull()
  })

  it('없는 티커의 시세는 부르지 않는다 — 목록을 받기 전에도', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자')])
    vi.spyOn(api, 'getDashboard').mockResolvedValue([])
    const history = vi.spyOn(api, 'getHistory')
    renderAt('/stocks/NOPE')
    await screen.findByText(/담은 종목에 없습니다/)
    expect(history).not.toHaveBeenCalled()
  })

  it('종목 목록을 못 받아도 주소의 종목 차트는 전처럼 연다 — 오류 줄과 함께', async () => {
    vi.spyOn(api, 'listStocks').mockRejectedValue(new Error('목록 실패'))
    vi.spyOn(api, 'getDashboard').mockResolvedValue([])
    const history = vi.spyOn(api, 'getHistory')
    renderAt('/stocks/005930.KS')
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', '1y'))
    expect(screen.getByText(/목록 실패/)).toBeInTheDocument()
    expect(screen.queryByText(/담은 종목에 없습니다/)).toBeNull()
  })

  it('소문자·이름 주소는 담은 종목의 티커로 — 시세도 그 티커로 한 번만, 비활성 종목도 연다', async () => {
    vi.spyOn(api, 'listStocks').mockResolvedValue([stock('005930.KS', '삼성전자'), stock('TSLA', '테슬라', false)])
    vi.spyOn(api, 'getDashboard').mockResolvedValue([dashCard({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW' })])
    const history = vi.spyOn(api, 'getHistory')

    const lower = renderAt('/stocks/005930.ks')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/stocks/005930.KS'))
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', '1y'))
    expect(history).not.toHaveBeenCalledWith('005930.ks', '1y')
    expect(history.mock.calls.filter((c) => c[0] === '005930.KS')).toHaveLength(1)
    lower.unmount()

    const byName = renderAt('/stocks/삼성전자')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/stocks/005930.KS'))
    expect(screen.getByRole('heading', { name: '삼성전자' })).toBeInTheDocument()
    byName.unmount()

    renderAt('/stocks/TSLA')
    await waitFor(() => expect(history).toHaveBeenCalledWith('TSLA', '1y'))
    expect(screen.queryByText(/담은 종목에 없습니다/)).toBeNull()
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
