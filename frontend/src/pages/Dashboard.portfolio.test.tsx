/**
 * 대시보드 포트폴리오 보기 (ROADMAP 8-3) — 이 앱의 첫 화면.
 *
 * 지킬 것:
 * - 맨 위 한 줄은 리밸런싱과 **같은 응답**의 숫자다 (총 평가금액·평가손익·최근 거래일 대비·현금).
 * - 보유 종목 표는 현재가·평단가·수익률·평가손익·평가금액·비중(목표)·신호 점. 보유 0 은 관심 종목으로.
 * - 신호 점을 누르면 시그널 보기로 넘어가 그 종목을 보여주고, 뒤로가기면 포트폴리오로 돌아온다.
 * - 평단가가 없으면 그 자리에서 넣는다. 환율 효과는 풀이가 붙고, 빠진 종목은 빠졌다고 적는다.
 * - 수량은 제 칸이 있다 (9-10). 평가손익은 종목별 통화 또는 고른 한 통화로 (9-12).
 * - 위의 "수정" 하나로 모든 종목의 구분·목표·밴드·수량·평단가·산 환율을 한 번에 고친다 (9-11).
 *   소수도 받는다 (9-2).
 * - "금액 가리기"를 켜면 금액·수량이 ••••• 가 되고 %는 남는다. 기기에 기억한다 (9-3).
 * - 고른 보기·정렬은 기기에 기억한다.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { AuthGate } from '../components/AuthGate'
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
  // 서버는 카드에도 리밸런싱 응답과 같은 비중조절 신호를 싣는다 — 시그널 보기의 거르기가 카드의 것을 읽는다
  card({
    ticker: 'SCHD',
    indicators: { ...IND, close: 130.02 },
    knee_buy_v2: true,
    rebalance_signal: { active: true, reasons: ['밴드 초과(매도 검토)'] },
  }),
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

async function openEditor() {
  await userEvent.click(await screen.findByRole('button', { name: '종목 한 번에 수정' }))
  return screen.findByRole('dialog', { name: '종목 한 번에 수정' })
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
  // 디자인 5차 — PC 홈은 새 부품(DesktopHome, components/home/DesktopHome.test.tsx). 이 파일은 폰 홈(예전 그대로)을 본다
  pretendPhone()
})

afterEach(() => forgetPhone())

describe('맨 위 — 내 돈 한 줄', () => {
  it('총 평가금액·평가손익·최근 거래일 대비·현금·신호 수를 리밸런싱과 같은 응답에서 그린다', async () => {
    mockApi()
    renderDashboard()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).toHaveTextContent('₩37,668,153')
    // 평가손익은 평단가를 아는 종목끼리의 원가 대비 %
    // 디자인 4차 B: 평가손익과 수익률은 칸이 따로 (주인 답 "수익과 수익률은 B처럼 구분")
    expect(line).toHaveTextContent('+₩1,250,000')
    expect(line).toHaveTextContent('+25.0%')
    expect(line).toHaveTextContent('최근 거래일 대비')
    expect(line).toHaveTextContent('+₩162,000 +0.43%')
    expect(line).toHaveTextContent('₩17,400,000')
    // 신호 개수는 돈 카드가 아니라 맨 위 "확인할 신호" 줄이 말한다 (디자인 1차)
    expect(within(line).queryByText('신호')).not.toBeInTheDocument()
    // SCHD(매수 시그널·과중), NVDA(매도 시그널) — 종류마다 종목 수로 센다
    // 종류마다 단추 — 누르면 그 종류만 걸러진 시그널 보기 (디자인 2차, 주인 결정 ②)
    const signals = screen.getByRole('region', { name: '확인할 신호' })
    expect(within(signals).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      '매수 1종목 — 시그널 보기에서 매수만',
      '매도 1종목 — 시그널 보기에서 매도만',
      '비중조절 1종목 — 시그널 보기에서 비중조절만',
    ])
    // "시그널 보기 →" 는 뺐다 — 바로 위의 "시그널" 탭과 같은 일 (디자인 4차 B, 목업 05b)
  })

  it('"확인할 신호"의 매도를 누르면 시그널 보기가 매도로 걸러져 열린다 — 수가 같다', async () => {
    mockApi()
    renderDashboard()
    const signals = await screen.findByRole('region', { name: '확인할 신호' })
    await userEvent.click(within(signals).getByRole('button', { name: /^매도 1종목/ }))
    const summary = await screen.findByRole('region', { name: '신호 요약' })
    const sell = within(summary).getByRole('button', { name: /매도/ })
    expect(sell).toHaveAttribute('aria-pressed', 'true')
    expect(sell).toHaveTextContent('1')
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

  it('신호 모양 풀이는 용어집의 말 — "비중 초과·미달", "과중"은 쓰지 않는다 (0.44.0)', async () => {
    mockApi()
    renderDashboard()
    const legend = await screen.findByLabelText('신호 모양 풀이')
    expect(legend).toHaveTextContent('비중조절(비중 초과·미달)')
    expect(legend.textContent).not.toMatch(/과중/)
  })

  it('리뷰 D-day 는 아래에 작게 남는다', async () => {
    mockApi({ ...CURRENT, review: { ...CURRENT.review, due: true, next_date: '2026-09-30' } })
    renderDashboard()
    await screen.findByRole('region', { name: '내 자산' })
    expect(screen.getByText('리뷰할 때')).toBeInTheDocument()
    // 디자인 4차 B: 다음 리뷰는 요약 칸의 한 칸 — 옆에 리밸런싱으로 가는 글자 링크
    expect(screen.getByRole('link', { name: '리밸런싱' })).toHaveAttribute('href', '/rebalance')
  })
})

describe('금액 가리기 (9-3)', () => {

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

  it('여러 종목의 여러 칸을 한 번에 — 바뀐 종목의 바뀐 쪽만 보낸다. 소수 수량을 받고, 산 환율은 고쳤을 때만', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const updateStock = vi.spyOn(api, 'updateStock').mockResolvedValue({} as never)
    const listed = vi.mocked(api.getRebalanceCurrent)
    renderDashboard()
    const dialog = await openEditor()
    const before = listed.mock.calls.length

    const quantity = within(dialog).getByRole('textbox', { name: 'SCHD 보유수량' })
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '100.5')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'QQQ 산 환율' }), '1350.5')
    await userEvent.type(within(dialog).getByRole('combobox', { name: '삼성전자 구분' }), '알파')
    const target = within(dialog).getByRole('textbox', { name: '삼성전자 목표 비중' })
    await userEvent.clear(target)
    await userEvent.type(target, '40')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'NVDA 보유수량' }), '2')
    // 고친 종목은 표시가 붙고, 목표 합계가 바로 바뀐다
    expect(dialog.querySelector('fieldset[data-ticker="SCHD"]')).toHaveClass('dirty')
    expect(dialog.querySelector('fieldset[data-ticker="QQQ"]')).toHaveClass('dirty')
    expect(within(dialog).getByText(/목표 비중 합계 40\.0%/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: '4종목 저장' }))
    expect(update).toHaveBeenCalledTimes(3)
    expect(update).toHaveBeenCalledWith('SCHD', 100.5, 26, undefined)
    expect(update).toHaveBeenCalledWith('QQQ', 3, 400, 1350.5)
    expect(update).toHaveBeenCalledWith('NVDA', 2, null, undefined)
    expect(updateStock).toHaveBeenCalledTimes(1)
    expect(updateStock).toHaveBeenCalledWith('005930.KS', {
      name: '삼성전자',
      category: '알파',
      target_weight_pct: 40,
      rebalance_band_pct: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '종목 한 번에 수정' })).not.toBeInTheDocument())
    // 저장했으면 뒤 화면을 새로 받는다
    await waitFor(() => expect(listed.mock.calls.length).toBeGreaterThan(before))
  })

  it('평단가를 비우면 모름(null)으로, 수량을 비우면 0으로 저장한다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    const dialog = await openEditor()
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'QQQ 보유수량' }))
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'QQQ 평단가' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '1종목 저장' }))
    expect(update).toHaveBeenCalledWith('QQQ', 0, null, undefined)
  })

  it('취소·Esc 는 저장하지 않고 닫는다. 고치던 중엔 Esc·바깥 누르기·취소가 닫지 않고 버릴지 묻는다 (0.45.0)', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding')
    renderDashboard()
    await userEvent.click(within(await openEditor()).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await openEditor()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openEditor()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'NVDA 보유수량' }), '2')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '종목 한 번에 수정' })).toBeInTheDocument()
    // 확인 창의 Esc 는 "계속 고치기" — 다시 뜨지 않는다
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // 바깥을 눌러도 묻는다. 확인 창의 바깥을 누르면 "계속 고치기" — 아래로 올라가 다시 묻지 않는다
    await userEvent.click(dialog.parentElement as HTMLElement)
    const ask = screen.getByRole('alertdialog')
    await userEvent.click(ask.parentElement as HTMLElement)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '종목 한 번에 수정' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '버리고 닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('한 종목이 실패해도 나머지는 저장되고, 실패한 종목만 까닭과 함께 남는다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockImplementation(async (ticker) => {
      if (ticker === 'SCHD') throw new ApiError(400, '평단가를 확인해 주세요.', 'bad avg_cost')
      return {} as never
    })
    renderDashboard()
    const dialog = await openEditor()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'SCHD 평단가' }), '1')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'NVDA 보유수량' }), '2')
    await userEvent.click(within(dialog).getByRole('button', { name: '2종목 저장' }))

    expect(await within(dialog).findByText('평단가를 확인해 주세요.')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('저장하지 못한 종목: SCHD. 나머지는 저장했습니다.')
    expect(dialog.querySelector('fieldset[data-ticker="SCHD"]')).toHaveClass('failed')
    // NVDA 는 저장됐으니 더는 "고친 것"이 아니다 — 다시 누르면 SCHD 만 간다
    expect(within(dialog).getByRole('button', { name: '1종목 저장' })).toBeEnabled()
    update.mockClear()
    await userEvent.click(within(dialog).getByRole('button', { name: '1종목 저장' }))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('SCHD', 100, 261, undefined)
  })

  it('보유가 하나도 없으면 어디서 적는지 알려준다', async () => {
    mockApi({ ...CURRENT, rows: ROWS.map((r) => ({ ...r, quantity: 0 })) })
    renderDashboard()
    expect(await screen.findByText(/아직 보유수량을 적은 종목이 없습니다/)).toBeInTheDocument()
    // PC 의 "수정"은 위가 아니라 오른쪽에 있다 — 자리 대신 이름으로 (묶음 6 사용자 확인)
    expect(screen.getByText(/보유 종목의 "수정"이나/)).toBeInTheDocument()
    expect(screen.queryByText(/위의 "수정"/)).toBeNull()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('평가손익 통화 (9-12)', () => {
  const FX = {
    rates: {
      USD: { currency: 'USD' as const, krw_rate: 1350, source: 'stored', updated_at: null, is_estimate: false },
    },
    is_estimate: false,
  }

  it('폰의 펼친 곳도 고른 통화로', async () => {
    pretendPhone()
    localStorage.setItem('dashboard.pnl-currency', 'KRW')
    mockApi({ ...CURRENT, fx: FX })
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: 'SCHD 자세히' }))
    expect(document.getElementById('holding-SCHD')).toHaveTextContent('+₩14,042,700')
  })

})

describe('신호 점', () => {

  it('시세가 오래된 종목의 시그널은 점으로 찍지 않는다 (시그널 보기와 같은 규칙)', async () => {
    const cards = CARDS.map((c) => (c.ticker === 'NVDA' ? { ...c, data_stale: true } : c))
    mockApi(CURRENT, cards)
    renderDashboard()
    const watch = await screen.findByRole('region', { name: /관심 종목/ })
    expect(within(watch).queryByRole('button', { name: /신호/ })).not.toBeInTheDocument()
  })

})

describe('위 탭 없음 (디자인 4차 묶음 2 — 보기 전환 "다")', () => {
  it('처음엔 늘 포트폴리오 — 예전에 시그널을 골라 두었어도. 전환 단추가 없다', async () => {
    localStorage.setItem('dashboard.view', 'signal')
    mockApi()
    renderDashboard()
    expect(await screen.findByRole('region', { name: '내 자산' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '대시보드 보기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '시그널' })).toBeNull()
  })

  it('신호 칸을 누르면 시그널 목록 — 머리에 ‹ 와 "시그널", AI 종목 정리 한 줄', async () => {
    mockApi()
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: /비중조절/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=signal')
    expect(screen.getByRole('heading', { name: /^시그널/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /AI 종목 정리/ })).toHaveAttribute('href', '/ai/watchlist')
  })

  it('신호가 하나도 없어도 시그널 목록으로 갈 길이 있다 (묶음 2 검토 조건 1)', async () => {
    const quiet = CARDS.map((c) => ({ ...c, knee_buy_v2: false, shoulder_sell_ref: false, rebalance_signal: { active: false, reasons: [] } }))
    const rows = ROWS.map((r) => ({ ...r, rebalance_signal: { active: false, reasons: [] } }))
    mockApi({ ...CURRENT, rows }, quiet)
    renderDashboard()
    expect(await screen.findByText(/확인할 신호가 없습니다/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '시그널 목록 보기' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=signal')
  })

  it('저장이 막힌 브라우저에서도 화면은 뜬다', async () => {
    mockApi()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderDashboard()
    expect(await screen.findByRole('region', { name: '내 자산' })).toBeInTheDocument()
  })
})

describe('홈 — AI 티 빼기 (목업 13 ②④)', () => {
  it('요약 아래 줄은 문장으로 — 띄어 쓴 가운뎃점으로 낱말을 줄 세우지 않는다', async () => {
    mockApi()
    renderDashboard()
    const line = await screen.findByRole('region', { name: '내 자산' })
    const note = line.querySelector('.money-note')!
    expect(note.textContent).toMatch(/^현금 ₩17,400,000 포함, 원 기준/)
    expect(note.textContent).not.toMatch(/ · /)
    expect(line).toHaveTextContent('다음 리뷰 (분기마다)')
  })

  it('AI 점검 줄에 반짝이 표시가 없고, 시그널 칸 글자 끝에 꺾쇠가 붙지 않는다', async () => {
    localStorage.clear()
    mockApi()
    renderDashboard()
    const ai = await screen.findByRole('link', { name: /AI 포트폴리오 점검/ })
    expect(ai.querySelector('.ai-row-mark')).toBeNull()
    expect(ai).toHaveTextContent('비중과 수익률로 전체를 봅니다')
    const signals = screen.getByRole('region', { name: '확인할 신호' })
    for (const b of within(signals).getAllByRole('button')) expect(b.textContent).not.toMatch(/[›→]/)
  })

  it('폰 보유 목록에 머리줄("종목 · 수량 · 신호")이 없다 — 줄을 보면 안다', async () => {
    pretendPhone()
    try {
      mockApi()
      renderDashboard()
      await screen.findByRole('button', { name: 'SCHD 자세히' })
      expect(document.querySelector('.holding-head')).toBeNull()
      expect(screen.queryByText('종목 · 수량 · 신호')).toBeNull()
    } finally {
      forgetPhone()
    }
  })
})

describe('폰 — 한 종목이 두 줄', () => {
  beforeEach(() => {
    pretendPhone()
  })

  it('한 줄: 이름·수량 | 평가금액·비중 | 수익률·수익금. 현재가(등락)는 펼치면. 누르면 펼쳐진다 (디자인 4차 B)', async () => {
    mockApi()
    renderDashboard()
    const toggle = await screen.findByRole('button', { name: 'SCHD 자세히' })
    expect(toggle).toHaveTextContent('SCHD')
    expect(toggle).toHaveTextContent('100주')
    expect(toggle).toHaveTextContent('비중 46.6%')
    expect(toggle).toHaveTextContent('₩17,553,153')
    expect(toggle).toHaveTextContent('+400.1%')
    expect(toggle).not.toHaveTextContent('$130.02')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const detail = document.getElementById('holding-SCHD') as HTMLElement
    expect(detail).toHaveTextContent('$130.02 +1.09%')
    expect(detail).toHaveTextContent('$26.00')
    expect(detail).toHaveTextContent('+$10,402.00')
    expect(detail).toHaveTextContent('10% (+36.6%p)')
    expect(within(detail).getByRole('button', { name: '차트' })).toBeInTheDocument()

    // 펼친 곳의 신호 글도 시그널 보기로 간다
    await userEvent.click(within(detail).getByRole('button', { name: /매수 시그널, 비중 초과/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=signal')
  })

  it('평단가가 없으면 펼친 곳에서 넣는다 — 같은 한 번에 수정 창', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: '삼성전자 자세히' }))
    expect(screen.getByRole('button', { name: '삼성전자 자세히' })).toHaveTextContent('평단가 —')
    await userEvent.click(screen.getByRole('button', { name: '삼성전자 평단가 입력' }))
    const dialog = await screen.findByRole('dialog', { name: '종목 한 번에 수정' })
    expect(within(dialog).getByRole('textbox', { name: '삼성전자 평단가' })).toHaveFocus()
    await userEvent.type(within(dialog).getByRole('textbox', { name: '삼성전자 평단가' }), '61000')
    await act(async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: '1종목 저장' }))
    })
    expect(update).toHaveBeenCalledWith('005930.KS', 10, 61000, undefined)
  })

  it('펼친 곳에 보유 수량이 있고, 고치는 것은 위의 "수정" 하나다', async () => {
    mockApi()
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: 'SCHD 자세히' }))
    const detail = document.getElementById('holding-SCHD') as HTMLElement
    expect(within(detail).getByText('보유 수량').nextElementSibling).toHaveTextContent('100주')
    expect(within(detail).queryByRole('button', { name: /수정/ })).toBeNull()
    expect(await openEditor()).toBeInTheDocument()
  })
})

describe('AI 포트폴리오 점검 (9-7) — 관리자는 늘, 사용자는 관리자가 열어 둔 동안 (9-15)', () => {
  it('관리자에게는 홈에 AI 진단 한 줄 — AI 진단 화면으로 가는 링크, 누르기만으로 부르지 않는다', async () => {
    localStorage.clear()
    mockApi()
    const stream = vi.spyOn(api, 'aiAnalyzeStream')
    renderDashboard()
    expect(await screen.findByRole('link', { name: /AI 포트폴리오 점검/ })).toHaveAttribute('href', '/ai/portfolio')
    expect(stream).not.toHaveBeenCalled()
  })

  it.each([
    [true, '있다'],
    [false, '없다'],
  ])('사용자 계정: 관리자가 열어 두었나(%s) — 버튼이 %s', async (open) => {
    mockApi()
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.39.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', config_problem: null,
      user: { email: 'b@example.com', name: '비', is_owner: false, status: 'active', ai_advice: open },
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthGate>
          <AppStateProvider>
            <Dashboard />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
    expect(await screen.findByText('총 평가금액')).toBeInTheDocument()
    expect(screen.queryAllByRole('link', { name: /AI 포트폴리오 점검/ })).toHaveLength(open ? 1 : 0)
  })

  it('옛 서버(ai_advice 를 안 보냄)면 사용자에게는 없다', async () => {
    mockApi()
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.36.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', config_problem: null,
      user: { email: 'b@example.com', name: '비', is_owner: false, status: 'active' },
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthGate>
          <AppStateProvider>
            <Dashboard />
          </AppStateProvider>
        </AuthGate>
      </MemoryRouter>,
    )
    expect(await screen.findByText('총 평가금액')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /AI 포트폴리오 점검/ })).toBeNull()
  })
})
