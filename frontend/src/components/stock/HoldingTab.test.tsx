import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../../AppState'
import { api } from '../../api/client'
import { clearCache } from '../../lib/cache'
import type { Holding, RebalanceRow, Stock } from '../../types'
import { HoldingTab } from './HoldingTab'

function stock(overrides: Partial<Stock> & { ticker: string }): Stock {
  return {
    name: null,
    category: null,
    market: 'US',
    currency: 'USD',
    active: true,
    added_at: '2026-01-01T00:00:00',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    sort_order: 0,
    ...overrides,
  }
}

function mockApi(stocks: Stock[], holdings: Holding[] = []) {
  vi.spyOn(api, 'listStocks').mockResolvedValue(stocks)
  vi.spyOn(api, 'listHoldings').mockResolvedValue(holdings)
  vi.spyOn(api, 'getSettings').mockResolvedValue({
    default_rebalance_band_pct: 5,
    base_currency: 'KRW',
    fx_overrides: {},
    fx: { rates: {}, is_estimate: false },
    review_period: 'quarterly',
    review_date_override: null,
    cash: {},
    cash_target_pct: 0,
  } as never)
}

function renderTab(ticker: string, onPurged = vi.fn(), row: RebalanceRow | null = null) {
  render(
    <MemoryRouter>
      <AppStateProvider>
        <HoldingTab ticker={ticker} onPurged={onPurged} row={row} />
      </AppStateProvider>
    </MemoryRouter>,
  )
  return onPurged
}

beforeEach(() => {
  vi.restoreAllMocks()
  clearCache()
})

describe('종목 안 · 보유 탭 (묶음 3 — 종목 관리 표의 줄이 여기로)', () => {
  it('수량 · 평단가 · 구분 · 목표 · 밴드를 글로 — 적은 소수를 버리지 않는다', async () => {
    mockApi(
      [stock({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW', category: '알파', target_weight_pct: 12.5 })],
      [{ ticker: '005930.KS', quantity: 12.5, avg_cost: 71234.56, avg_fx: null, updated_at: '2026-09-01T00:00:00' }],
    )
    renderTab('005930.KS')
    expect(await screen.findByText('12.5주')).toBeInTheDocument()
    // 원화 가격 자릿수(0)로 자르면 71,235 가 된다
    expect(screen.getByText('₩71,234.56')).toBeInTheDocument()
    expect(screen.getByText('알파')).toBeInTheDocument()
    expect(screen.getByText('12.5%')).toBeInTheDocument()
    expect(screen.getByText('기본값')).toBeInTheDocument()
    // 원화 종목에는 산 환율 칸이 없다
    expect(screen.queryByText('산 환율')).toBeNull()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('엔 종목의 산 환율은 100엔 값으로 — 넣을 때와 같은 단위', async () => {
    mockApi(
      [stock({ ticker: '7203.T', name: '도요타', market: 'JP', currency: 'JPY', rebalance_band_pct: 3 })],
      [{ ticker: '7203.T', quantity: 100, avg_cost: 2850, avg_fx: 9.1, updated_at: '2026-09-01T00:00:00' }],
    )
    renderTab('7203.T')
    expect(await screen.findByText('910.00 원/100엔')).toBeInTheDocument()
    expect(screen.getByText('±3.0%p')).toBeInTheDocument()
  })

  it('들고 있으면 평가금액 · 수익률(+수익금) · 지금 비중도 — 홈과 같은 응답의 줄 (사용자 확인 찾지 못한 것 5)', async () => {
    mockApi(
      [stock({ ticker: 'VOO', target_weight_pct: 18 })],
      [{ ticker: 'VOO', quantity: 40, avg_cost: 80.65, avg_fx: null, updated_at: '2026-09-01T00:00:00' }],
    )
    const row = {
      ticker: 'VOO', currency: 'USD', quantity: 40, avg_cost: 80.65, current_value_base: 5284212,
      return_pct: 21.9, unrealized_pnl: 707.6, actual_weight_pct: 17.2, target_weight_pct: 18,
    } as unknown as RebalanceRow
    renderTab('VOO', vi.fn(), row)
    expect(await screen.findByText('₩5,284,212')).toBeInTheDocument()
    expect(screen.getByText('+21.9%')).toBeInTheDocument()
    expect(screen.getByText('+$707.60')).toBeInTheDocument()
    expect(screen.getByText('17.2% / 18.0%')).toBeInTheDocument()
  })

  it('고치기는 이 종목 칸만 연다 — 다른 종목 칸이 없고, 수량 칸에 커서 (사용자 확인 막힌 곳 2)', async () => {
    mockApi(
      [stock({ ticker: 'VOO' }), stock({ ticker: 'QQQ' })],
      [{ ticker: 'QQQ', quantity: 3, avg_cost: null, avg_fx: null, updated_at: '2026-09-01T00:00:00' }],
    )
    const user = userEvent.setup()
    renderTab('QQQ')
    await user.click(await screen.findByRole('button', { name: 'QQQ 보유 고치기' }))
    const dialog = await screen.findByRole('dialog', { name: 'QQQ 수정' })
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'QQQ 보유수량' })).toHaveFocus())
    expect(within(dialog).queryByRole('textbox', { name: 'VOO 보유수량' })).toBeNull()
    expect(within(dialog).queryByText('2종목')).toBeNull()
  })

  it('종목을 지울 수 있다 — 되돌릴 수 없으니 한 번 더 묻고, 지우면 알린다', async () => {
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    mockApi([stock({ ticker: 'VOO' })])
    const user = userEvent.setup()
    const onPurged = renderTab('VOO')

    await user.click(await screen.findByRole('button', { name: 'VOO 삭제' }))
    expect(purge).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/되돌릴 수 없습니다/)).toBeInTheDocument()
    expect(within(dialog).getByText(/시세·지표는 모두가 같이 쓰는 기록이라 남겨/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '네, 지웁니다' }))
    await waitFor(() => expect(purge).toHaveBeenCalledWith('VOO'))
    await waitFor(() => expect(onPurged).toHaveBeenCalled())
  })

  it('삭제를 취소하면 아무것도 지우지 않는다', async () => {
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    mockApi([stock({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderTab('VOO')
    await user.click(await screen.findByRole('button', { name: 'VOO 삭제' }))
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(purge).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('방금 받은 종목을 새로고침하면 다시 받지 않고 언제 받았는지 알린다', async () => {
    mockApi([stock({ ticker: 'VOO' })])
    vi.spyOn(api, 'refreshStock').mockResolvedValue({
      ticker: 'VOO',
      skipped: true,
      hint: '3분 전에 받았습니다. 같은 종목은 10분에 한 번 다시 받습니다.',
    } as never)
    const user = userEvent.setup()
    renderTab('VOO')
    await user.click(await screen.findByRole('button', { name: 'VOO 시세 갱신' }))
    expect(await screen.findByText(/VOO: 3분 전에 받았습니다/)).toBeInTheDocument()
  })

  it('비활성화 — 기록은 남기고 끈다, 다시 켤 수 있다', async () => {
    const off = vi.spyOn(api, 'deactivateStock').mockResolvedValue(stock({ ticker: 'VOO', active: false }))
    mockApi([stock({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderTab('VOO')
    await user.click(await screen.findByRole('button', { name: 'VOO 비활성화' }))
    await waitFor(() => expect(off).toHaveBeenCalledWith('VOO'))
  })

  it('내 종목이 아니면 보유 대신 안내 — 손님이 링크로 들어와도 깨지지 않게', async () => {
    mockApi([stock({ ticker: 'VOO' })])
    renderTab('QQQ')
    expect(await screen.findByText(/내 종목에 없는 종목입니다/)).toBeInTheDocument()
  })
})
