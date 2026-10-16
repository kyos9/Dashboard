import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type {
  DashboardCard,
  LatestIndicators,
  RebalanceCurrent,
  RebalanceRow,
  Stock,
} from '../types'
import { forgetPhone, pretendPhone } from '../test/phone'
import { ApiError } from '../api/client'
import { LEGACY_SIGNAL_RULES, resetSignalRules } from '../lib/signalRules'
import type { SignalRules } from '../types'
import { Dashboard } from './Dashboard'

const INDICATORS: LatestIndicators = {
  date: '2026-09-16',
  close: 0,
  prev_close: null,
  change_pct: null,
  ma5: null,
  ma20: null,
  ma50: null,
  ma200: null,
  stddev20: null,
  vol_ratio: null,
  roc5: null,
  disparity: null,
  plus_di: null,
  minus_di: null,
  adx: null,
}

function card(overrides: Partial<DashboardCard> & { ticker: string }): DashboardCard {
  return {
    name: null,
    category: null,
    market: 'US',
    currency: 'USD',
    data_stale: false,
    price_source: 'yahoo',
    indicators: INDICATORS,
    knee_buy_v2: false,
    knee_conditions: {
      di_bearish: null,
      disparity_negative: null,
      volatility_or_volume: null,
      adx_trending: null,
    },
    shoulder_sell_ref: false,
    last_buy_signal_date: null,
    rebalance_signal: { active: false, reasons: [] },
    ...overrides,
  }
}

function weightRow(overrides: Partial<RebalanceRow> & { ticker: string }): RebalanceRow {
  return {
    name: null,
    currency: 'USD',
    target_weight_pct: 0,
    actual_weight_pct: 0,
    excess_pct: 0,
    band_pct: 5,
    shoulder_signal_fired_in_period: false,
    rebalance_signal: { active: false, reasons: [] },
    quantity: 0,
    avg_cost: null,
    last_close: null,
    current_value: 0,
    current_value_base: 0,
    cost_value: null,
    unrealized_pnl: null,
    return_pct: null,
    ...overrides,
  }
}

const CARDS: DashboardCard[] = [
  card({
    ticker: '005930.KS',
    name: '삼성전자',
    market: 'KR',
    currency: 'KRW',
    category: '지수',
    indicators: { ...INDICATORS, close: 76_937, change_pct: -0.14 },
    last_buy_signal_date: '2026-09-12',
  }),
  card({
    ticker: 'VOO',
    category: '지수',
    indicators: { ...INDICATORS, close: 408.03, change_pct: 1.3 },
  }),
]

const REBALANCE: RebalanceCurrent = {
  base_currency: 'KRW',
  fx: { rates: { USD: { currency: 'USD', krw_rate: 1300, source: 'stored', updated_at: null, is_estimate: false } }, is_estimate: false },
  total_value_base: 2_100_000,
  holdings_value_base: 2_100_000,
  cost_value_base: null,
  unrealized_pnl_base: null,
  cash: { amounts: {}, value_base: 0, target_pct: 0, actual_pct: 0, excess_pct: 0 },
  target_sum_pct: 100,
  review: {
    period: 'quarterly',
    next_date: '2099-12-31',
    due: false,
    override: null,
    last_snapshot_at: null,
  },
  rows: [
    weightRow({
      ticker: '005930.KS',
      currency: 'KRW',
      actual_weight_pct: 38.1,
      current_value: 800_000,
      current_value_base: 800_000,
    }),
    weightRow({
      ticker: 'VOO',
      actual_weight_pct: 61.9,
      current_value: 1_000,
      current_value_base: 1_300_000,
    }),
  ],
}

function stockOf(card: DashboardCard): Stock {
  return {
    ticker: card.ticker,
    name: card.name,
    category: card.category,
    market: card.market,
    currency: card.currency,
    active: true,
    added_at: '2026-01-01T00:00:00',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    sort_order: 0,
  }
}

function mockApi(cards = CARDS, rebalance = REBALANCE) {
  vi.spyOn(api, 'getDashboard').mockResolvedValue(cards)
  vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue(rebalance)
  vi.spyOn(api, 'listStocks').mockResolvedValue(cards.map(stockOf))
  // 홈 위쪽 매크로 한 줄 (components/MacroStrip.tsx) — 기본은 빈 줄로 둔다
  vi.spyOn(api, 'getMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: 'test',
    providers_by_market: { US: [], KR: [], JP: [] },
  })
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AppStateProvider>
        <Dashboard />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

/** 표에 보이는 순서대로의 종목 이름 (국내는 종목명, 해외는 티커) */
async function nameOrder() {
  const table = (await screen.findAllByRole('table'))[0]
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((tr) => tr.querySelector('.stock-name')?.textContent?.trim())
    .filter(Boolean)
}

async function cardRow(label: string) {
  const table = (await screen.findAllByRole('table'))[0]
  const row = within(table)
    .getAllByRole('row')
    .find((tr) => tr.querySelector('.stock-name')?.textContent?.trim() === label)
  if (!row) throw new Error(`${label} 행이 없습니다`)
  return row
}

/** jsdom에는 DataTransfer가 없다 — 끌어다 놓기에 필요한 만큼만 흉내 낸다 */
function fakeDataTransfer() {
  const store: Record<string, string> = {}
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (key: string, value: string) => {
      store[key] = value
    },
    getData: (key: string) => store[key] ?? '',
  }
}

/** 핸들을 잡아 다른 행 위로 끈다 (아직 놓지는 않는다) */
function dragOver(handle: HTMLElement, target: HTMLElement) {
  const dataTransfer = fakeDataTransfer()
  fireEvent.dragStart(handle, { dataTransfer })
  // jsdom에는 레이아웃이 없어 행의 크기가 0이다 — clientX가 0이면 앞, 크면 뒤가 된다
  fireEvent.dragOver(target, { dataTransfer, clientX: 0, clientY: 0 })
  return dataTransfer
}

/** 핸들을 잡아 다른 행 위에 놓는다 */
function dragOnto(handle: HTMLElement, target: HTMLElement) {
  const dataTransfer = dragOver(handle, target)
  fireEvent.drop(target, { dataTransfer })
}

beforeEach(() => {
  vi.restoreAllMocks()
  // 표 보기가 기본이 되도록 넓은 화면을 가정한다
  vi.stubGlobal('innerWidth', 1440)
  // 이 파일은 시그널 보기(예전 대시보드)를 본다 — 포트폴리오 보기는 Dashboard.portfolio.test.tsx
  localStorage.setItem('dashboard.view', 'signal')
})

describe('대시보드 · 통화 구분', () => {
  it('국내 종목은 원화 정수, 해외 종목은 달러 소수 2자리로 보여준다', async () => {
    mockApi()
    renderDashboard()

    const kr = await cardRow('삼성전자')
    expect(within(kr).getByText('₩76,937')).toBeInTheDocument()

    const us = await cardRow('VOO')
    expect(within(us).getByText('$408.03')).toBeInTheDocument()
  })

  it('국내는 종목명, 해외는 티커로 적는다', async () => {
    // 005930.KS는 사람이 읽고 무슨 회사인지 알 수 없고, 해외 종목은 티커가 곧 이름이다
    mockApi()
    renderDashboard()

    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])
    const kr = await cardRow('삼성전자')
    expect(kr.textContent).not.toContain('005930.KS')
  })

  it('종목마다 매수 시그널이 마지막으로 뜬 날을 보여준다', async () => {
    mockApi()
    renderDashboard()

    expect(within(await cardRow('삼성전자')).getByText('2026-09-12')).toBeInTheDocument()
    // 한 번도 안 떴으면 빈칸이 아니라 그렇다고 적는다
    expect(within(await cardRow('VOO')).getByText('저장된 기간에 없음')).toBeInTheDocument()
  })

  it('매수 확인 버튼과 이번 기간 매수 칸은 없다', async () => {
    mockApi()
    renderDashboard()

    await cardRow('VOO')
    expect(screen.queryByRole('button', { name: /매수완료/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/이번 기간/)).not.toBeInTheDocument()
  })
})

describe('대시보드 · 상태 표시', () => {
  it('종목이 없으면 처음 온 사람에게 무엇부터 할지 알려준다', async () => {
    // 첫 로그인은 빈 화면이다 — 빈 표만 두면 무엇을 해야 하는지 모른다 (ROADMAP 4단계 8-2)
    mockApi([], { ...REBALANCE, rows: [], total_value_base: 0 })
    renderDashboard()

    expect(await screen.findByRole('heading', { name: /아직 담은 종목이 없습니다/ })).toBeInTheDocument()
    const steps = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatch(/^종목 담기/)
    expect(screen.getByRole('link', { name: '종목 추가하러 가기' })).toHaveAttribute('href', '/stocks')
    expect(screen.getByText(/30개까지/)).toBeInTheDocument()
  })

  it('시세가 오래된 종목은 판정에서 제외됐다고 알린다', async () => {
    mockApi([card({ ticker: 'VOO', data_stale: true })])
    renderDashboard()

    expect(await screen.findByText(/시세가 오래되어 판정에서 제외/)).toBeInTheDocument()
  })

  it('어느 조건이 걸렸는지 조건별로 보여준다 (개수 요약은 쓰지 않는다)', async () => {
    // "2/4"는 어느 조건이 모자란지 알려주지 않아 판단에 쓸 수 없다
    mockApi([
      card({
        ticker: 'VOO',
        knee_conditions: {
          di_bearish: true,
          disparity_negative: true,
          volatility_or_volume: false,
          adx_trending: null,
        },
      }),
    ])
    renderDashboard()

    const row = await cardRow('VOO')
    expect(within(row).getByLabelText('DI 약세 충족')).toBeInTheDocument()
    expect(within(row).getByLabelText('변동성·거래량 미충족')).toBeInTheDocument()
    expect(row.textContent).not.toMatch(/\d\/4/)
  })
})

describe('대시보드 · 신호 칸은 짧게, 모양으로도 (ROADMAP 8-4)', () => {
  it('신호 칸은 이름표 두 줄 — 시그널(▲ 매수·▼ 매도)과 비중(◆ 비중 미달·초과), 풀이는 설명으로 (0.44.0)', async () => {
    mockApi([
      card({ ticker: 'VOO', knee_buy_v2: true, rebalance_signal: { active: true, reasons: ['밴드 미달(매수 검토)'] } }),
      card({ ticker: 'QQQ', shoulder_sell_ref: true, rebalance_signal: { active: true, reasons: ['밴드 초과(매도 검토)', '정기 리뷰 도래'] } }),
      card({ ticker: 'SCHD', knee_buy_v2: true, shoulder_sell_ref: true }),
      card({ ticker: 'GOOG', knee_buy_v2: true, rebalance_signal: { active: false, reasons: ['밴드 초과(매도 검토)'] } }),
    ])
    renderDashboard()

    // 줄마다 "이름표 | 모양:글자 …"
    const lines = (row: HTMLElement) =>
      [...row.querySelectorAll('.signal-cell-rows .signal-row')].map((line) => {
        const label = line.querySelector('.signal-row-label')?.textContent
        const items = [...line.querySelectorAll('.signal-row-items > *')].map(
          (el) => `${el.querySelector('.signal-shape')?.getAttribute('class')?.split(' ')[1] ?? '-'}:${el.textContent?.trim()}`,
        )
        return `${label} | ${items.join(' ')}`
      })
    const voo = await cardRow('VOO')
    expect(lines(voo)).toEqual(['시그널 | buy:매수', '비중 | rebalance:비중 미달'])
    expect(within(voo).getByText('비중 미달').closest('.badge')).toHaveAttribute('title', expect.stringMatching(/^밴드 미달/))
    expect(within(voo).getByText('매수').closest('.traffic')).toHaveAttribute('title', expect.stringMatching(/^매수 시그널/))

    // 정기 리뷰는 모든 종목에 걸리는 날짜라 모양을 붙이지 않는다
    expect(lines(await cardRow('QQQ'))).toEqual(['시그널 | sell:매도', '비중 | rebalance:비중 초과 -:정기 리뷰'])
    // 둘 다 뜨면 신호등은 매수, 매도 쪽은 ▼ 배지로 남는다. 비중 신호가 없으면 비중 줄도 없다
    expect(lines(await cardRow('SCHD'))).toEqual(['시그널 | buy:매수 sell:매도 조건도'])
    // 사유가 와도 비중 신호가 꺼져 있으면(active=false) 비중 줄을 그리지 않는다
    expect(lines(await cardRow('GOOG'))).toEqual(['시그널 | buy:매수'])
    // 지표 신호와 비중 신호가 같은 말("매수 검토")로 겹치지 않는다
    expect(screen.queryByText('매수 검토')).toBeNull()
    expect(screen.queryByText('매도 검토')).toBeNull()
  })

  it('관망은 흐린 "—" — 상자 없이, 설명과 읽어 주는 말은 "관망" (0.44.0)', async () => {
    mockApi([
      card({ ticker: 'VOO' }),
      card({ ticker: 'QQQ', data_stale: true }),
    ])
    renderDashboard()

    const voo = await cardRow('VOO')
    const watch = voo.querySelector('.signal-cell-rows .traffic-watch') as HTMLElement
    expect(watch.textContent).toBe('—')
    expect(watch).toHaveAttribute('title', '관망 — 매수·매도 조건 미충족')
    expect(within(voo).getByLabelText('관망 — 매수·매도 조건 미충족')).toBe(watch)
    expect(voo.querySelector('.traffic')).toBeNull()
    expect(within(voo).queryByText('관망')).toBeNull()
    // 시세가 없는 종목은 "—" 가 아니라 "갱신 필요" 그대로 — 둘이 같아 보이지 않는다
    const qqq = await cardRow('QQQ')
    expect(within(qqq).getByText('갱신 필요').closest('.traffic')).not.toBeNull()
    expect(qqq.querySelector('.traffic-watch')).toBeNull()
    // 수는 그대로 센다 — 신호 요약의 관망 칸
    const watchChip = document.querySelector('.count-chip.amber') as HTMLElement
    expect(watchChip.textContent).toBe('1관망')
  })

  it('맨 위 요약도 같은 모양 — 매수 ▲ · 매도 ▼ · 비중조절 ◆ (보라, 파랑이 아니다)', async () => {
    mockApi([
      card({ ticker: 'VOO', knee_buy_v2: true, rebalance_signal: { active: true, reasons: ['밴드 미달(매수 검토)'] } }),
      card({ ticker: 'QQQ', rebalance_signal: { active: true, reasons: ['밴드 초과(매도 검토)'] } }),
    ])
    renderDashboard()
    await cardRow('VOO')
    const review = screen.getByText(/^비중 미달 1$/).closest('.badge')!
    expect(review).toHaveClass('badge-purple')
    expect(review.querySelector('.signal-shape.rebalance')).not.toBeNull()
    expect(screen.getByText(/^비중 초과 1$/).closest('.badge')).toHaveClass('badge-purple')
    expect(document.querySelector('.count-chip.green .signal-shape.buy')).not.toBeNull()
    expect(document.querySelector('.count-chip.red .signal-shape.sell')).not.toBeNull()
  })
})

describe('대시보드 · 조건 표시', () => {
  it('조건은 그 조건이 나온 지표 칸에 붙는다', async () => {
    // "DI 약세"가 어느 숫자에서 나온 말인지 눈으로 이어지게 하는 것이 요점이다
    mockApi([
      card({
        ticker: 'VOO',
        indicators: { ...INDICATORS, close: 100, plus_di: 24.6, minus_di: 28.3, adx: 9 },
        knee_conditions: {
          di_bearish: true,
          disparity_negative: true,
          volatility_or_volume: false,
          adx_trending: false,
        },
      }),
    ])
    renderDashboard()

    const row = await cardRow('VOO')
    const cells = within(row).getAllByRole('cell')
    // 순서 / 종목 / 현재가 / 이격도 / ADX / DI / 거래량비 / 200일선 / 신호등 / 매수
    expect(within(cells[4]).getByLabelText(/^ADX > 20/)).toBeInTheDocument()
    expect(within(cells[5]).getByLabelText(/^DI 약세/)).toBeInTheDocument()
    expect(within(cells[6]).getByLabelText(/^변동성·거래량/)).toBeInTheDocument()
    // 종합 신호등 칸에는 더 이상 조건을 늘어놓지 않는다
    expect(within(cells[8]).queryByLabelText(/DI 약세/)).toBeNull()
  })

  it('조건이 무엇인지는 열 머리글에 한 번만 적는다', async () => {
    // 행마다 "이격도 < 0"을 반복하면 다섯 종목에 화면이 다 찬다.
    // 조건은 그 열의 성질이지 행마다 달라지는 값이 아니다.
    mockApi()
    renderDashboard()

    const table = (await screen.findAllByRole('table'))[0]
    const headers = within(table).getAllByRole('columnheader')
    expect(headers[3].textContent).toContain('매수 조건 < 0')
    expect(headers[5].textContent).toContain('매수 조건 -DI > +DI')

    // 값 칸에는 기호만 남는다
    const row = await cardRow('VOO')
    expect(within(row).getAllByRole('cell')[3].textContent).not.toContain('이격도')
  })

  it('충족과 미충족을 기호로 구분한다', async () => {
    mockApi([
      card({
        ticker: 'VOO',
        knee_conditions: {
          di_bearish: true,
          disparity_negative: false,
          volatility_or_volume: null,
          adx_trending: true,
        },
      }),
    ])
    renderDashboard()

    const row = await cardRow('VOO')
    expect(within(row).getByLabelText('DI 약세 충족')).toHaveTextContent('✓')
    expect(within(row).getByLabelText('이격도 < 0 미충족')).toHaveTextContent('·')
    // 판정 불가는 미충족과 다르다 (데이터가 모자란 것이지 조건이 틀린 게 아니다)
    expect(within(row).getByLabelText('변동성·거래량 판정 불가')).toHaveTextContent('?')
  })
})

describe('대시보드 · 차트 열기', () => {
  it('종목 이름을 누르면 차트가 뜬다', async () => {
    mockApi()
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue({
      ticker: '005930.KS',
      prices: [],
      markers: [],
      coverage: { first_date: null, last_date: null, rows: 0 },
    })
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: '삼성전자' }))

    expect(await screen.findByRole('dialog', { name: /삼성전자 차트/ })).toBeInTheDocument()
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', '1y'))
  })

  it('맨 오른쪽 "AI 분석"을 누르면 팝업이 AI 탭으로 열린다 — 누르는 것만으로 부르지는 않는다', async () => {
    mockApi()
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      ticker: '005930.KS', prices: [], markers: [],
      coverage: { first_date: null, last_date: null, rows: 0 },
    })
    vi.spyOn(api, 'getFundamentals').mockRejectedValue(new Error('none'))
    const analyze = vi.spyOn(api, 'aiAnalyzeStream')
    const user = userEvent.setup()
    renderDashboard()

    // 표의 마지막 칸
    const headers = (await screen.findAllByRole('columnheader')).map((h) => h.textContent)
    expect(headers[headers.length - 1]).toBe('AI 분석')
    await user.click(screen.getByRole('button', { name: '삼성전자 AI 분석' }))

    const dialog = await screen.findByRole('dialog', { name: /삼성전자 차트/ })
    expect(within(dialog).getByRole('tab', { name: 'AI 분석' })).toHaveAttribute('aria-selected', 'true')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('"AI 전체 정리"는 창만 연다 — 보유는 보내지 않는다고 적고, 부르는 것은 창에서 한 번 더', async () => {
    mockApi()
    const analyze = vi.spyOn(api, 'aiAnalyzeStream')
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '✦ AI 전체 정리' }))
    const dialog = await screen.findByRole('dialog', { name: 'AI 전체 정리' })
    expect(within(dialog).getByText(/보유수량·비중·평단가는 보내지 않습니다/)).toBeInTheDocument()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('카드 보기에도 "AI 분석" 버튼이 있다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '카드 보기' }))
    expect(await screen.findByRole('button', { name: '삼성전자 AI 분석' })).toBeInTheDocument()
  })
})

describe('대시보드 · 종목 순서', () => {
  it('끌어다 놓으면 그 자리로 옮겨지고 저장된다', async () => {
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue([])
    renderDashboard()

    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])

    const handle = screen.getByRole('button', { name: 'VOO 순서 바꾸기' })
    dragOnto(handle, await cardRow('삼성전자'))

    // 응답을 기다리지 않고 바로 바뀌어 보여야 한다
    expect(await nameOrder()).toEqual(['VOO', '삼성전자'])
    await waitFor(() => expect(save).toHaveBeenCalledWith(['VOO', '005930.KS']))
  })

  it('키보드 화살표로도 옮길 수 있다', async () => {
    // 끌어다 놓기만 되면 키보드를 쓰는 사람은 순서를 바꿀 방법이 없다
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue([])
    const user = userEvent.setup()
    renderDashboard()

    const handle = await screen.findByRole('button', { name: 'VOO 순서 바꾸기' })
    handle.focus()
    await user.keyboard('{ArrowUp}')

    expect(await nameOrder()).toEqual(['VOO', '삼성전자'])
    await waitFor(() => expect(save).toHaveBeenCalledWith(['VOO', '005930.KS']))
  })

  it('맨 위에서 더 올려도 아무 일도 일어나지 않는다', async () => {
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue([])
    const user = userEvent.setup()
    renderDashboard()

    const handle = await screen.findByRole('button', { name: '삼성전자 순서 바꾸기' })
    handle.focus()
    await user.keyboard('{ArrowUp}')

    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])
    expect(save).not.toHaveBeenCalled()
  })

  it('끄는 동안 자리가 미리 벌어진다 — 놓기 전에 어디로 갈지 보인다', async () => {
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue([])
    renderDashboard()

    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])
    dragOver(screen.getByRole('button', { name: 'VOO 순서 바꾸기' }), await cardRow('삼성전자'))

    expect(await nameOrder()).toEqual(['VOO', '삼성전자'])
    // 아직 손을 놓지 않았다 — 저장할 순서가 아니다
    expect(save).not.toHaveBeenCalled()
  })

  it('끌다 말면 원래 순서로 돌아온다', async () => {
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue([])
    renderDashboard()

    const handle = await screen.findByRole('button', { name: 'VOO 순서 바꾸기' })
    dragOver(handle, await cardRow('삼성전자'))
    expect(await nameOrder()).toEqual(['VOO', '삼성전자'])

    fireEvent.dragEnd(handle)

    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])
    expect(save).not.toHaveBeenCalled()
  })

  it('저장에 실패하면 순서를 되돌리고 이유를 보여준다', async () => {
    mockApi()
    vi.spyOn(api, 'updateStockOrder').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    renderDashboard()

    await cardRow('VOO')
    dragOnto(screen.getByRole('button', { name: 'VOO 순서 바꾸기' }), await cardRow('삼성전자'))

    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])
  })
})

describe('대시보드 · 설정 모드', () => {
  async function openSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /설정/ }))
  }

  it('보던 표가 그 자리에서 입력칸으로 바뀐다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    // 종목은 그대로 있고, 값만 고칠 수 있게 된다
    expect(await nameOrder()).toEqual(['삼성전자', 'VOO'])
    expect(screen.getByLabelText('삼성전자 목표 비중')).toBeInTheDocument()
    expect(screen.getByLabelText('VOO 밴드 임계값')).toBeInTheDocument()
    // 적립 금액·주기, 종목별 리뷰일은 없어졌다
    expect(screen.queryByLabelText('VOO DCA 금액')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('VOO 리뷰 마감일')).not.toBeInTheDocument()
  })

  it('고친 종목만 저장한다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateStock').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    await user.type(screen.getByLabelText('삼성전자 목표 비중'), '35')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('005930.KS', expect.objectContaining({ target_weight_pct: 35 }))
  })

  it('고친 값이 없으면 저장할 것도 없다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('되돌리기를 누르면 고치던 값이 원래대로 돌아간다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateStock').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    await user.type(screen.getByLabelText('VOO 목표 비중'), '5')
    await user.click(screen.getByRole('button', { name: '되돌리기' }))

    expect(screen.getByLabelText('VOO 목표 비중')).toHaveValue('0')
    expect(update).not.toHaveBeenCalled()
  })

  it('삭제는 한 번 더 확인을 받는다 — 내 목록에서만 빼고 시세는 남긴다고 알린다', async () => {
    mockApi()
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    const row = await cardRow('VOO')
    await user.click(within(row).getByRole('button', { name: '삭제' }))

    // 아직 지우면 안 된다 — 되돌릴 수 없는 동작이다
    expect(purge).not.toHaveBeenCalled()
    // 확인은 표 아래가 아니라 화면 위에 떠야 한다 (종목이 많으면 표 아래는 안 보인다)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/되돌릴 수 없습니다/)).toBeInTheDocument()
    // 시세는 공용이라 남는다 — "처음부터 새로 받아야 한다"는 더 이상 사실이 아니다
    expect(within(dialog).getByText(/시세·지표는 모두가 같이 쓰는 기록이라 남겨/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/처음부터 새로/)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: '네, 지웁니다' }))
    await waitFor(() => expect(purge).toHaveBeenCalledWith('VOO'))
  })

  it('감추기는 확인 없이 바로 내린다 (되돌릴 수 있는 동작이다)', async () => {
    mockApi()
    const hide = vi.spyOn(api, 'deactivateStock').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    const row = await cardRow('VOO')
    await user.click(within(row).getByRole('button', { name: '감추기' }))

    await waitFor(() => expect(hide).toHaveBeenCalledWith('VOO'))
  })
})

describe('방금 등록한 종목의 시세를 받는 동안', () => {
  it('받는 중이라고 알리고, 다 받으면 전체를 다시 그린다', async () => {
    const loading = card({ ticker: 'TSM', data_status: 'loading' })
    mockApi([loading])
    const getDashboard = vi
      .spyOn(api, 'getDashboard')
      .mockResolvedValueOnce([loading]) // 처음
      .mockResolvedValue([card({ ticker: 'TSM' })]) // 다시 물었을 때 — 다 받음
    renderDashboard()

    expect(await screen.findByText(/TSM 시세를 받는 중입니다/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/시세를 받는 중입니다/)).not.toBeInTheDocument(), {
      timeout: 6000,
    })
    // 한 번은 다시 물었고(4초 뒤), 다 받았으니 전체를 새로 받았다
    expect(getDashboard.mock.calls.length).toBeGreaterThanOrEqual(3)
  }, 10000)
})

describe('대시보드 · 탭을 옮겨 와도 (ROADMAP 8-1)', () => {
  it('다시 열면 새 응답을 기다리지 않고 들고 있던 표를 바로 그린다', async () => {
    mockApi()
    const first = renderDashboard()
    await screen.findByRole('button', { name: '삼성전자' })
    first.unmount()

    // 이번에는 서버가 한참 걸린다
    vi.spyOn(api, 'getDashboard').mockReturnValue(new Promise(() => {}))
    renderDashboard()
    expect(screen.getByRole('button', { name: '삼성전자' })).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()
  })

  it('처음 열 때는 표 모양의 자리표시를 보여준다', () => {
    mockApi()
    vi.spyOn(api, 'getDashboard').mockReturnValue(new Promise(() => {}))
    renderDashboard()
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
  })

  it('종목을 지운 뒤 다시 열면 지우기 전 표를 보이지 않는다', async () => {
    mockApi()
    const first = renderDashboard()
    await screen.findByRole('button', { name: '삼성전자' })
    first.unmount()

    // 다른 탭에서 지웠다 — 쓰기 요청이 캐시를 비운다 (api/client.ts)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))
    await api.purgeStock('005930.KS')

    vi.spyOn(api, 'getDashboard').mockReturnValue(new Promise(() => {}))
    renderDashboard()
    expect(screen.queryByRole('button', { name: '삼성전자' })).not.toBeInTheDocument()
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument()
  })

  it('차트 코드를 받는 동안에도 누르자마자 팝업 틀이 뜬다', async () => {
    mockApi()
    vi.spyOn(api, 'getHistory').mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderDashboard()
    await user.click(await screen.findByRole('button', { name: '삼성전자' }))
    // 틀이든 진짜 팝업이든 — 누른 즉시 대화상자가 있다
    expect(screen.getByRole('dialog', { name: /삼성전자/ })).toBeInTheDocument()
  })
})

describe('폰의 순서 편집 (ROADMAP 8-3)', () => {
  beforeEach(() => {
    pretendPhone()
  })
  afterEach(() => forgetPhone())

  it('끄는 손잡이 대신 "순서 편집"을 켜면 44px ▲▼ 로 옮긴다', async () => {
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue(undefined as never)
    renderDashboard()

    await screen.findAllByRole('button', { name: /AI 분석/ })
    // 폰에서는 끄는 손잡이가 없다 — 손가락으로는 끌기가 시작되지 않는다
    expect(screen.queryByRole('button', { name: /순서 바꾸기/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /위로|아래로/ })).not.toBeInTheDocument()

    // 폰은 보기·설정 단추를 접어 둔다 (디자인 2차) — 펴야 "순서 편집"이 보인다
    expect(screen.queryByRole('button', { name: '↕ 순서 편집' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '보기·설정 ▾' }))
    await userEvent.click(screen.getByRole('button', { name: '↕ 순서 편집' }))
    // 편집 중에는 접어도 끝내는 단추가 남는다
    await userEvent.click(screen.getByRole('button', { name: '보기·설정 ▴' }))
    expect(screen.getByRole('button', { name: '순서 편집 끝' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '삼성전자 위로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'VOO 아래로' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '삼성전자 아래로' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(['VOO', '005930.KS']))

    await userEvent.click(screen.getByRole('button', { name: '순서 편집 끝' }))
    expect(screen.queryByRole('button', { name: /위로|아래로/ })).not.toBeInTheDocument()
  })
})

describe('대시보드 · 시그널 규칙은 서버에서 (0.41.0)', () => {
  beforeEach(() => resetSignalRules())
  afterEach(() => resetSignalRules())

  /** 0.40.0 화면이 적어 두던 글 — 옛 서버든 새 서버든 정의가 같으면 글자까지 같아야 한다 */
  const OLD_SENTENCE =
    '매수 시그널 = 이격도 < 0 · ADX > 20 · DI 약세(-DI > +DI) · 변동성·거래량(StdDev20 축소 또는 거래량비 > 1.1) — 네 조건을 모두 만족할 때.'
  const OLD_HEADERS = ['-DI > +DI', '< 0', '변동성↓ 또는 >1.1', '> 20']

  async function expectOldScreen() {
    const table = (await screen.findAllByRole('table'))[0]
    const headers = [...table.querySelectorAll('th .th-cond.nowrap')].map((el) =>
      el.textContent?.replace('매수 조건 ', '').trim(),
    )
    expect(headers).toEqual(expect.arrayContaining(OLD_HEADERS))
    expect(screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.startsWith(OLD_SENTENCE))).toBeInTheDocument()
    const row = await cardRow('VOO')
    expect(within(row).getByLabelText('DI 약세 충족')).toBeInTheDocument()
    expect(within(row).getByLabelText('ADX > 20 미충족')).toBeInTheDocument()
  }

  const OLD_SHAPE = card({
    ticker: 'VOO',
    knee_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: true, adx_trending: false },
  })

  it('옛 서버 — 규칙 API 가 404 이고 카드에 새 필드가 없어도 0.40.0 화면 그대로', async () => {
    mockApi([OLD_SHAPE])
    const rules = vi.spyOn(api, 'getSignalRules').mockRejectedValue(new ApiError(404, null, 'Not Found', null))
    renderDashboard()
    await expectOldScreen()
    expect(rules).toHaveBeenCalled()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('새 서버 — 같은 정의면 같은 화면이고, 판정은 buy_conditions 를 읽는다', async () => {
    mockApi([
      {
        ...OLD_SHAPE,
        // 새 필드가 옛 필드보다 먼저다 (조건 수가 바뀌면 옛 필드는 네 칸에 갇힌다)
        knee_conditions: { di_bearish: false, disparity_negative: false, volatility_or_volume: false, adx_trending: true },
        buy_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: true, adx_trending: false },
        signal_rules_version: LEGACY_SIGNAL_RULES.version,
      },
    ])
    vi.spyOn(api, 'getSignalRules').mockResolvedValue({ ...LEGACY_SIGNAL_RULES, change_notice: null })
    renderDashboard()
    await expectOldScreen()
  })

  it('정의가 바뀌면 열 머리·칩·설명 줄·풀이가 함께 바뀌고, 신호 요약에 바뀐 날이 뜬다', async () => {
    const changed: SignalRules = JSON.parse(JSON.stringify(LEGACY_SIGNAL_RULES))
    changed.version = 'changed'
    changed.thresholds.adx_trend = 25
    const adx = changed.rules[0].conditions.find((c) => c.key === 'adx_trending')!
    Object.assign(adx, { label: 'ADX > 25', header: '> 25', formula: 'ADX > 25' })
    // 붙일 칸이 없는 조건이 늘어도 화면이 깨지지 않는다 — 설명 줄, 그리고 표의 "그 밖의 조건" 칸(디자인 2차, 예전에는 표에서 사라졌다)
    changed.rules[0].conditions.push({
      key: 'rsi_low', metric: 'rsi', label: 'RSI < 30', detail: 'RSI 가 30 아래', header: '< 30', formula: 'RSI < 30',
    })
    changed.change_notice = '시그널 계산 방식이 2026-11-02에 바뀌었습니다'
    mockApi([
      card({
        ticker: 'VOO',
        knee_buy_v2: true,
        indicators: { ...INDICATORS, adx: 22 },
        knee_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: true, adx_trending: true },
        buy_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: true, adx_trending: true, rsi_low: true },
        signal_rules_version: 'changed',
      }),
    ])
    vi.spyOn(api, 'getSignalRules').mockResolvedValue(changed)
    renderDashboard()

    expect(await screen.findByRole('note')).toHaveTextContent('시그널 계산 방식이 2026-11-02에 바뀌었습니다')
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.includes('이격도 < 0 · ADX > 25 · DI 약세(-DI > +DI) · 변동성·거래량(StdDev20 축소 또는 거래량비 > 1.1) · RSI < 30 — 다섯 조건을 모두 만족할 때.')),
    ).toBeInTheDocument()
    const row = await cardRow('VOO')
    expect(within(row).getByLabelText('ADX > 25 충족')).toBeInTheDocument()
    expect(within(row).getByLabelText('RSI < 30 충족')).toBeInTheDocument()
    // 그 칸은 200일선 뒤, 종합 신호등 앞 — 지표 칸이 없는 조건이 있을 때만
    const heads = within((await screen.findAllByRole('table'))[0])
      .getAllByRole('columnheader')
      .map((th) => th.textContent ?? '')
    const extra = heads.findIndex((h) => h.startsWith('그 밖의 조건'))
    expect(heads[extra - 1]).toMatch(/^200일선/)
    expect(heads[extra + 1]).toBe('신호')
    // ADX 22 는 새 기준(25) 아래 — 풀이도 같은 기준으로 "추세 없음"
    expect(within(row).getByText('22.0').closest('[title]')).toHaveAttribute('title', '추세 없음')
    expect(within(row).getByText('매수').closest('.traffic')).toHaveAttribute(
      'title',
      expect.stringMatching(/매수 조건 5개를 모두/),
    )
  })

  it('카드가 다른 판을 말하면 규칙을 다시 받는다 (며칠 떠 있는 앱)', async () => {
    mockApi([{ ...OLD_SHAPE, signal_rules_version: 'next' }])
    const rules = vi
      .spyOn(api, 'getSignalRules')
      .mockResolvedValueOnce(LEGACY_SIGNAL_RULES)
      .mockResolvedValue({ ...LEGACY_SIGNAL_RULES, version: 'next' })
    renderDashboard()
    await waitFor(() => expect(rules).toHaveBeenCalledTimes(2))
  })
})

describe('대시보드 · 시그널 기준 내 설정 (0.42.0)', () => {
  beforeEach(() => resetSignalRules())
  afterEach(() => resetSignalRules())

  const DEFAULTS = { adx_trend: 20, vol_ratio_expand: 1.1, disparity_below: 0, lookback_days: 5 }
  const LIMITS = {
    adx_trend: { min: 10, max: 40, step: 0.5 },
    vol_ratio_expand: { min: 0.5, max: 3, step: 0.05 },
    disparity_below: { min: -20, max: 0, step: 0.5 },
    lookback_days: { min: 1, max: 20, step: 1 },
  }
  function rulesOf(custom: boolean, version = custom ? 'mine' : LEGACY_SIGNAL_RULES.version): SignalRules {
    return {
      ...LEGACY_SIGNAL_RULES,
      version,
      thresholds: custom ? { ...DEFAULTS, adx_trend: 15 } : DEFAULTS,
      defaults: DEFAULTS,
      custom,
      limits: LIMITS,
      change_notice: null,
    }
  }

  it('0.41.0 서버(custom 없음)·0.40.0 서버(404)에는 "시그널 기준" 버튼이 없다', async () => {
    mockApi()
    vi.spyOn(api, 'getSignalRules').mockResolvedValue({ ...LEGACY_SIGNAL_RULES, change_notice: null })
    const { unmount } = renderDashboard()
    await screen.findByText('⚙ 종목 설정')
    await waitFor(() => expect(api.getSignalRules).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /시그널 기준/ })).toBeNull()
    unmount()

    resetSignalRules()
    vi.spyOn(api, 'getSignalRules').mockRejectedValue(new ApiError(404, null, 'Not Found', null))
    renderDashboard()
    await screen.findByText('⚙ 종목 설정')
    expect(screen.queryByRole('button', { name: /시그널 기준/ })).toBeNull()
  })

  it('기본 기준인 사람은 버튼만 더해지고 "내 기준" 줄·표시는 없다', async () => {
    mockApi()
    vi.spyOn(api, 'getSignalRules').mockResolvedValue(rulesOf(false))
    renderDashboard()
    expect(await screen.findByRole('button', { name: '시그널 기준' })).toBeInTheDocument()
    expect(screen.queryByText(/내 기준/)).toBeNull()
  })

  it('내 기준인 사람에게는 신호 요약에 "내 기준 · 오늘 매수 N개 (기본 기준이면 M개)"와 설명 줄 앞 "내 기준"', async () => {
    mockApi([
      card({ ticker: 'VOO', knee_buy_v2: true, knee_buy_v2_default: false, signal_rules_version: 'mine' }),
      card({ ticker: 'QQQ', knee_buy_v2: true, knee_buy_v2_default: true, signal_rules_version: 'mine' }),
    ])
    vi.spyOn(api, 'getSignalRules').mockResolvedValue(rulesOf(true))
    renderDashboard()
    const note = await screen.findByText((_, el) => !!el?.classList.contains('mine-note'))
    expect(note).toHaveTextContent('내 기준으로 본 판정 · 오늘 매수 2개 (기본 기준이면 1개)')
    // 어느 종목이 달라졌는지도 (0.42.0 사용자 확인)
    expect(note).toHaveTextContent('다른 종목: VOO')
    expect(screen.getByRole('button', { name: '시그널 기준 · 내 기준' })).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.startsWith('내 기준: 매수 시그널 ='))).toBeInTheDocument()
  })

  it('내 기준과 기본 기준의 매수 수가 같으면 그렇다고 말한다 ("4개 (기본 기준이면 4개)"가 아니게)', async () => {
    mockApi([card({ ticker: 'VOO', knee_buy_v2: true, knee_buy_v2_default: true, signal_rules_version: 'mine' })])
    vi.spyOn(api, 'getSignalRules').mockResolvedValue(rulesOf(true))
    renderDashboard()
    const note = await screen.findByText((_, el) => !!el?.classList.contains('mine-note'))
    expect(note).toHaveTextContent('오늘 매수 1개 — 기본 기준과 같습니다')
  })

  it('저장하면 돌려받은 규칙으로 바로 바꾸고 화면을 다시 받는다', async () => {
    mockApi()
    vi.spyOn(api, 'getSignalRules').mockResolvedValue(rulesOf(false))
    const put = vi.spyOn(api, 'putSignalThresholds').mockResolvedValue(rulesOf(true))
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: '시그널 기준' }))
    const dialog = await screen.findByRole('dialog', { name: '시그널 기준' })
    const adx = within(dialog).getByLabelText('ADX 기준')
    await userEvent.clear(adx)
    await userEvent.type(adx, '15')
    const before = (api.getDashboard as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(put).toHaveBeenCalledWith({ ...DEFAULTS, adx_trend: 15 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: '시그널 기준 · 내 기준' })).toBeInTheDocument()
    // 비교 기간만 바꾸면 숫자가 그대로일 수 있다 — 저장했다는 한 줄
    expect(screen.getByRole('status')).toHaveTextContent('시그널 기준을 저장했습니다')
    await waitFor(() =>
      expect((api.getDashboard as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(before),
    )
  })
})

describe('대시보드 · 0종목 안내 (0.42.0 B4)', () => {
  it('없는 "위의 시그널" 버튼을 가리키지 않고, 종목을 담으면 생기는 단추라고 말한다', async () => {
    mockApi([])
    renderDashboard()
    const guide = await screen.findByText(/세 단계면 시작합니다/)
    const box = guide.closest('.first-steps')!
    expect(box).not.toHaveTextContent('위의 "시그널"')
    expect(box).toHaveTextContent('종목을 담으면')
    expect(box).toHaveTextContent('포트폴리오 / 시그널')
    // 0종목 화면에는 그 단추가 실제로 없다 — 안내가 거짓말을 하지 않는지
    expect(screen.queryByRole('group', { name: '대시보드 보기' })).toBeNull()
  })
})

describe('대시보드 · 카드 보기의 부호 색 (0.42.0 B)', () => {
  it('DI 와 200일선 숫자는 표의 칩처럼 오르내림 색 — 오르면 up, 내리면 down', async () => {
    mockApi([
      card({ ticker: 'VOO', indicators: { ...INDICATORS, close: 110, ma200: 100, plus_di: 30, minus_di: 20 } }),
      card({ ticker: 'SCHD', indicators: { ...INDICATORS, close: 90, ma200: 100, plus_di: 15, minus_di: 25 } }),
    ])
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: '카드 보기' }))

    const value = (label: string) =>
      screen.getAllByText(label).map((k) => k.closest('.stat-box')!.querySelector('.v')!)
    const [vooDi, schdDi] = value('DI 방향 (+DI / -DI)')
    const [vooMa, schdMa] = value('200일선 대비')
    expect(vooDi).toHaveClass('up')
    expect(schdDi).toHaveClass('down')
    expect(vooMa).toHaveClass('up')
    expect(schdMa).toHaveClass('down')
  })
})

describe('대시보드 · 시그널 보기 정돈 (디자인 2차)', () => {
  const SELLING = card({ ticker: 'VOO', shoulder_sell_ref: true })
  const BUYING = card({ ticker: 'QQQ', knee_buy_v2: true })
  const WATCHING = card({
    ticker: 'SCHD',
    rebalance_signal: { active: true, reasons: ['밴드 미달(매수 검토)'] },
  })

  it('매도 거르기 — 신호 요약의 "매도" 수와 같은 종목만', async () => {
    mockApi([SELLING, BUYING, WATCHING])
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: /매도 1$/ }))
    expect(await nameOrder()).toEqual(['VOO'])
  })

  it('신호 요약의 매수·매도·비중조절 칸을 누르면 그 거르기, 다시 누르면 모두 보기', async () => {
    mockApi([SELLING, BUYING, WATCHING])
    renderDashboard()
    const summary = await screen.findByRole('region', { name: '신호 요약' })
    const sell = within(summary).getByRole('button', { name: /매도/ })
    await userEvent.click(sell)
    expect(sell).toHaveAttribute('aria-pressed', 'true')
    expect(await nameOrder()).toEqual(['VOO'])
    await userEvent.click(within(summary).getByRole('button', { name: /비중조절/ }))
    expect(await nameOrder()).toEqual(['SCHD'])
    await userEvent.click(within(summary).getByRole('button', { name: /비중조절/ }))
    expect(await nameOrder()).toEqual(['VOO', 'QQQ', 'SCHD'])
    // 관망은 거르기가 없어 누르는 칸이 아니다
    expect(within(summary).queryByRole('button', { name: /관망/ })).toBeNull()
  })

  it('카드: 시그널 · 비중 · 매수 조건 줄 — 비중은 사유가 있을 때만, 조건은 규칙의 조건 전부와 맞춘 수', async () => {
    mockApi([
      card({
        ticker: 'VOO',
        shoulder_sell_ref: true,
        rebalance_signal: { active: true, reasons: ['밴드 미달(매수 검토)'] },
        knee_conditions: { di_bearish: false, disparity_negative: false, volatility_or_volume: false, adx_trending: true },
      }),
      card({ ticker: 'QQQ' }),
    ])
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: '카드 보기' }))
    const [voo, qqq] = Array.from(document.querySelectorAll('article.signal-card')) as HTMLElement[]
    const rows = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('.signal-row-label')).map((l) => l.textContent?.replace(/\s+/g, ' ').trim())
    expect(rows(voo)).toEqual(['시그널', '비중', '매수 조건 1/4'])
    expect(rows(qqq)).toEqual(['시그널', '매수 조건 0/4'])
    // 칩은 표의 칸 순서 — 이격도 · ADX · DI · 변동성·거래량
    expect(Array.from(voo.querySelectorAll('.cond')).map((c) => c.getAttribute('aria-label'))).toEqual([
      '이격도 < 0 미충족',
      'ADX > 20 충족',
      'DI 약세 미충족',
      '변동성·거래량 미충족',
    ])
    // 지표 줄에는 더 이상 칩이 없다
    expect(voo.querySelector('.stat-box .cond')).toBeNull()
    // "▼ 매도"는 시그널 줄, "◆ 비중 미달"은 비중 줄
    const [signalItems, weightItems] = Array.from(voo.querySelectorAll('.signal-row-items'))
    expect(signalItems).toHaveTextContent('매도')
    expect(weightItems).toHaveTextContent('비중 미달')
  })
})

describe('대시보드 · 정기 리뷰 날의 비중조절 수 (디자인 2차, 주인 결정)', () => {
  it('정기 리뷰 사유만 붙은 종목은 비중조절로 세지 않는다 — 요약·거르기가 과중·미달만', async () => {
    const review = { active: true, reasons: ['정기 리뷰 도래'] }
    mockApi([
      card({ ticker: 'VOO', rebalance_signal: review }),
      card({ ticker: 'QQQ', rebalance_signal: review }),
      card({ ticker: 'SCHD', rebalance_signal: { active: true, reasons: ['정기 리뷰 도래', '밴드 초과(매도 검토)'] } }),
    ])
    renderDashboard()
    const summary = await screen.findByRole('region', { name: '신호 요약' })
    const weight = within(summary).getByRole('button', { name: /비중조절/ })
    expect(weight).toHaveTextContent('1')
    expect(within(summary).getByText('정기 리뷰 3')).toBeInTheDocument()
    await userEvent.click(weight)
    expect(await nameOrder()).toEqual(['SCHD'])
  })
})
