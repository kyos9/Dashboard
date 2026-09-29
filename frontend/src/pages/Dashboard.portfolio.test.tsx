/**
 * 대시보드 포트폴리오 보기 (ROADMAP 8-3) — 이 앱의 첫 화면.
 *
 * 지킬 것:
 * - 맨 위 한 줄은 리밸런싱과 **같은 응답**의 숫자다 (총 평가금액·평가손익·최근 거래일 대비·현금).
 * - 보유 종목 표는 현재가·평단가·수익률·평가손익·평가금액·비중(목표)·신호 점. 보유 0 은 관심 종목으로.
 * - 신호 점을 누르면 시그널 보기로 넘어가 그 종목을 보여주고, 뒤로가기면 포트폴리오로 돌아온다.
 * - 평단가가 없으면 그 자리에서 넣는다. 환율 효과는 풀이가 붙고, 빠진 종목은 빠졌다고 적는다.
 * - 종목마다 "수정"으로 수량·평단가·산 환율을 고친다 — 소수도 받는다 (9-1·9-2).
 * - "금액 가리기"를 켜면 금액·수량이 ••••• 가 되고 %는 남는다. 기기에 기억한다 (9-3).
 * - 고른 보기·정렬은 기기에 기억한다.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api, ApiError } from '../api/client'
import { clearCache } from '../lib/cache'
import { HIDE_AMOUNTS_KEY, resetPrefs } from '../lib/prefs'
import { forgetPhone, pretendPhone } from '../test/phone'
import type { DashboardCard, LatestIndicators, RebalanceCurrent, RebalanceRow, Stock } from '../types'
import { Dashboard } from './Dashboard'

const IND: LatestIndicators = {
  date: '2026-09-25',
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

function card(o: Partial<DashboardCard> & { ticker: string }): DashboardCard {
  return {
    name: null,
    category: null,
    market: 'US',
    currency: 'USD',
    data_stale: false,
    price_source: 'yahoo',
    indicators: IND,
    knee_buy_v2: false,
    knee_conditions: { di_bearish: null, disparity_negative: null, volatility_or_volume: null, adx_trending: null },
    shoulder_sell_ref: false,
    last_buy_signal_date: null,
    rebalance_signal: { active: false, reasons: [] },
    ...o,
  }
}

function row(o: Partial<RebalanceRow> & { ticker: string }): RebalanceRow {
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
    ...o,
  }
}

const CARDS: DashboardCard[] = [
  card({ ticker: 'SCHD', indicators: { ...IND, close: 130.02 }, knee_buy_v2: true }),
  card({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW', indicators: { ...IND, close: 69_000 } }),
  card({ ticker: 'QQQ', indicators: { ...IND, close: 500 } }),
  card({ ticker: 'NVDA', indicators: { ...IND, close: 120 }, shoulder_sell_ref: true }),
]

const ROWS: RebalanceRow[] = [
  row({
    ticker: 'SCHD',
    quantity: 100,
    avg_cost: 26,
    last_close: 130.02,
    prev_close: 128.62,
    change_pct: 1.09,
    current_value: 13_002,
    current_value_base: 17_553_153,
    unrealized_pnl: 10_402,
    return_pct: 400.1,
    shown_pnl: 10_402,
    shown_return_pct: 400.1,
    shown_currency: 'USD',
    actual_weight_pct: 46.6,
    target_weight_pct: 10,
    excess_pct: 36.6,
    rebalance_signal: { active: true, reasons: ['밴드 초과(매도 검토)'] },
  }),
  row({
    ticker: '005930.KS',
    name: '삼성전자',
    currency: 'KRW',
    quantity: 10,
    avg_cost: null,
    last_close: 69_000,
    change_pct: -1.43,
    current_value: 690_000,
    current_value_base: 690_000,
    shown_currency: 'KRW',
    actual_weight_pct: 1.8,
    target_weight_pct: 40,
    excess_pct: -38.2,
  }),
  row({
    ticker: 'QQQ',
    quantity: 3,
    avg_cost: 400,
    last_close: 500,
    change_pct: 2.5,
    current_value: 1500,
    current_value_base: 2_025_000,
    unrealized_pnl: 300,
    return_pct: 25,
    shown_pnl: 420_000,
    shown_return_pct: 25.8,
    shown_currency: 'KRW',
    fx_split: { price_pct: 25, fx_pct: 0.64 },
    actual_weight_pct: 5.4,
    target_weight_pct: 5,
    excess_pct: 0.4,
  }),
  // 보유 0 — 관심 종목
  row({ ticker: 'NVDA', last_close: 120, change_pct: -3.2 }),
]

const CURRENT: RebalanceCurrent = {
  base_currency: 'KRW',
  fx: { rates: {}, is_estimate: false },
  total_value_base: 37_668_153,
  holdings_value_base: 20_268_153,
  cost_value_base: 5_000_000,
  unrealized_pnl_base: 1_250_000,
  unpriced_count: 1,
  day_change_base: 162_000,
  day_change_pct: 0.43,
  include_fx_effect: true,
  fx_missing_count: 0,
  cash: { amounts: { KRW: 17_400_000 }, value_base: 17_400_000, target_pct: 0, actual_pct: 46.2, excess_pct: 46.2 },
  target_sum_pct: 100,
  review: { period: 'quarterly', next_date: '2099-12-31', due: false, override: null, last_snapshot_at: null },
  rows: ROWS,
}

function stockOf(c: DashboardCard): Stock {
  return {
    ticker: c.ticker,
    name: c.name,
    category: c.category,
    market: c.market,
    currency: c.currency,
    active: true,
    added_at: '2026-01-01T00:00:00',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    sort_order: 0,
  }
}

function mockApi(current: RebalanceCurrent = CURRENT, cards: DashboardCard[] = CARDS) {
  vi.spyOn(api, 'getDashboard').mockResolvedValue(cards)
  vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue(current)
  vi.spyOn(api, 'listStocks').mockResolvedValue(cards.map(stockOf))
  vi.spyOn(api, 'getMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
}

function Back() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>뒤로</button>
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppStateProvider>
        <Dashboard />
        <Where />
      </AppStateProvider>
    </MemoryRouter>,
  )
}

/** PC 표에서 한 종목의 줄 */
async function holdingRow(label: string) {
  const table = await screen.findByRole('table')
  const found = within(table)
    .getAllByRole('row')
    .find((tr) => tr.querySelector('.stock-name')?.textContent?.trim() === label)
  if (!found) throw new Error(`${label} 줄이 없습니다`)
  return found as HTMLElement
}

async function holdingOrder() {
  const table = await screen.findByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((tr) => tr.querySelector('.stock-name')?.textContent?.trim())
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  clearCache()
  resetPrefs()
  vi.stubGlobal('innerWidth', 1440)
  // jsdom 에는 스크롤이 없다 — 부른 것만 본다
  window.scrollTo = vi.fn() as never
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => forgetPhone())

describe('맨 위 — 내 돈 한 줄', () => {
  it('총 평가금액·평가손익·최근 거래일 대비·현금·신호 수를 리밸런싱과 같은 응답에서 그린다', async () => {
    mockApi()
    renderDashboard()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).toHaveTextContent('₩37,668,153')
    // 평가손익은 평단가를 아는 종목끼리의 원가 대비 %
    expect(line).toHaveTextContent('+₩1,250,000 +25.0%')
    expect(line).toHaveTextContent('최근 거래일 대비')
    expect(line).toHaveTextContent('+₩162,000 +0.43%')
    expect(line).toHaveTextContent('₩17,400,000')
    // 신호: SCHD(매수 시그널·과중), NVDA(매도 시그널) — 종목 수로 센다
    const signal = within(line).getByText('신호').nextElementSibling
    expect(signal).toHaveTextContent('2')
  })

  it('빠진 것은 빠졌다고 적는다 — 평단가 없는 종목, 환율 미반영 종목', async () => {
    mockApi({ ...CURRENT, fx_missing_count: 2 })
    renderDashboard()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).toHaveTextContent('평단가 없는 1종목은 손익에서 뺐습니다')
    expect(line).toHaveTextContent('손익에 환율 효과 포함')
    expect(line).toHaveTextContent('환율 미반영 2종목')
  })

  it('모르는 값은 0 이 아니라 모른다고 쓴다', async () => {
    mockApi({ ...CURRENT, unrealized_pnl_base: null, cost_value_base: null, day_change_base: null, day_change_pct: null })
    renderDashboard()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).toHaveTextContent('평단가 입력 시')
    expect(line).not.toHaveTextContent('+₩0')
  })

  it('리뷰 D-day 는 아래에 작게 남는다', async () => {
    mockApi({ ...CURRENT, review: { ...CURRENT.review, due: true, next_date: '2026-09-30' } })
    renderDashboard()
    await screen.findByRole('region', { name: '내 자산' })
    expect(screen.getByText('리뷰할 때')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '리밸런싱 →' })).toHaveAttribute('href', '/rebalance')
  })
})

describe('금액 가리기 (9-3)', () => {
  it('누르면 금액·수량이 가려지고 %·주당 가격은 남는다. 이 기기에 기억한다', async () => {
    mockApi()
    const first = renderDashboard()
    const line = await screen.findByRole('region', { name: '내 자산' })
    const toggle = within(line).getByRole('button', { name: '금액 가리기' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)

    expect(within(line).getByRole('button', { name: '금액 보기' })).toHaveAttribute('aria-pressed', 'true')
    for (const text of ['₩37,668,153', '₩1,250,000', '₩162,000', '₩17,400,000']) {
      expect(line).not.toHaveTextContent(text)
    }
    // %는 남는다 — 그것만으로는 얼마를 가졌는지 알 수 없다
    expect(line).toHaveTextContent('+25.0%')
    expect(line).toHaveTextContent('+0.43%')
    const schd = await holdingRow('SCHD')
    expect(schd).not.toHaveTextContent('100주')
    expect(schd).not.toHaveTextContent('₩17,553,153')
    expect(schd).not.toHaveTextContent('$10,402')
    expect(schd).toHaveTextContent('•••••')
    expect(schd).toHaveTextContent('$130.02')
    expect(schd).toHaveTextContent('+400.1%')
    expect(schd).toHaveTextContent('46.6%')
    // 해외 종목 평가금액에 붙은 현지 금액 풀이도 가린다
    expect(within(schd).queryByTitle(/현지 \$/)).not.toBeInTheDocument()
    expect(localStorage.getItem(HIDE_AMOUNTS_KEY)).toBe('1')

    // 다시 켜도 가려진 채로
    first.unmount()
    resetPrefs()
    clearCache()
    renderDashboard()
    const again = await screen.findByRole('region', { name: '내 자산' })
    expect(again).not.toHaveTextContent('₩37,668,153')
    await userEvent.click(within(again).getByRole('button', { name: '금액 보기' }))
    expect(again).toHaveTextContent('₩37,668,153')
    expect(await holdingRow('SCHD')).toHaveTextContent('100주')
    expect(localStorage.getItem(HIDE_AMOUNTS_KEY)).toBeNull()
  })

  it('폰의 두 줄 목록도 가린다', async () => {
    pretendPhone()
    localStorage.setItem(HIDE_AMOUNTS_KEY, '1')
    mockApi()
    renderDashboard()
    const toggle = await screen.findByRole('button', { name: 'SCHD 자세히' })
    expect(toggle).not.toHaveTextContent('100주')
    expect(toggle).not.toHaveTextContent('₩17,553,153')
    expect(toggle).toHaveTextContent('+400.1%')
    await userEvent.click(toggle)
    expect(document.getElementById('holding-SCHD')).not.toHaveTextContent('$10,402')
  })
})

describe('보유 종목 표', () => {
  it('한 줄에 현재가(전일 대비)·평단가·수익률·평가손익·평가금액·비중(목표)', async () => {
    mockApi()
    renderDashboard()
    const schd = await holdingRow('SCHD')
    expect(schd).toHaveTextContent('100주')
    expect(schd).toHaveTextContent('$130.02')
    expect(schd).toHaveTextContent('+1.09%')
    expect(schd).toHaveTextContent('$26.00')
    expect(schd).toHaveTextContent('+400.1%')
    expect(schd).toHaveTextContent('+$10,402.00')
    expect(schd).toHaveTextContent('₩17,553,153')
    expect(schd).toHaveTextContent('46.6% (10%)')
  })

  it('보유 0 인 종목은 표에 없고 관심 종목으로 따로 모인다', async () => {
    mockApi()
    renderDashboard()
    expect(await holdingOrder()).not.toContain('NVDA')
    const watch = screen.getByRole('region', { name: /관심 종목/ })
    expect(within(watch).getByText('NVDA')).toBeInTheDocument()
    expect(watch).toHaveTextContent('-3.20%')
  })

  it('정렬은 평가금액이 기본이고, 고른 것을 기억한다', async () => {
    mockApi()
    const first = renderDashboard()
    expect(await holdingOrder()).toEqual(['SCHD', 'QQQ', '삼성전자'])

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '정렬' }), '등락')
    expect(await holdingOrder()).toEqual(['QQQ', 'SCHD', '삼성전자'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '정렬' }), '수익률')
    // 평단가를 모르는 종목은 맨 뒤
    expect(await holdingOrder()).toEqual(['SCHD', 'QQQ', '삼성전자'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '정렬' }), '비중 차이')
    expect(await holdingOrder()).toEqual(['삼성전자', 'SCHD', 'QQQ'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '정렬' }), '내가 정한 순서')
    expect(await holdingOrder()).toEqual(['SCHD', '삼성전자', 'QQQ'])
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '정렬' }), '등락')

    first.unmount()
    renderDashboard()
    expect(screen.getByRole('combobox', { name: '정렬' })).toHaveValue('change')
    expect(await holdingOrder()).toEqual(['QQQ', 'SCHD', '삼성전자'])
  })

  it('환율 효과를 넣은 줄은 원화 손익과 둘로 나눈 풀이가 붙는다', async () => {
    mockApi()
    renderDashboard()
    const qqq = await holdingRow('QQQ')
    expect(qqq).toHaveTextContent('+₩420,000')
    expect(within(qqq).getByText('+25.8%')).toHaveAttribute('title', '주가 +25.0% · 환율 +0.6% → 합계 +25.8%')
  })

  it('환율 효과를 켰는데 산 환율이 없는 줄은 "환율 미반영"', async () => {
    const rows = ROWS.map((r) => (r.ticker === 'SCHD' ? { ...r, fx_missing: true } : r))
    mockApi({ ...CURRENT, rows })
    renderDashboard()
    expect(within(await holdingRow('SCHD')).getByText('환율 미반영')).toBeInTheDocument()
    expect(within(await holdingRow('QQQ')).queryByText('환율 미반영')).not.toBeInTheDocument()
  })

  it('평단가가 없으면 수익률 칸의 "평단가 입력"이 수정 팝업을 평단가 칸부터 연다 — 원화도 소수를 받는다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    await userEvent.click(within(await holdingRow('삼성전자')).getByRole('button', { name: '삼성전자 평단가 입력' }))
    const dialog = await screen.findByRole('dialog', { name: '삼성전자 보유 수정' })
    const cost = within(dialog).getByRole('textbox', { name: '삼성전자 평단가' })
    expect(cost).toHaveFocus()
    // 수량은 지금 값이 들어 있고, 원화 종목에는 산 환율 칸이 없다
    expect(within(dialog).getByRole('textbox', { name: '삼성전자 보유수량' })).toHaveValue('10')
    expect(within(dialog).queryByRole('textbox', { name: '삼성전자 산 환율' })).not.toBeInTheDocument()
    await userEvent.type(cost, '61234.56')
    expect(cost).toHaveValue('61,234.56')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(update).toHaveBeenCalledWith('005930.KS', 10, 61234.56, undefined)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '삼성전자 보유 수정' })).not.toBeInTheDocument())
  })

  it('줄마다 "수정" — 지금 값이 채워져 있고, 소수 수량을 받는다. 산 환율은 고쳤을 때만 보낸다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: 'SCHD 보유 수정' }))
    const dialog = await screen.findByRole('dialog', { name: 'SCHD 보유 수정' })
    const quantity = within(dialog).getByRole('textbox', { name: 'SCHD 보유수량' })
    expect(quantity).toHaveFocus()
    expect(within(dialog).getByRole('textbox', { name: 'SCHD 평단가' })).toHaveValue('26')
    expect(within(dialog).getByRole('textbox', { name: 'SCHD 산 환율' })).toHaveValue('')
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '100.5')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(update).toHaveBeenLastCalledWith('SCHD', 100.5, 26, undefined)

    // 이번엔 산 환율만 넣는다
    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: 'SCHD 보유 수정' }))
    const again = await screen.findByRole('dialog', { name: 'SCHD 보유 수정' })
    await userEvent.type(within(again).getByRole('textbox', { name: 'SCHD 산 환율' }), '1350.5')
    await userEvent.click(within(again).getByRole('button', { name: '저장' }))
    expect(update).toHaveBeenLastCalledWith('SCHD', 100, 26, 1350.5)
  })

  it('평단가를 비우면 모름(null)으로, 수량을 비우면 0으로 저장한다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    await userEvent.click(within(await holdingRow('QQQ')).getByRole('button', { name: 'QQQ 보유 수정' }))
    const dialog = await screen.findByRole('dialog', { name: 'QQQ 보유 수정' })
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'QQQ 보유수량' }))
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'QQQ 평단가' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(update).toHaveBeenCalledWith('QQQ', 0, null, undefined)
  })

  it('취소·Esc 는 저장하지 않고 닫는다. 저장이 실패하면 팝업에 남아 까닭을 보여준다', async () => {
    mockApi()
    const update = vi
      .spyOn(api, 'updateHolding')
      .mockRejectedValue(new ApiError(400, '평단가를 확인해 주세요.', 'bad avg_cost'))
    renderDashboard()
    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: 'SCHD 보유 수정' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: 'SCHD 보유 수정' }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()

    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: 'SCHD 보유 수정' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByText('평단가를 확인해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'SCHD 보유 수정' })).toBeInTheDocument()
  })

  it('관심 종목(보유 0)도 "수정"으로 수량을 넣으면 보유로 올라간다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    const watch = await screen.findByRole('region', { name: /관심 종목/ })
    await userEvent.click(within(watch).getByRole('button', { name: 'NVDA 보유 수정' }))
    const dialog = await screen.findByRole('dialog', { name: 'NVDA 보유 수정' })
    // 보유 0 은 빈칸으로 연다 — "0"을 지우고 칠 필요가 없게
    expect(within(dialog).getByRole('textbox', { name: 'NVDA 보유수량' })).toHaveValue('')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'NVDA 보유수량' }), '2')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(update).toHaveBeenCalledWith('NVDA', 2, null, undefined)
  })

  it('이름을 누르면 차트가 뜬다', async () => {
    mockApi()
    renderDashboard()
    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: 'SCHD' }))
    expect(await screen.findByRole('dialog', { name: 'SCHD' })).toBeInTheDocument()
  })

  it('보유가 하나도 없으면 어디서 적는지 알려준다', async () => {
    mockApi({ ...CURRENT, rows: ROWS.map((r) => ({ ...r, quantity: 0 })) })
    renderDashboard()
    expect(await screen.findByText(/아직 보유수량을 적은 종목이 없습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('신호 점', () => {
  it('신호가 있는 종목에만 점이 있고, 정기 리뷰만으로는 찍히지 않는다', async () => {
    const rows = ROWS.map((r) =>
      r.ticker === 'QQQ' ? { ...r, rebalance_signal: { active: true, reasons: ['정기 리뷰 도래'] } } : r,
    )
    mockApi({ ...CURRENT, rows })
    renderDashboard()
    const schd = await holdingRow('SCHD')
    const dot = within(schd).getByRole('button', { name: /SCHD 신호/ })
    expect(dot).toHaveAccessibleName('SCHD 신호: 매수 시그널 · 과중 — 매도 검토. 시그널 보기로')
    // 색만으로 가리지 않게 모양이 붙는다 — 매수 ▲ 와 비중조절 ◆ (8-4)
    expect([...dot.querySelectorAll('.signal-shape')].map((el) => el.getAttribute('class'))).toEqual([
      'signal-shape buy',
      'signal-shape rebalance',
    ])
    // 모양 풀이가 아래에 있다
    expect(screen.getByLabelText('신호 모양 풀이')).toHaveTextContent('매수 시그널')
    expect(within(await holdingRow('QQQ')).queryByRole('button', { name: /신호/ })).not.toBeInTheDocument()
    expect(within(await holdingRow('삼성전자')).queryByRole('button', { name: /신호/ })).not.toBeInTheDocument()
  })

  it('시세가 오래된 종목의 시그널은 점으로 찍지 않는다 (시그널 보기와 같은 규칙)', async () => {
    const cards = CARDS.map((c) => (c.ticker === 'NVDA' ? { ...c, data_stale: true } : c))
    mockApi(CURRENT, cards)
    renderDashboard()
    const watch = await screen.findByRole('region', { name: /관심 종목/ })
    expect(within(watch).queryByRole('button', { name: /신호/ })).not.toBeInTheDocument()
  })

  it('누르면 시그널 보기로 넘어가 그 종목을 밝히고, 뒤로가기면 포트폴리오의 보던 자리로', async () => {
    mockApi()
    renderDashboard()
    ;(window as { scrollY: number }).scrollY = 640

    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: /SCHD 신호/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=signal')
    expect(screen.getByRole('button', { name: '시그널' })).toHaveAttribute('aria-pressed', 'true')
    // 시그널 보기의 그 종목 줄로 스크롤하고 잠깐 밝힌다
    const target = await waitFor(() => {
      const found = document.querySelector('[data-ticker="SCHD"].flash')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(target.scrollIntoView).toHaveBeenCalled()
    // 넘어간 것은 기억하지 않는다 — 다음에 열면 여전히 포트폴리오
    expect(localStorage.getItem('dashboard.view')).toBeNull()

    ;(window as { scrollY: number }).scrollY = 0
    await userEvent.click(screen.getByRole('button', { name: '포트폴리오' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    expect(screen.getByRole('region', { name: '내 자산' })).toBeInTheDocument()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 640)
  })

  it('시그널 보기에서 "포트폴리오"로 돌아오면 헛도는 칸이 없다 — 뒤로가기 한 번이면 앞 화면', async () => {
    mockApi()
    render(
      <MemoryRouter initialEntries={['/stocks', '/']} initialIndex={1}>
        <AppStateProvider>
          <Dashboard />
          <Where />
          <Back />
        </AppStateProvider>
      </MemoryRouter>,
    )
    await userEvent.click(within(await holdingRow('SCHD')).getByRole('button', { name: /SCHD 신호/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=signal')
    await userEvent.click(screen.getByRole('button', { name: '포트폴리오' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    await userEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/stocks'))
  })

  it('필터가 그 종목을 가리고 있으면 "모두 보기"로 돌린다', async () => {
    mockApi()
    renderDashboard()
    // 시그널 보기에서 비중조절 신호만 보이게 걸어 둔다 — NVDA(매도 시그널만)는 가려진다
    await userEvent.click(await screen.findByRole('button', { name: '시그널' }))
    await userEvent.click(await screen.findByRole('button', { name: /비중조절 신호/ }))
    expect(document.querySelector('[data-ticker="NVDA"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '포트폴리오' }))

    const watch = await screen.findByRole('region', { name: /관심 종목/ })
    await userEvent.click(within(watch).getByRole('button', { name: /NVDA 신호/ }))
    await waitFor(() => expect(document.querySelector('[data-ticker="NVDA"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: '모두 보기' })).toHaveClass('active')
  })
})

describe('포트폴리오 | 시그널', () => {
  it('처음엔 포트폴리오, 고른 쪽을 기억한다', async () => {
    mockApi()
    const first = renderDashboard()
    expect(await screen.findByRole('button', { name: '포트폴리오' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '시그널' }))
    // 예전 대시보드가 그대로 있다 — 지표 표와 AI 전체 정리
    expect(await screen.findByRole('button', { name: /AI 전체 정리/ })).toBeInTheDocument()
    expect(localStorage.getItem('dashboard.view')).toBe('signal')
    // 고른 것은 뒤로가기 칸을 쌓지 않는다
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)

    first.unmount()
    renderDashboard()
    expect(await screen.findByRole('button', { name: '시그널' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('저장이 막힌 브라우저에서도 화면은 뜬다', async () => {
    mockApi()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderDashboard()
    expect(await screen.findByRole('region', { name: '내 자산' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '시그널' }))
    expect(screen.getByRole('button', { name: '시그널' })).toHaveAttribute('aria-pressed', 'true')
    expect(get).toHaveBeenCalled()
  })
})

describe('폰 — 한 종목이 두 줄', () => {
  beforeEach(() => {
    pretendPhone()
  })

  it('윗줄 이름·평가금액, 아랫줄 현재가(등락)·수익률·비중. 누르면 펼쳐진다', async () => {
    mockApi()
    renderDashboard()
    const toggle = await screen.findByRole('button', { name: 'SCHD 자세히' })
    expect(toggle).toHaveTextContent('SCHD 100주')
    expect(toggle).toHaveTextContent('₩17,553,153')
    expect(toggle).toHaveTextContent('$130.02 +1.09%')
    expect(toggle).toHaveTextContent('+400.1%')
    expect(toggle).toHaveTextContent('46.6%')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const detail = document.getElementById('holding-SCHD') as HTMLElement
    expect(detail).toHaveTextContent('$26.00')
    expect(detail).toHaveTextContent('+$10,402.00')
    expect(detail).toHaveTextContent('10% (+36.6%p)')
    expect(within(detail).getByRole('button', { name: '차트' })).toBeInTheDocument()

    // 펼친 곳의 신호 글도 시그널 보기로 간다
    await userEvent.click(within(detail).getByRole('button', { name: /매수 시그널 · 과중 — 매도 검토/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=signal')
  })

  it('평단가가 없으면 펼친 곳에서 넣는다 — 같은 수정 팝업', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: '삼성전자 자세히' }))
    expect(screen.getByRole('button', { name: '삼성전자 자세히' })).toHaveTextContent('평단가 —')
    await userEvent.click(screen.getByRole('button', { name: '삼성전자 평단가 입력' }))
    const dialog = await screen.findByRole('dialog', { name: '삼성전자 보유 수정' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: '삼성전자 평단가' }), '61000')
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    })
    expect(update).toHaveBeenCalledWith('005930.KS', 10, 61000, undefined)
  })

  it('펼친 곳의 "수정"으로 수량·평단가를 고친다', async () => {
    mockApi()
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: 'SCHD 자세히' }))
    const detail = document.getElementById('holding-SCHD') as HTMLElement
    await userEvent.click(within(detail).getByRole('button', { name: 'SCHD 보유 수정' }))
    expect(await screen.findByRole('dialog', { name: 'SCHD 보유 수정' })).toBeInTheDocument()
  })
})
