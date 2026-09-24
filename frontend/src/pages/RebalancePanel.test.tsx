import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { RebalanceCurrent, RebalanceRow, RebalanceSnapshot, Settings } from '../types'
import { RebalancePanel } from './RebalancePanel'

function row(overrides: Partial<RebalanceRow> & { ticker: string }): RebalanceRow {
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

// 삼성전자 800,000원 + VOO 1,000달러(환율 1300 → 1,300,000원)
const CURRENT: RebalanceCurrent = {
  base_currency: 'KRW',
  fx: { rates: { USD: { currency: 'USD', krw_rate: 1300, source: 'stored', updated_at: null, is_estimate: false } }, is_estimate: false },
  total_value_base: 2_100_000,
  holdings_value_base: 2_100_000,
  cost_value_base: null,
  unrealized_pnl_base: null,
  cash: { amounts: {}, value_base: 0, target_pct: 0, actual_pct: 0, excess_pct: 0 },
  target_sum_pct: 100,
  review: { period: 'quarterly', next_date: '2099-12-31', due: false, override: null, last_snapshot_at: null },
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
  fx_overrides: {},
  fx: CURRENT.fx,
  review_period: 'quarterly',
  review_date_override: null,
  cash: {},
  cash_target_pct: 0,
}

function mockApi(
  current: RebalanceCurrent = CURRENT,
  settings: Settings = SETTINGS,
  snapshots: RebalanceSnapshot[] = [],
) {
  vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue(current)
  vi.spyOn(api, 'listRebalanceTargets').mockResolvedValue([])
  vi.spyOn(api, 'getSettings').mockResolvedValue(settings)
  vi.spyOn(api, 'listSnapshots').mockResolvedValue(snapshots)
  vi.spyOn(api, 'listStocks').mockResolvedValue([])
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: 'test',
    providers_by_market: { US: [], KR: [], JP: [] },
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
      fx: {
        rates: {
          USD: {
            currency: 'USD',
            krw_rate: 1350,
            source: 'fallback',
            updated_at: null,
            is_estimate: true,
          },
        },
        is_estimate: true,
      },
    })
    renderPanel()

    expect(await screen.findByText(/환율을 받아오지 못해 추정치/)).toBeInTheDocument()
  })

  it('한 통화만 쓰면 환율 경고를 띄우지 않는다', async () => {
    mockApi({
      ...CURRENT,
      fx: {
        rates: {
          USD: {
            currency: 'USD',
            krw_rate: 1350,
            source: 'fallback',
            updated_at: null,
            is_estimate: true,
          },
        },
        is_estimate: true,
      },
      rows: [CURRENT.rows[0]], // 원화 종목만
    })
    renderPanel()

    await screen.findByText('합계 (₩)')
    expect(screen.queryByText(/환율을 받아오지 못해 추정치/)).not.toBeInTheDocument()
  })

  it('일본 종목이 있으면 엔 환율 칸이 생긴다', async () => {
    mockApi({
      ...CURRENT,
      fx: {
        rates: {
          USD: { currency: 'USD', krw_rate: 1300, source: 'stored', updated_at: null, is_estimate: false },
          JPY: { currency: 'JPY', krw_rate: 9.3, source: 'stored', updated_at: null, is_estimate: false },
        },
        is_estimate: false,
      },
      rows: [...CURRENT.rows, row({ ticker: '7203.T', name: '도요타', currency: 'JPY' })],
    })
    renderPanel()

    expect(await screen.findByLabelText('원/엔 환율 직접 입력')).toBeInTheDocument()
    expect(screen.getByText(/1엔 = 9.30원/)).toBeInTheDocument()
  })

  it('일본 종목이 없으면 엔 칸은 뜨지 않는다 — 쓰지 않는 환율은 안 보여준다', async () => {
    mockApi()
    renderPanel()

    expect(await screen.findByLabelText('원/달러 환율 직접 입력')).toBeInTheDocument()
    expect(screen.queryByLabelText('원/엔 환율 직접 입력')).not.toBeInTheDocument()
  })

  it('종목이 없으면 안내를 보여준다', async () => {
    mockApi({ ...CURRENT, rows: [], total_value_base: 0 })
    renderPanel()

    expect(await screen.findByText('리밸런싱할 종목이 없습니다')).toBeInTheDocument()
  })
})

describe('리밸런싱 · 현금', () => {
  const WITH_CASH: RebalanceCurrent = {
    ...CURRENT,
    total_value_base: 3_000_000,
    cash: { amounts: { KRW: 900_000 }, value_base: 900_000, target_pct: 30, actual_pct: 30, excess_pct: 0 },
    rows: CURRENT.rows.map((r) => ({ ...r, target_weight_pct: r.ticker === 'VOO' ? 40 : 30 })),
  }

  it('목표 금액은 현금까지 더한 전체 자금 기준이다', async () => {
    mockApi(WITH_CASH, { ...SETTINGS, cash: { KRW: 900_000 }, cash_target_pct: 30 })
    renderPanel()

    // 300만 x 40% = 120만 → VOO(130만)는 -10만
    const us = await orderRow('VOO')
    expect(within(us).getByText('₩1,200,000')).toBeInTheDocument()
    expect(within(us).getByText('−₩100,000')).toBeInTheDocument()
    // 현금도 한 줄로 나온다 — 지금 90만, 목표 30%도 90만
    const cash = await orderRow('예수금')
    expect(within(cash).getAllByText('₩900,000')).toHaveLength(2)
    expect(within(cash).getByText('목표와 같습니다.')).toBeInTheDocument()
  })

  it('현금을 저장하면 통화별로 보낸다 — 비운 칸은 지운다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(SETTINGS)
    const user = userEvent.setup()
    renderPanel()

    await user.type(await screen.findByLabelText('원 현금'), '3000000')
    await user.type(screen.getByLabelText('현금 목표 비중'), '10')
    const cashCard = screen.getByLabelText('원 현금').closest('.kpi') as HTMLElement
    await user.click(within(cashCard).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update).toHaveBeenCalledWith({
      cash: { KRW: 3_000_000, USD: null },
      cash_target_pct: 10,
    })
  })

  it('새로 넣을 돈을 적으면 그 돈까지 더해 주문을 낸다 — 저장은 하지 않는다', async () => {
    mockApi({ ...CURRENT, rows: CURRENT.rows.map((r) => ({ ...r, target_weight_pct: 50 })) })
    const update = vi.spyOn(api, 'updateSettings')
    const user = userEvent.setup()
    renderPanel()

    await user.type(await screen.findByLabelText(/이번에 새로 넣을 돈/), '900000')

    // 300만 x 50% = 150만 → 삼성(80만) +70만
    const kr = await orderRow('005930.KS')
    expect(within(kr).getByText('+₩700,000')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('리밸런싱 · 평단가와 거래 입력', () => {
  const HELD: RebalanceCurrent = {
    ...CURRENT,
    rows: [
      { ...CURRENT.rows[1], avg_cost: 400, cost_value: 800, unrealized_pnl: 200, return_pct: 25 },
      CURRENT.rows[0],
    ],
  }

  it('평단가를 알면 손익을 거래 통화로 보여주고, 모르면 비워둔다', async () => {
    mockApi(HELD)
    renderPanel()

    expect(await screen.findByText('+$200.00')).toBeInTheDocument()
    expect(screen.getByText('+25.0%')).toBeInTheDocument()
    expect(screen.getByText('평단가 입력 시')).toBeInTheDocument()
  })

  it('산 것을 입력하면 수량을 더하고 평단가를 가중평균으로 저장한다', async () => {
    mockApi(HELD)
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    // VOO 2주 @400 + 2주 @500 = 4주 @450
    const [voo] = await screen.findAllByRole('button', { name: '거래 입력' })
    await user.click(voo)
    await user.type(screen.getByLabelText('VOO 거래 수량'), '2')
    const priceBox = screen.getByLabelText('VOO 거래 가격')
    await user.clear(priceBox)
    await user.type(priceBox, '500')
    await user.click(screen.getByRole('button', { name: '반영' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 4, 450))
  })

  it('판 것은 수량만 빼고, 가진 것보다 많이 팔면 막는다', async () => {
    mockApi(HELD)
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    const [voo] = await screen.findAllByRole('button', { name: '거래 입력' })
    await user.click(voo)
    await user.click(screen.getByRole('button', { name: '팔았다' }))
    expect(screen.queryByLabelText('VOO 거래 가격')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('VOO 거래 수량'), '3')
    await user.click(screen.getByRole('button', { name: '반영' }))
    expect(await screen.findByText(/보유 2주보다 많이 팔 수 없습니다/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('VOO 거래 수량'))
    await user.type(screen.getByLabelText('VOO 거래 수량'), '1')
    await user.click(screen.getByRole('button', { name: '반영' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 1, 400))
  })

  it('평단가 칸을 비워 저장하면 "모름"으로 보낸다', async () => {
    mockApi(HELD)
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    vi.spyOn(api, 'updateRebalanceTarget').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    await user.clear(await screen.findByLabelText('VOO 평단가'))
    const holdingTable = screen.getAllByRole('table')[1]
    const vooRow = within(holdingTable)
      .getAllByRole('row')
      .find((tr) => tr.textContent?.includes('VOO'))!
    await user.click(within(vooRow).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 2, null))
  })
})

describe('리밸런싱 · 리뷰와 기록', () => {
  const SNAPSHOT: RebalanceSnapshot = {
    id: 7,
    taken_at: '2026-06-30T08:00:00',
    review_date: '2026-06-30',
    base_currency: 'KRW',
    total_value_base: 2_000_000,
    note: '2분기 리뷰',
    data: {
      rows: [
        {
          ticker: 'VOO',
          name: null,
          currency: 'USD',
          quantity: 2,
          avg_cost: 400,
          last_close: 480,
          current_value: 960,
          current_value_base: 1_248_000,
          target_weight_pct: 60,
          actual_weight_pct: 62.4,
          excess_pct: 2.4,
          return_pct: 20,
        },
      ],
      cash: { amounts: {}, value_base: 0, target_pct: 0, actual_pct: 0, excess_pct: 0 },
      fx: { USD: 1300 },
    },
  }

  it('리뷰할 때면 그렇게 알리고, 기록을 남기면 메모와 함께 보낸다', async () => {
    mockApi({
      ...CURRENT,
      review: { period: 'quarterly', next_date: '2026-09-30', due: true, override: null, last_snapshot_at: null },
    })
    const create = vi.spyOn(api, 'createSnapshot').mockResolvedValue(SNAPSHOT)
    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByText('리뷰할 때')).toBeInTheDocument()
    await user.type(screen.getByLabelText('기록 메모'), '3분기 리뷰')
    await user.click(screen.getByRole('button', { name: '지금 상태 기록하기' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith('3분기 리뷰'))
  })

  it('리뷰 주기를 바꾸면 바로 저장한다', async () => {
    mockApi()
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(SETTINGS)
    const user = userEvent.setup()
    renderPanel()

    await user.selectOptions(await screen.findByLabelText('리뷰 주기'), '연 1회')
    await waitFor(() => expect(update).toHaveBeenCalledWith({ review_period: 'annual' }))
  })

  it('지난 기록을 펼쳐 그날의 비중과 수익률을 본다', async () => {
    mockApi(CURRENT, SETTINGS, [SNAPSHOT])
    renderPanel()

    expect(await screen.findByText('2분기 리뷰')).toBeInTheDocument()
    expect(screen.getByText('62.4% (60.0%)')).toBeInTheDocument()
    expect(screen.getByText('+20.0%')).toBeInTheDocument()
  })

  it('기록 삭제는 한 번 더 묻는다', async () => {
    mockApi(CURRENT, SETTINGS, [SNAPSHOT])
    const remove = vi.spyOn(api, 'deleteSnapshot').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: '기록 삭제' }))
    expect(remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: '네, 지웁니다' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7))
  })
})
