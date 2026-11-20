/**
 * PC 홈 (디자인 5차 목업 01 · 02 — 주인이 고른 것).
 * 총액 A · AI 띠 · 보기 탭(보유 종목 · 관심 종목 · 시그널) · 정렬 기호 · ₩/$ · ⋯(종목 추가 · 종목 수정) · 시그널 탭(목록 + 카드 셋).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { resetPrefs } from '../../lib/prefs'
import type { DashboardCard, LatestIndicators, RebalanceCurrent, RebalanceRow, Stock } from '../../types'
import { DesktopHome } from './DesktopHome'

const IND: LatestIndicators = {
  date: '2026-11-19',
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
  card({
    ticker: 'SCHD',
    indicators: { ...IND, close: 42.6, minus_di: 27.4, plus_di: 15.1, disparity: -4.2, vol_ratio: 1.3, adx: 26.8, ma50: 45 },
    knee_buy_v2: true,
    buy_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: true, adx_trending: true },
    sell_conditions: { above_ma50: false, adx_rising: false, volume_strong: true },
    last_buy_signal_date: '2026-11-19',
  }),
  card({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW' }),
  card({ ticker: 'NVDA', buy_conditions: { di_bearish: true, disparity_negative: true, volatility_or_volume: false, adx_trending: false } }),
]

const ROWS: RebalanceRow[] = [
  row({
    ticker: 'SCHD',
    quantity: 100,
    avg_cost: 40.47,
    last_close: 42.6,
    current_value: 4260,
    current_value_base: 5_900_000,
    shown_pnl: 213,
    shown_return_pct: 5.3,
    shown_currency: 'USD',
    unrealized_pnl: 213,
    return_pct: 5.3,
    actual_weight_pct: 1.4,
    target_weight_pct: 6,
    excess_pct: -4.6,
  }),
  row({
    ticker: '005930.KS',
    name: '삼성전자',
    currency: 'KRW',
    quantity: 1500,
    avg_cost: 49_104,
    last_close: 45_467,
    current_value: 68_200_500,
    current_value_base: 68_200_500,
    shown_pnl: -5_456_040,
    shown_return_pct: -7.4,
    shown_currency: 'KRW',
    unrealized_pnl: -5_456_040,
    return_pct: -7.4,
    actual_weight_pct: 13.2,
    target_weight_pct: 10,
    excess_pct: 3.2,
  }),
  // 보유 0 — 관심 종목
  row({ ticker: 'NVDA', last_close: 682.56, change_pct: -1.91 }),
]

const CURRENT: RebalanceCurrent = {
  base_currency: 'KRW',
  fx: { rates: {}, is_estimate: false },
  total_value_base: 517_690_260,
  holdings_value_base: 517_690_260,
  cost_value_base: 460_000_000,
  unrealized_pnl_base: 56_816_577,
  cash: { amounts: {}, value_base: 0, target_pct: 0, actual_pct: 0, excess_pct: 0 },
  target_sum_pct: 100,
  review: { period: 'quarterly', next_date: '2099-12-30', due: false, override: null, last_snapshot_at: null },
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

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderHome(props: Partial<Parameters<typeof DesktopHome>[0]> = {}, at = '/') {
  const onSaved = vi.fn()
  const onThresholds = vi.fn()
  const onChart = vi.fn()
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <DesktopHome
                current={CURRENT}
                cards={CARDS}
                stocks={CARDS.map(stockOf)}
                canEditThresholds
                onThresholds={onThresholds}
                onChart={onChart}
                onSaved={onSaved}
                onError={vi.fn()}
                {...props}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return { onSaved, onThresholds, onChart }
}

function headers(table: HTMLElement) {
  return within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent?.trim())
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  resetPrefs()
})

describe('맨 위', () => {
  it('총액은 큰 금액 · 손익(수익률) · 다음 리뷰 "M월 D일 (D-n)" — 최근 거래일 대비 · 리밸런싱 바로가기는 없다', () => {
    renderHome()
    const sum = screen.getByRole('region', { name: '내 자산' })
    expect(sum).toHaveTextContent('₩517,690,260')
    expect(sum).toHaveTextContent('+₩56,816,577 (+12.4%)')
    expect(sum).toHaveTextContent(/12월 30일 \(D-\d+\)/)
    expect(sum).toHaveTextContent('다음 리뷰 (분기마다)')
    expect(sum).not.toHaveTextContent('최근 거래일')
    expect(within(sum).queryByRole('link', { name: '리밸런싱' })).not.toBeInTheDocument()
  })

  it('AI 띠는 점검을 쓸 수 있는 사람에게만 — 누르기만으로 부르지 않고 AI 화면으로 간다', () => {
    renderHome({ canAdvise: true })
    const band = screen.getByRole('region', { name: 'AI 포트폴리오 점검' })
    expect(within(band).getByRole('link', { name: '점검하기' })).toHaveAttribute('href', '/ai/portfolio')
  })

  it('AI 띠는 점검을 못 쓰면 없다', () => {
    renderHome({ canAdvise: false })
    expect(screen.queryByRole('region', { name: 'AI 포트폴리오 점검' })).not.toBeInTheDocument()
  })
})

describe('보유 종목 탭', () => {
  it('열 순서는 종목 · 현재가 · 수익률 · 평가금액 · 평가손익 · 비중 · 신호, 제목은 한 줄 이름만', () => {
    renderHome()
    const table = screen.getByRole('table')
    expect(headers(table)).toEqual(['종목', '현재가', '수익률', '평가금액', '평가손익', '비중', '신호'])
  })

  it('현재가 아래 평단가, 비중은 현재와 목표를 한 칸에 — 보유 0 은 관심 종목 탭으로', () => {
    renderHome()
    const table = screen.getByRole('table')
    const samsung = within(table).getByText('삼성전자').closest('tr')!
    expect(samsung).toHaveTextContent('₩45,467')
    expect(samsung).toHaveTextContent('₩49,104')
    expect(samsung).toHaveTextContent('13.2%')
    expect(samsung).toHaveTextContent('목표 10%')
    expect(within(table).queryByText('NVDA')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /관심 종목/ })).toHaveTextContent('1')
  })

  it('정렬은 글 없이 기호 하나 — 누르면 고르는 메뉴, 고른 것을 기억한다', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: '정렬' }))
    await user.click(screen.getByRole('menuitemradio', { name: '수익률' }))
    const names = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((tr) => tr.querySelector('.stock-name')?.textContent)
    expect(names).toEqual(['SCHD', '삼성전자'])
    expect(localStorage.getItem('dashboard.sort')).toContain('return')
  })

  it('신호 배지를 누르면 시그널 탭에서 그 종목을 연다', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: /SCHD 신호/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('view=signal')
    expect(screen.getByTestId('where')).toHaveTextContent('ticker=SCHD')
    expect(screen.getByRole('article', { name: 'SCHD 신호' })).toBeInTheDocument()
  })
})

describe('⋯ 메뉴', () => {
  it('종목 추가 · 종목 수정 둘 — 거래소 목록 갱신 · 재무 한눈에 · 순서 바꾸기는 없다', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: '종목 메뉴' }))
    const menu = screen.getByRole('menu', { name: '종목 메뉴' })
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['종목 추가', '종목 수정'])
  })

  it('종목 수정 — 고른 종목만 "수정" 창에 나온다', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: '종목 메뉴' }))
    await user.click(screen.getByRole('menuitem', { name: '종목 수정' }))
    await user.click(screen.getByRole('checkbox', { name: '삼성전자 고르기' }))
    await user.click(screen.getByRole('button', { name: '수정 (1)' }))
    const dialog = screen.getByRole('dialog', { name: '수정' })
    expect(dialog).toHaveTextContent('삼성전자')
    expect(dialog).not.toHaveTextContent('SCHD')
  })

  it('고른 종목 삭제는 한 번 더 묻고, 지우면 다시 받는다', async () => {
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { onSaved } = renderHome()
    await user.click(screen.getByRole('button', { name: '종목 메뉴' }))
    await user.click(screen.getByRole('menuitem', { name: '종목 수정' }))
    await user.click(screen.getByRole('checkbox', { name: 'SCHD 고르기' }))
    await user.click(screen.getByRole('button', { name: '삭제' }))
    expect(purge).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '지우기' }))
    expect(purge).toHaveBeenCalledWith('SCHD')
    expect(onSaved).toHaveBeenCalled()
  })
})

describe('관심 종목 탭', () => {
  it('현재가 · 전일 대비 · 매수 조건(몇 개 채웠나) · 신호 · 마지막 매수 신호 — 나라 · 코드는 없다', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('tab', { name: /관심 종목/ }))
    const table = screen.getByRole('table')
    expect(headers(table)).toEqual(['종목', '현재가', '전일 대비', '매수 조건', '신호', '마지막 매수 신호'])
    const nvda = within(table).getByText('NVDA').closest('tr')!
    expect(within(nvda).getByLabelText('매수 조건 4개 중 2개')).toBeInTheDocument()
    expect(nvda).not.toHaveTextContent('미국')
  })
})

describe('시그널 탭', () => {
  it('왼쪽 신호 뜬 종목 목록, 오른쪽 매수 조건 · 매도 조건 · 비중 카드 — 지금 값만', () => {
    renderHome({}, '/?view=signal')
    const list = screen.getByRole('listbox', { name: '신호가 뜬 종목' })
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    const detail = screen.getByRole('article', { name: 'SCHD 신호' })
    const buy = within(detail).getByRole('region', { name: '매수 조건' })
    expect(buy).toHaveTextContent('4 / 4')
    expect(buy).toHaveTextContent(/4\.2%/)
    expect(within(detail).getByRole('region', { name: '매도 조건' })).toHaveTextContent('1 / 3')
    expect(within(detail).getByRole('region', { name: '비중' })).toHaveTextContent('목표와 차이')
    expect(detail).not.toHaveTextContent('기준')
  })

  it('"기준" 단추(글씨만)가 시그널 기준 창을 연다', async () => {
    const user = userEvent.setup()
    const { onThresholds } = renderHome({}, '/?view=signal')
    await user.click(screen.getByRole('button', { name: '기준' }))
    expect(onThresholds).toHaveBeenCalled()
  })
})
