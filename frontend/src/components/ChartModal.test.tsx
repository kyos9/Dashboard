import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api/client'
import type { HistoryResponse } from '../types'
import { AuthGate } from './AuthGate'
import { ChartModal, needsBackfill } from './ChartModal'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'

const series = { setData: vi.fn() }
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
const createChart = vi.fn(() => chart)

const narrow = vi.hoisted(() => ({ value: false }))
vi.mock('../lib/narrow', () => ({ useNarrow: () => narrow.value }))

vi.mock('lightweight-charts', () => ({
  createChart: (...args: unknown[]) => createChart(...(args as [])),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

const HISTORY: HistoryResponse = {
  ticker: '005930.KS',
  prices: [
    { date: '2026-09-15', close: 76_000 },
    { date: '2026-09-16', close: 76_900 },
  ],
  markers: [{ date: '2026-09-16', kind: 'buy' }],
  coverage: { first_date: '2021-09-16', last_date: '2026-09-16', rows: 1_250 },
}

beforeEach(() => {
  vi.restoreAllMocks()
  narrow.value = false
  createChart.mockClear()
  series.setData.mockClear()
})

describe('차트 팝업', () => {
  it('이름이 티커와 같으면 제목에 한 번만 — "VOO VOO" (디자인 2차)', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue({ ...HISTORY, ticker: 'VOO' })
    const { container, unmount } = render(<ChartModal ticker="VOO" name="VOO" onClose={() => {}} />)
    expect(container.querySelector('.modal-title')!.textContent).toBe('VOO')
    unmount()
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)
    expect(screen.getByText('005930.KS')).toBeInTheDocument()
  })

  it('대시보드에서 열면(카드가 오면) 차트 위에 오늘 매수 조건 한 줄, 없으면 그 줄이 없다 (디자인 2차)', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const card = {
      ticker: '005930.KS',
      knee_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: false, adx_trending: null },
    } as never
    const { unmount } = render(<ChartModal ticker="005930.KS" name="삼성전자" card={card} onClose={() => {}} />)
    expect(screen.getByText('매수 조건')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
    expect(screen.getByLabelText('DI 약세 충족')).toBeInTheDocument()
    expect(screen.getByLabelText('ADX > 20 판정 불가')).toBeInTheDocument()
    unmount()
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)
    expect(screen.queryByText('매수 조건')).toBeNull()
  })

  it('매도 조건 (참고) 은 매도(참고) 신호가 켜진 날만 — 회색 칩, 명령하는 말 없음 (0.45.0 C)', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const base = {
      ticker: '005930.KS',
      knee_conditions: { di_bearish: false, disparity_negative: false, volatility_or_volume: true, adx_trending: true },
    }
    const on = { ...base, shoulder_sell_ref: true, sell_conditions: { above_ma50: true, adx_rising: true, volume_strong: true } }
    const { container, unmount } = render(<ChartModal ticker="005930.KS" name="삼성전자" card={on as never} onClose={() => {}} />)
    const row = container.querySelector('.sell-conditions') as HTMLElement
    expect(row.querySelector('.signal-row-label')!.textContent).toBe('매도 조건 (참고) 3/3')
    expect(screen.getByLabelText('MA50 위 충족')).toBeInTheDocument()
    expect(screen.getByLabelText('ADX 상승 충족')).toBeInTheDocument()
    expect(screen.getByLabelText('거래량 받침 충족')).toBeInTheDocument()
    // 충족도 초록(met)이 아니다 — 팔라로 읽히는 색을 쓰지 않는다
    expect(row.querySelectorAll('.cond.met')).toHaveLength(0)
    expect(row.textContent).not.toMatch(/팔|매도하세요|줄이|리뷰 마감일/)
    unmount()

    // 꺼진 날·옛 서버(칸 없음)·날짜가 달라 서버가 null 을 보낸 날은 그 줄이 없다
    for (const card of [
      { ...base, shoulder_sell_ref: false, sell_conditions: { above_ma50: true, adx_rising: true, volume_strong: false } },
      { ...base, shoulder_sell_ref: true },
      { ...base, shoulder_sell_ref: true, sell_conditions: null },
      // 판정 불가가 섞이면(그날 종가를 못 찾았다) 배지와 다른 말("2/3")을 하지 않게 숨긴다 (C 검토)
      { ...base, shoulder_sell_ref: true, sell_conditions: { above_ma50: null, adx_rising: true, volume_strong: true } },
      { ...base, shoulder_sell_ref: true, sell_conditions: {} },
    ]) {
      const view = render(<ChartModal ticker="005930.KS" name="삼성전자" card={card as never} onClose={() => {}} />)
      expect(screen.getByText('매수 조건')).toBeInTheDocument()
      expect(view.container.querySelector('.sell-conditions')).toBeNull()
      view.unmount()
    }
  })

  it('폰에서 매도 조건 줄이 있는 날은 차트를 그만큼 낮게 — 날짜 축이 첫 화면 안에 (0.45.0 C, 360×640)', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const on = { ticker: '005930.KS', knee_conditions: {}, shoulder_sell_ref: true, sell_conditions: { above_ma50: true, adx_rising: true, volume_strong: true } }
    const heights = async (card: unknown, isNarrow: boolean) => {
      narrow.value = isNarrow
      createChart.mockClear()
      const view = render(<ChartModal ticker="005930.KS" name="삼성전자" card={card as never} onClose={() => {}} />)
      await waitFor(() => expect(createChart).toHaveBeenCalled())
      const h = (createChart.mock.calls[0] as unknown as [unknown, { height: number }])[1].height
      view.unmount()
      return h
    }
    // 폰은 차트 위 ◀ ▶ 줄(0.45.2 C2)만큼 더 낮다 — 324, 매도 조건 줄이 있으면 256. PC 는 380 그대로
    expect(await heights(on, true)).toBe(256)
    expect(await heights(on, false)).toBe(380)
    expect(await heights({ ...on, shoulder_sell_ref: false }, true)).toBe(324)
    // 배지만 켜지고 줄이 없는 날(옛 서버·날짜가 다름)은 줄일 까닭이 없다
    expect(await heights({ ...on, sell_conditions: null }, true)).toBe(324)
    expect(await heights({ ...on, sell_conditions: { above_ma50: null, adx_rising: true, volume_strong: true } }, true)).toBe(324)
  })

  it('종목 이름과 차트를 띄운다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: /삼성전자 차트/ })).toBeInTheDocument()
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    await waitFor(() => expect(series.setData).toHaveBeenCalled())
  })

  it('기간을 바꾸면 그 기간으로 다시 불러온다', async () => {
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const user = userEvent.setup()
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', '1y'))
    await user.click(screen.getByRole('button', { name: '전체' }))
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', 'max'))
  })

  it('ESC와 닫기 버튼으로 닫힌다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('시세를 못 불러와도 팝업은 닫히지 않고 이유를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('닫히면 뒤 화면 스크롤을 되돌린다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const { unmount } = render(<ChartModal ticker="VOO" onClose={() => {}} />)

    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('저장 구간 안내', () => {
  it('저장된 시세 구간을 적는다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    expect(await screen.findByText(/저장된 시세 2021-09-16 ~ 2026-09-16/)).toBeInTheDocument()
  })

  it('고른 기간보다 저장된 시세가 짧으면 전체 기간을 다시 받게 한다', async () => {
    // "5년을 눌렀는데 1년만 보인다"는 차트가 아니라 받아둔 데이터의 문제다.
    // 평소 갱신은 최근 2년만 받으므로, 그대로 두면 앞부분은 영영 비어 있다.
    const short: HistoryResponse = {
      ...HISTORY,
      coverage: { first_date: '2025-09-16', last_date: '2026-09-16', rows: 250 },
    }
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(short)
    const refresh = vi.spyOn(api, 'refreshStock').mockResolvedValue({ ticker: 'VOO' })
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: '5년' }))
    await user.click(await screen.findByRole('button', { name: '전체 기간 다시 받기' }))

    // 평소 갱신(2년)이 아니라 전체를 받아야 한다
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('VOO', true))
    // 받은 뒤에는 다시 그려야 한다 (1y 최초 + 5y + 다시받기 후)
    await waitFor(() => expect(history).toHaveBeenCalledTimes(3))
  })

  it('저장된 시세가 고른 기간을 덮으면 다시 받으라고 하지 않는다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" onClose={() => {}} />)

    await screen.findByText(/저장된 시세/)
    expect(screen.queryByRole('button', { name: '전체 기간 다시 받기' })).toBeNull()
  })

  it('사용자에게는 짧다는 사실만 — 전체 기간 다시 받기는 관리자만 한다', async () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.22.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', config_problem: null,
      user: { email: 'b@example.com', name: '비', is_owner: false, status: 'active' },
    })
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      ...HISTORY,
      coverage: { first_date: '2025-09-16', last_date: '2026-09-16', rows: 250 },
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AuthGate>
          <ChartModal ticker="VOO" onClose={() => {}} />
        </AuthGate>
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: '5년' }))
    expect(await screen.findByText(/고른 기간보다 짧습니다 \(앞부분은 관리자가 받을 수 있습니다\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 기간 다시 받기' })).toBeNull()
  })

  it('다시 받다가 실패하면 이유를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      ...HISTORY,
      coverage: { first_date: '2025-09-16', last_date: '2026-09-16', rows: 250 },
    })
    vi.spyOn(api, 'refreshStock').mockRejectedValue(new Error('시세 서버에 연결하지 못했습니다'))
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: '5년' }))
    await user.click(await screen.findByRole('button', { name: '전체 기간 다시 받기' }))

    expect(await screen.findByText(/시세 서버에 연결하지 못했습니다/)).toBeInTheDocument()
  })
})

describe('기간 대비 저장 구간 판정', () => {
  const withCoverage = (first: string | null): HistoryResponse => ({
    ...HISTORY,
    coverage: { first_date: first, last_date: '2026-09-16', rows: first ? 100 : 0 },
  })

  it('1년을 골랐는데 반년치뿐이면 모자란 것이다', () => {
    const halfYear = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
    expect(needsBackfill(withCoverage(halfYear), '1y')).toBe(true)
  })

  it('휴장일 때문에 며칠 비는 것은 모자란 게 아니다', () => {
    const almost = new Date(Date.now() - 362 * 86_400_000).toISOString().slice(0, 10)
    expect(needsBackfill(withCoverage(almost), '1y')).toBe(false)
  })

  it('전체를 고르면 얼마나 더 있는지 알 수 없으므로 언제나 다시 받아볼 수 있다', () => {
    expect(needsBackfill(withCoverage('1990-01-02'), 'max')).toBe(true)
  })

  it('저장된 시세가 아예 없으면 차트가 아니라 등록·갱신의 문제다', () => {
    expect(needsBackfill(withCoverage(null), '5y')).toBe(false)
  })
})

describe('차트 팝업 · 재무 탭', () => {
  it('재무가 있으면 탭이 생기고, 누르면 재무를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const user = userEvent.setup()
    render(<ChartModal ticker="GOOG" name="GOOG" onClose={() => {}} />)

    await user.click(await screen.findByRole('tab', { name: '재무' }))
    expect(screen.getByText('28.1배')).toBeInTheDocument()
    // 재무를 보는 동안 차트 기간 버튼은 뜻이 없다
    expect(screen.queryByRole('button', { name: '전체' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: '차트' }))
    expect(screen.getByRole('button', { name: '전체' })).toBeInTheDocument()
  })

  it('"재무" 화면에서 열면 재무 탭부터', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    render(<ChartModal ticker="GOOG" name="GOOG" initialTab="fundamentals" onClose={() => {}} />)
    expect(await screen.findByText('28.1배')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '재무' })).toHaveAttribute('aria-selected', 'true')
  })

  it('ETF 처럼 재무가 없는 종목은 탭이 없다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const fundamentals = vi.spyOn(api, 'getFundamentals').mockResolvedValue({
      ...FUNDAMENTALS,
      state: 'none',
      metrics: [],
      quarters: [],
      per_range: null,
    })
    render(<ChartModal ticker="VOO" name="VOO" initialTab="fundamentals" onClose={() => {}} />)
    await waitFor(() => expect(fundamentals).toHaveBeenCalledWith('VOO'))
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: '재무' })).toBeNull()
  })

  it('AI 분석 탭 — 키가 없으면 키 넣기부터', async () => {
    localStorage.clear()
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const user = userEvent.setup()
    render(<ChartModal ticker="GOOG" name="GOOG" onClose={() => {}} />)
    await user.click(await screen.findByRole('tab', { name: 'AI 분석' }))
    expect(screen.getByRole('heading', { name: '내 AI 키 넣기' })).toBeInTheDocument()
    // AI 를 보는 동안 차트 기간 버튼은 뜻이 없다
    expect(screen.queryByRole('button', { name: '전체' })).toBeNull()
  })

  it('재무가 없는 종목(ETF)도 AI 분석 탭은 있다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue({ ...FUNDAMENTALS, state: 'none', metrics: [], quarters: [] })
    render(<ChartModal ticker="VOO" name="VOO" onClose={() => {}} />)
    expect(await screen.findByRole('tab', { name: 'AI 분석' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '차트' })).toHaveAttribute('aria-selected', 'true')
  })

  it('AI 분석은 탭 하나 — 관리자는 웹을 찾아보는 종목 분석을 받는다 (9-13)', async () => {
    localStorage.clear()
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const context = vi.spyOn(api, 'aiContext').mockResolvedValue({
      scope: 'research', ticker: 'GOOG', as_of: '2026-09-25', system: '애널리스트', prompt: '[사용자의 포트폴리오',
      search: true,
    })
    const user = userEvent.setup()
    render(<ChartModal ticker="GOOG" name="GOOG" initialTab="ai" onClose={() => {}} />)
    await screen.findByRole('tab', { name: '재무' })
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['차트', '재무', 'AI 분석'])
    expect(screen.getByRole('tab', { name: 'AI 분석' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/알파 버킷 편입 판단을 돕는 리포트/)).toBeInTheDocument()
    expect(screen.getByText(/AI 가 웹에서 찾아 출처와 함께 적습니다/)).toBeInTheDocument()
    await user.click(screen.getByText('AI 에게 보내는 내용 보기'))
    await waitFor(() => expect(context).toHaveBeenCalledWith({ kind: 'research', ticker: 'GOOG' }, ''))
    expect(await screen.findByText(/웹 검색을 켜고 보냅니다/)).toBeInTheDocument()
  })

  it('관리자가 사용자에게 닫아 두면 사용자의 AI 분석은 공용 숫자만 보내는 종목 정리다 (9-15)', async () => {
    localStorage.clear()
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.38.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', config_problem: null,
      user: { email: 'b@example.com', name: '비', is_owner: false, status: 'active', ai_advice: false },
    })
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const context = vi.spyOn(api, 'aiContext').mockResolvedValue({
      scope: 'stock', ticker: 'GOOG', as_of: '2026-09-25', system: '정리', prompt: '[종목]',
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AuthGate>
          <ChartModal ticker="GOOG" name="GOOG" initialTab="ai" onClose={() => {}} />
        </AuthGate>
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: '재무' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['차트', '재무', 'AI 분석'])
    expect(screen.getByRole('tab', { name: 'AI 분석' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/보유수량·비중 같은 내 포트폴리오는 보내지 않습니다/)).toBeInTheDocument()
    await user.click(screen.getByText('AI 에게 보내는 내용 보기'))
    await waitFor(() => expect(context).toHaveBeenCalledWith({ kind: 'stock', ticker: 'GOOG' }, ''))
    expect(screen.queryByText(/웹 검색을 켜고 보냅니다/)).toBeNull()
  })

  it('관리자가 열어 두면 사용자도 웹을 찾아보는 종목 분석을 받는다 (9-15)', async () => {
    localStorage.clear()
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.39.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', config_problem: null,
      user: { email: 'b@example.com', name: '비', is_owner: false, status: 'active', ai_advice: true },
    })
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const context = vi.spyOn(api, 'aiContext').mockResolvedValue({
      scope: 'research', ticker: 'GOOG', as_of: '2026-09-25', system: '애널리스트', prompt: '[사용자의 포트폴리오',
      search: true,
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AuthGate>
          <ChartModal ticker="GOOG" name="GOOG" initialTab="ai" onClose={() => {}} />
        </AuthGate>
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: '재무' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['차트', '재무', 'AI 분석'])
    expect(screen.getByText(/알파 버킷 편입 판단/)).toBeInTheDocument()
    expect(screen.queryByText(/관리자만 씁니다/)).toBeNull()
    await user.click(screen.getByText('AI 에게 보내는 내용 보기'))
    await waitFor(() => expect(context).toHaveBeenCalledWith({ kind: 'research', ticker: 'GOOG' }, ''))
  })

  it('손님(로그인 전)에게는 AI 분석 탭이 없다', async () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.25.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: false, mode: 'google', config_problem: null, user: null,
    })
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    render(
      <MemoryRouter>
        <AuthGate>
          <ChartModal ticker="GOOG" name="GOOG" onClose={() => {}} />
        </AuthGate>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('tab', { name: '재무' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'AI 분석' })).toBeNull()
  })

  it('재무를 못 받아도 차트는 그대로다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockRejectedValue(new Error('offline'))
    render(<ChartModal ticker="GOOG" name="GOOG" onClose={() => {}} />)
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: '재무' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('차트 팝업 · 키보드 (디자인 2차 검토)', () => {
  it('닫으면 포커스가 연 단추로 돌아간다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('Tab 은 팝업 안에서만 돈다 — 마지막에서 처음으로, Shift+Tab 은 처음에서 마지막으로', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const user = userEvent.setup()
    render(
      <>
        <button>뒤 화면 단추</button>
        <ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />
      </>,
    )
    const dialog = screen.getByRole('dialog')
    // 열자마자 포커스가 팝업에 있다
    expect(dialog.contains(document.activeElement)).toBe(true)
    const close = screen.getByRole('button', { name: '닫기' })
    close.focus()
    const seen = new Set<Element | null>()
    for (let i = 0; i < 12; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
      seen.add(document.activeElement)
    }
    // 제자리에 멈춰 있는 것이 아니라 안에서 돈다
    expect(seen.size).toBeGreaterThan(3)
    for (let i = 0; i < 12; i++) {
      await user.tab({ shift: true })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })
})
