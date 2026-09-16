import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { RebalanceCurrent, RebalanceRow, Settings } from '../types'
import { RebalancePanel } from './RebalancePanel'

function row(overrides: Partial<RebalanceRow> & { ticker: string }): RebalanceRow {
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

// 삼성전자 800,000원 + VOO 1,000달러(환율 1300 → 1,300,000원)
const CURRENT: RebalanceCurrent = {
  base_currency: 'KRW',
  fx: { usd_krw: 1300, source: 'stored', updated_at: null, is_estimate: false },
  total_value_base: 2_100_000,
  rows: [
    row({
      ticker: '005930.KS',
      name: '삼성전자',
      currency: 'KRW',
      target_weight_pct: 40,
      actual_weight_pct: 38.1,
      quantity: 10,
      last_close: 80_000,
      current_value: 800_000,
      current_value_base: 800_000,
    }),
    row({
      ticker: 'VOO',
      currency: 'USD',
      target_weight_pct: 60,
      actual_weight_pct: 61.9,
      quantity: 2,
      last_close: 500,
      current_value: 1_000,
      current_value_base: 1_300_000,
    }),
  ],
}

const SETTINGS: Settings = {
  default_rebalance_band_pct: 5,
  base_currency: 'KRW',
  usd_krw_override: null,
  fx: CURRENT.fx,
}

function mockApi(current: RebalanceCurrent = CURRENT, settings: Settings = SETTINGS) {
  vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue(current)
  vi.spyOn(api, 'listRebalanceTargets').mockResolvedValue([])
  vi.spyOn(api, 'listHoldings').mockResolvedValue([])
  vi.spyOn(api, 'getSettings').mockResolvedValue(settings)
  vi.spyOn(api, 'listStocks').mockResolvedValue([])
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: 'test',
    providers: [],
    providers_by_market: { US: [], KR: [] },
  })
}

function renderPanel() {
  return render(
    <AppStateProvider>
      <RebalancePanel />
    </AppStateProvider>,
  )
}

/** 주문 가이드 표에서 티커로 행을 찾는다 (아래 설정 표에도 같은 티커가 있으므로 범위를 좁힌다) */
async function orderRow(ticker: string) {
  const guide = (await screen.findAllByRole('table'))[0]
  const row = within(guide)
    .getAllByRole('row')
    .find((tr) => tr.textContent?.includes(ticker))
  if (!row) throw new Error(`주문 가이드에 ${ticker} 행이 없습니다`)
  return row
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('리밸런싱 · 통화 표기', () => {
  it('국내 종목은 원화로, 해외 종목은 기준통화 환산 + 현지 금액을 함께 보여준다', async () => {
    mockApi()
    renderPanel()

    const kr = await orderRow('005930.KS')
    expect(within(kr).getByText('₩800,000')).toBeInTheDocument()
    // 원화 종목은 환산할 게 없으므로 "현지" 병기가 없다
    expect(within(kr).queryByText(/현지/)).not.toBeInTheDocument()

    const us = await orderRow('VOO')
    expect(within(us).getByText('₩1,300,000')).toBeInTheDocument()
    expect(within(us).getByText(/현지 \$1,000\.00/)).toBeInTheDocument()
  })

  it('주문 주수는 현지 종가로 계산한다', async () => {
    mockApi()
    renderPanel()

    // 목표 60% x 210만 = 126만 → 조정 -4만원 = -30.77달러 → 500달러 종가로 -0.06주
    const us = await orderRow('VOO')
    expect(within(us).getByText(/-0\.06주/)).toBeInTheDocument()
  })

  it('합계는 기준통화 하나로만 더한다', async () => {
    mockApi()
    renderPanel()

    expect(await screen.findByText('합계 (₩)')).toBeInTheDocument()
    // 원화 80만 + 달러 1000을 그냥 더했다면 ₩801,000이 나왔을 것이다
    expect(screen.getAllByText('₩2,100,000').length).toBeGreaterThan(0)
    expect(screen.queryByText('₩801,000')).not.toBeInTheDocument()
  })

  it('적용 중인 환율과 출처를 밝힌다', async () => {
    mockApi()
    renderPanel()
    expect(await screen.findByText(/1달러 = 1,300.00원 · 자동 조회값/)).toBeInTheDocument()
  })

  it('환율이 추정치면 통화가 섞였을 때 경고한다', async () => {
    mockApi({
      ...CURRENT,
      fx: { usd_krw: 1350, source: 'fallback', updated_at: null, is_estimate: true },
    })
    renderPanel()

    expect(await screen.findByText(/환율을 받아오지 못해 추정치/)).toBeInTheDocument()
  })

  it('한 통화만 쓰면 환율 경고를 띄우지 않는다', async () => {
    mockApi({
      ...CURRENT,
      fx: { usd_krw: 1350, source: 'fallback', updated_at: null, is_estimate: true },
      rows: [CURRENT.rows[0]], // 원화 종목만
    })
    renderPanel()

    await screen.findByText('합계 (₩)')
    expect(screen.queryByText(/환율을 받아오지 못해 추정치/)).not.toBeInTheDocument()
  })

  it('종목이 없으면 안내를 보여준다', async () => {
    mockApi({ ...CURRENT, rows: [], total_value_base: 0 })
    renderPanel()

    expect(await screen.findByText('리밸런싱할 종목이 없습니다')).toBeInTheDocument()
  })
})
