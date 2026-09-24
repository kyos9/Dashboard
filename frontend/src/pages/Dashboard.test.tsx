import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type {
  DashboardCard,
  LatestIndicators,
  RebalanceCurrent,
  RebalanceRow,
  Stock,
} from '../types'
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

  it('포트폴리오 총액은 기준통화 환산으로 합산한다', async () => {
    mockApi()
    renderDashboard()

    // 현지 금액끼리 더했다면 801,000이 나왔을 것이다
    expect(await screen.findByText(/총 ₩2,100,000/)).toBeInTheDocument()
  })

  it('현금도 배분 막대와 범례에 한 칸으로 들어간다', async () => {
    mockApi(CARDS, {
      ...REBALANCE,
      total_value_base: 3_000_000,
      cash: { amounts: { KRW: 900_000 }, value_base: 900_000, target_pct: 30, actual_pct: 30, excess_pct: 0 },
    })
    renderDashboard()

    expect(await screen.findByText(/총 ₩3,000,000/)).toBeInTheDocument()
    expect(screen.getByTitle('현금 30.0%')).toBeInTheDocument()
  })

  it('평단가를 넣었으면 평가손익을 같이 보여준다', async () => {
    mockApi(CARDS, { ...REBALANCE, cost_value_base: 2_000_000, unrealized_pnl_base: 100_000 })
    renderDashboard()

    const foot = await screen.findByText(/평가손익/)
    expect(foot.textContent).toContain('+₩100,000')
    expect(foot.textContent).toContain('+5.0%')
  })
})

describe('대시보드 · 다음 리뷰', () => {
  it('리뷰할 때가 되면 그렇게 알리고 기록을 남기라고 한다', async () => {
    mockApi(CARDS, {
      ...REBALANCE,
      review: { period: 'quarterly', next_date: '2026-09-30', due: true, override: null, last_snapshot_at: null },
    })
    renderDashboard()

    expect(await screen.findByText('리뷰할 때')).toBeInTheDocument()
    expect(screen.getByText(/기록을 남기세요/)).toBeInTheDocument()
  })

  it('아직이면 날짜와 마지막 기록을 보여준다', async () => {
    mockApi(CARDS, {
      ...REBALANCE,
      review: {
        period: 'semiannual',
        next_date: '2099-12-31',
        due: false,
        override: null,
        last_snapshot_at: '2026-06-30T09:00:00',
      },
    })
    renderDashboard()

    expect(await screen.findByText('2099-12-31')).toBeInTheDocument()
    expect(screen.getByText(/다음 리뷰 · 반기/)).toBeInTheDocument()
    expect(screen.getByText('마지막 기록 2026-06-30')).toBeInTheDocument()
  })
})

describe('대시보드 · 상태 표시', () => {
  it('종목이 없으면 안내를 보여준다', async () => {
    mockApi([], { ...REBALANCE, rows: [], total_value_base: 0 })
    renderDashboard()

    expect(await screen.findByText(/등록된 종목이 없습니다/)).toBeInTheDocument()
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

  it('완전 삭제는 한 번 더 확인을 받는다', async () => {
    mockApi()
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDashboard()
    await openSettings(user)

    const row = await cardRow('VOO')
    await user.click(within(row).getByRole('button', { name: '완전 삭제' }))

    // 아직 지우면 안 된다 — 되돌릴 수 없는 동작이다
    expect(purge).not.toHaveBeenCalled()
    // 확인은 표 아래가 아니라 화면 위에 떠야 한다 (종목이 많으면 표 아래는 안 보인다)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/되돌릴 수 없고/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '네, 완전히 지웁니다' }))
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
