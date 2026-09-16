import { render, screen, waitFor, within } from '@testing-library/react'
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
    current_period_buy: null,
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
    next_review_date: '2026-12-31',
    shoulder_signal_fired_in_period: false,
    rebalance_signal: { active: false, reasons: [] },
    quantity: 0,
    last_close: null,
    current_value: 0,
    current_value_base: 0,
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
    current_period_buy: {
      id: 1,
      type: 'signal',
      status: 'recommended',
      exec_date: '2026-09-16',
      amount: 500_000,
    },
  }),
  card({
    ticker: 'VOO',
    category: '지수',
    indicators: { ...INDICATORS, close: 408.03, change_pct: 1.3 },
    current_period_buy: {
      id: 2,
      type: 'signal',
      status: 'recommended',
      exec_date: '2026-09-16',
      amount: 300,
    },
  }),
]

const REBALANCE: RebalanceCurrent = {
  base_currency: 'KRW',
  fx: { usd_krw: 1300, source: 'stored', updated_at: null, is_estimate: false },
  total_value_base: 2_100_000,
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
    dca_amount: 0,
    dca_period: 'monthly',
    rebalance_period: 'quarterly',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    review_date_override: null,
    sort_order: 0,
  }
}

function mockApi(cards = CARDS, rebalance = REBALANCE) {
  vi.spyOn(api, 'getDashboard').mockResolvedValue(cards)
  vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue(rebalance)
  vi.spyOn(api, 'listStocks').mockResolvedValue(cards.map(stockOf))
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: 'test',
    providers_by_market: { US: [], KR: [] },
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

/** 표에 보이는 순서대로의 티커 목록 */
async function tickerOrder() {
  const table = (await screen.findAllByRole('table'))[0]
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((tr) => tr.querySelector('.ticker-sub')?.textContent?.split(' ·')[0]?.trim())
    .filter(Boolean)
}

async function cardRow(ticker: string) {
  const table = (await screen.findAllByRole('table'))[0]
  const row = within(table)
    .getAllByRole('row')
    .find((tr) => tr.textContent?.includes(ticker))
  if (!row) throw new Error(`${ticker} 행이 없습니다`)
  return row
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

    const kr = await cardRow('005930.KS')
    expect(within(kr).getByText('₩76,937')).toBeInTheDocument()

    const us = await cardRow('VOO')
    expect(within(us).getByText('$408.03')).toBeInTheDocument()
  })

  it('종목마다 어느 시장인지 표시한다', async () => {
    mockApi()
    renderDashboard()

    expect(within(await cardRow('005930.KS')).getByText(/한국/)).toBeInTheDocument()
    expect(within(await cardRow('VOO')).getByText(/미국/)).toBeInTheDocument()
  })

  it('매수 추천 금액도 해당 종목의 통화로 보여준다', async () => {
    mockApi()
    renderDashboard()

    expect(within(await cardRow('005930.KS')).getByText(/₩500,000/)).toBeInTheDocument()
    expect(within(await cardRow('VOO')).getByText(/\$300\.00/)).toBeInTheDocument()
  })

  it('추천 금액 합계는 통화를 섞어 더하지 않고 나눠서 보여준다', async () => {
    mockApi()
    renderDashboard()

    // 500,000 + 300 = 500,300 처럼 더해버리면 안 된다
    const foot = await screen.findByText(/추천 금액 합계/)
    expect(foot.textContent).toContain('₩500,000')
    expect(foot.textContent).toContain('$300.00')
    expect(foot.textContent).not.toContain('500,300')
  })

  it('포트폴리오 총액은 기준통화 환산으로 합산한다', async () => {
    mockApi()
    renderDashboard()

    // 현지 금액끼리 더했다면 801,000이 나왔을 것이다
    expect(await screen.findByText(/총 ₩2,100,000/)).toBeInTheDocument()
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
    expect(within(row).getByText(/DI 약세/)).toBeInTheDocument()
    expect(within(row).getByText(/ADX > 20/)).toBeInTheDocument()
    expect(row.textContent).not.toMatch(/\d\/4/)
  })
})

describe('대시보드 · 종목 순서와 설정', () => {
  it('순서를 바꾸면 화면이 바로 바뀌고 서버에 저장된다', async () => {
    mockApi()
    const save = vi.spyOn(api, 'updateStockOrder').mockResolvedValue([])
    const user = userEvent.setup()
    renderDashboard()

    await cardRow('VOO')
    expect(await tickerOrder()).toEqual(['005930.KS', 'VOO'])

    await user.click(screen.getByRole('button', { name: 'VOO 위로' }))

    // 응답을 기다리지 않고 바로 바뀌어 보여야 한다
    expect(await tickerOrder()).toEqual(['VOO', '005930.KS'])
    await waitFor(() => expect(save).toHaveBeenCalledWith(['VOO', '005930.KS']))
  })

  it('맨 위/맨 아래에서는 화살표를 누를 수 없다', async () => {
    mockApi()
    renderDashboard()

    expect(await screen.findByRole('button', { name: '005930.KS 위로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'VOO 아래로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '005930.KS 아래로' })).toBeEnabled()
  })

  it('저장에 실패하면 이유를 보여준다', async () => {
    mockApi()
    vi.spyOn(api, 'updateStockOrder').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    const user = userEvent.setup()
    renderDashboard()

    await cardRow('VOO')
    await user.click(screen.getByRole('button', { name: 'VOO 위로' }))

    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
  })

  it('설정 버튼으로 그 자리에서 종목을 고칠 수 있다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateStock').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: '005930.KS 설정' }))

    const dialog = screen.getByRole('dialog', { name: /삼성전자 설정/ })
    await user.clear(within(dialog).getByLabelText('목표 비중 (%)'))
    await user.type(within(dialog).getByLabelText('목표 비중 (%)'), '35')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('005930.KS', expect.objectContaining({ target_weight_pct: 35 })),
    )
  })

  it('완전 삭제는 한 번 더 확인을 받는다', async () => {
    mockApi()
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'VOO 설정' }))
    const dialog = screen.getByRole('dialog', { name: /VOO 설정/ })

    await user.click(within(dialog).getByRole('button', { name: '완전 삭제' }))
    // 아직 지우면 안 된다 — 되돌릴 수 없는 동작이다
    expect(purge).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/되돌릴 수 없고/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '네, 완전히 지웁니다' }))
    await waitFor(() => expect(purge).toHaveBeenCalledWith('VOO'))
  })
})
