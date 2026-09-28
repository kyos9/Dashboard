import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { DashboardCard } from '../types'

// 차트 조각이 끝내 안 오는 상황 — 느린 폰에서 처음 누른 순간과 같다 (ROADMAP 8-1)
const preload = vi.fn()
vi.mock('../lib/chartChunk', () => ({
  ChartModal: lazy(() => new Promise<never>(() => {})),
  preloadChartModal: () => preload(),
}))

const { Dashboard } = await import('./Dashboard')

const CARD: DashboardCard = {
  ticker: 'VOO',
  name: 'Vanguard S&P 500 ETF',
  category: null,
  market: 'US',
  currency: 'USD',
  data_stale: false,
  price_source: 'yahoo',
  indicators: { date: '2026-09-25', close: 500, prev_close: 498, change_pct: 0.4 },
  knee_buy_v2: false,
  knee_conditions: {},
  shoulder_sell_ref: false,
  last_buy_signal_date: null,
  rebalance_signal: { active: false, reasons: [] },
  data_status: null,
} as unknown as DashboardCard

function mockApi() {
  vi.spyOn(api, 'getDashboard').mockResolvedValue([CARD])
  vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue({
    base_currency: 'USD',
    fx: { rates: {}, estimated: false, overridden: [] },
    total_value_base: 0,
    holdings_value_base: 0,
    cost_value_base: null,
    unrealized_pnl_base: null,
    cash: { amounts: {}, value_base: 0, target_pct: 0, actual_pct: 0, excess_pct: 0 },
    target_sum_pct: 0,
    review: { period: 'quarterly', next_date: '2026-09-30', due: false, override: null, last_snapshot_at: null },
    rows: [],
  } as never)
  vi.spyOn(api, 'listStocks').mockResolvedValue([
    { ticker: 'VOO', name: CARD.name, category: null, market: 'US', currency: 'USD', active: true } as never,
  ])
  vi.spyOn(api, 'getMacroPinned').mockResolvedValue({ codes: [], series: [], badges: [] })
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

describe('차트 조각을 받는 동안', () => {
  // 시그널 보기의 표 — 포트폴리오 보기의 이름 칸도 같은 팝업을 연다 (Dashboard.portfolio.test.tsx)
  beforeEach(() => localStorage.setItem('dashboard.view', 'signal'))

  it('누르자마자 제목과 닫기가 있는 팝업 틀이 뜨고, 닫을 수 있다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: 'VOO' }))
    const dialog = screen.getByRole('dialog', { name: 'VOO' })
    expect(dialog).toHaveAttribute('aria-busy', 'true')

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('표가 그려지면 차트 조각을 미리 받아 둔다', async () => {
    mockApi()
    preload.mockClear()
    renderDashboard()
    await screen.findByRole('button', { name: 'VOO' })
    await waitFor(() => expect(preload).toHaveBeenCalled())
  })
})
