import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { RebalanceCurrent, RebalanceRow, RebalanceSnapshot, Settings } from '../types'
import { forgetPhone, pretendPhone } from '../test/phone'
import { HIDE_AMOUNTS_KEY, resetPrefs } from '../lib/prefs'
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
    // 파는 주문은 매도 색 — 가격 오르내림 색(상승 색 설정)을 따르지 않는다 (8-4)
    const adjust = within(us).getByText(/^−?-?₩40,000$/).closest('td')!
    expect(adjust).toHaveClass('tone-sell')
    expect(adjust).not.toHaveClass('down')
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
    const holdings = screen.getByRole('region', { name: /보유 · 목표 비중/ })
    expect(within(holdings).getByText('+25.0%')).toBeInTheDocument()
    expect(within(holdings).getByText('평단가 입력 시')).toBeInTheDocument()
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

    // 외화 종목이라 산 환율도 같이 — 들고 있던 몫의 환율을 모르니 평균을 지어내지 않는다
    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 4, 450, null))
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
    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 1, 400, null))
  })

  it('평단가 칸을 비워 저장하면 "모름"으로 보낸다', async () => {
    mockApi(HELD)
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    vi.spyOn(api, 'updateRebalanceTarget').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    await user.clear(await screen.findByLabelText('VOO 평단가'))
    await user.click(screen.getByRole('button', { name: '바뀐 1줄 저장' }))

    // 산 환율은 안 고쳤으니 보내지 않는다(undefined) — 보낸 것만 바뀐다
    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 2, null, undefined))
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

/* ---------- 8-3 — 답을 먼저 · 한 번에 저장 · 산 환율 · 폰 카드 ---------- */

describe('리밸런싱 · 답을 먼저 (ROADMAP 8-3)', () => {
  it('순서는 요약 → 주문 가이드 → 보유·목표 → 기록 → 설정(접힘)', async () => {
    mockApi()
    const { container } = renderPanel()
    await screen.findByRole('region', { name: '주문 가이드' })
    const order = Array.from(container.querySelectorAll('[aria-label="내 자산"], section h3, details summary h3')).map(
      (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
    )
    expect(order).toEqual(['내 자산', '주문 가이드', '보유 · 목표 비중', '리뷰 · 기록', '설정'])
    expect(container.querySelector('details.settings-fold')).not.toHaveAttribute('open')
  })

  it('요약 숫자는 대시보드 맨 위 한 줄과 같다', async () => {
    mockApi({ ...CURRENT, day_change_base: 13_000, day_change_pct: 0.62 })
    renderPanel()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).toHaveTextContent('₩2,100,000')
    expect(line).toHaveTextContent('+₩13,000 +0.62%')
    // 리밸런싱에서는 신호 수를 따로 세지 않는다 (주문 가이드 머리에 있다)
    expect(within(line).queryByText('신호')).not.toBeInTheDocument()
  })

  it('목표 합계가 100 이 아니면 주문 가이드 위에서 알린다', async () => {
    mockApi({ ...CURRENT, rows: CURRENT.rows.map((r) => ({ ...r, target_weight_pct: 30 })) })
    renderPanel()
    expect(await screen.findByText(/목표 비중 합계가 60.0%입니다/)).toBeInTheDocument()
  })
})

describe('리밸런싱 · 금액 가리기 (9-3)', () => {
  afterEach(() => {
    localStorage.removeItem(HIDE_AMOUNTS_KEY)
    resetPrefs()
  })

  it('대시보드에서 가려 두었으면 여기 요약·주문 가이드 금액도 가린다 — 주수와 %는 남는다', async () => {
    localStorage.setItem(HIDE_AMOUNTS_KEY, '1')
    resetPrefs()
    mockApi()
    renderPanel()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).not.toHaveTextContent('₩2,100,000')
    expect(within(line).getByRole('button', { name: '금액 보기' })).toBeInTheDocument()
    const us = await orderRow('VOO')
    expect(us).not.toHaveTextContent('₩1,300,000')
    expect(us).not.toHaveTextContent('₩40,000')
    expect(within(us).getByText(/-0\.06주/)).toBeInTheDocument()
    expect(screen.queryByText('₩2,100,000')).not.toBeInTheDocument()

    // 여기서 풀면 여기 표도 바로 풀린다
    await userEvent.click(within(line).getByRole('button', { name: '금액 보기' }))
    expect(await orderRow('VOO')).toHaveTextContent('₩1,300,000')
  })
})

describe('리밸런싱 · 보유·목표는 한 번에 저장', () => {
  it('고친 줄에 표시가 붙고, 아래에 "바뀐 N줄 저장 · 되돌리기"가 뜬다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderPanel()
    expect(screen.queryByRole('button', { name: /줄 저장/ })).not.toBeInTheDocument()

    await user.clear(await screen.findByLabelText('VOO 보유수량'))
    await user.type(screen.getByLabelText('VOO 보유수량'), '3')
    await user.clear(screen.getByLabelText('005930.KS 목표 비중'))
    await user.type(screen.getByLabelText('005930.KS 목표 비중'), '45')

    expect(screen.getByRole('button', { name: '바뀐 2줄 저장' })).toBeInTheDocument()
    expect(screen.getByLabelText('VOO 보유수량').closest('tr')).toHaveClass('dirty')

    await user.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(screen.getByLabelText('VOO 보유수량')).toHaveValue('2')
    expect(screen.queryByRole('button', { name: /줄 저장/ })).not.toBeInTheDocument()
  })

  it('고친 것만 보낸다 — 수량만 고친 줄은 목표를, 목표만 고친 줄은 보유를 보내지 않는다', async () => {
    mockApi()
    const holding = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const target = vi.spyOn(api, 'updateRebalanceTarget').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    await user.clear(await screen.findByLabelText('VOO 보유수량'))
    await user.type(screen.getByLabelText('VOO 보유수량'), '3')
    await user.clear(screen.getByLabelText('005930.KS 목표 비중'))
    await user.type(screen.getByLabelText('005930.KS 목표 비중'), '45')
    await user.click(screen.getByRole('button', { name: '바뀐 2줄 저장' }))

    await waitFor(() => expect(holding).toHaveBeenCalledTimes(1))
    expect(holding).toHaveBeenCalledWith('VOO', 3, null, undefined)
    expect(target).toHaveBeenCalledTimes(1)
    expect(target).toHaveBeenCalledWith('005930.KS', { target_weight_pct: 45, rebalance_band_pct: null })
  })

  it('중간에 실패한 줄은 고치던 값을 남기고, 나머지는 저장한다', async () => {
    mockApi()
    vi.spyOn(api, 'updateHolding').mockImplementation(async (ticker) => {
      if (ticker === 'VOO') throw new Error('저장 실패')
      return {} as never
    })
    const user = userEvent.setup()
    renderPanel()

    await user.clear(await screen.findByLabelText('VOO 보유수량'))
    await user.type(screen.getByLabelText('VOO 보유수량'), '3')
    await user.clear(screen.getByLabelText('005930.KS 보유수량'))
    await user.type(screen.getByLabelText('005930.KS 보유수량'), '12')
    await user.click(screen.getByRole('button', { name: '바뀐 2줄 저장' }))

    // 다시 받아 온 뒤에도 — 성공한 줄은 서버 값(여기서는 그대로 10), 실패한 줄은 고치던 3
    expect(await screen.findByText(/저장 실패/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('005930.KS 보유수량')).toHaveValue('10'))
    expect(screen.getByLabelText('VOO 보유수량')).toHaveValue('3')
    expect(screen.getByRole('button', { name: '바뀐 1줄 저장' })).toBeInTheDocument()
  })
})

describe('리밸런싱 · 산 환율과 환율 효과', () => {
  const JP: RebalanceCurrent = {
    ...CURRENT,
    fx: {
      rates: {
        USD: { currency: 'USD', krw_rate: 1300, source: 'stored', updated_at: null, is_estimate: false },
        JPY: { currency: 'JPY', krw_rate: 9.3, source: 'stored', updated_at: null, is_estimate: false },
      },
      is_estimate: false,
    },
    rows: [
      { ...CURRENT.rows[1], avg_cost: 400, avg_fx: 1250 },
      row({ ticker: '7203.T', name: '도요타', currency: 'JPY', quantity: 100, avg_cost: 2500, avg_fx: 9.1, last_close: 3000 }),
      CURRENT.rows[0],
    ],
  }

  it('외화 종목에만 산 환율 칸이 있고, 엔은 100엔 단위로 받아 1엔 값으로 보낸다', async () => {
    mockApi(JP)
    const holding = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByLabelText('VOO 산 환율')).toHaveValue('1,250')
    expect(screen.getByLabelText('7203.T 산 환율')).toHaveValue('910')
    expect(screen.queryByLabelText('005930.KS 산 환율')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('7203.T 산 환율'))
    await user.type(screen.getByLabelText('7203.T 산 환율'), '920')
    await user.click(screen.getByRole('button', { name: '바뀐 1줄 저장' }))
    await waitFor(() => expect(holding).toHaveBeenCalledWith('7203.T', 100, 2500, 9.2))
  })

  it('원화 종목만 있으면 산 환율 칸도 환율 효과 설정도 없다', async () => {
    mockApi({ ...CURRENT, rows: [CURRENT.rows[0]] })
    renderPanel()
    await screen.findByRole('region', { name: '주문 가이드' })
    expect(screen.queryByText('산 환율')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('수익률에 환율 효과 포함')).not.toBeInTheDocument()
  })

  it('외화 종목을 사면 그날 환율(기본은 지금 환율)로 산 환율을 금액 가중 평균한다', async () => {
    mockApi(JP)
    const holding = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    const vooRow = (await screen.findByLabelText('VOO 보유수량')).closest('tr') as HTMLElement
    await user.click(within(vooRow).getByRole('button', { name: '거래 입력' }))
    expect(screen.getByLabelText('VOO 산 날 환율')).toHaveValue('1,300')
    await user.type(screen.getByLabelText('VOO 거래 수량'), '2')
    await user.clear(screen.getByLabelText('VOO 거래 가격'))
    await user.type(screen.getByLabelText('VOO 거래 가격'), '500')
    await user.clear(screen.getByLabelText('VOO 산 날 환율'))
    await user.type(screen.getByLabelText('VOO 산 날 환율'), '1400')
    await user.click(screen.getByRole('button', { name: '반영' }))

    // (2×400×1250 + 2×500×1400) ÷ (800 + 1000) = 2,400,000 ÷ 1,800
    await waitFor(() => expect(holding).toHaveBeenCalled())
    const [ticker, quantity, cost, fx] = holding.mock.calls[0]
    expect([ticker, quantity, cost]).toEqual(['VOO', 4, 450])
    expect(fx).toBeCloseTo(2_400_000 / 1_800, 9)
  })

  it('환율 효과는 원 기준일 때만 켤 수 있다', async () => {
    mockApi(JP, { ...SETTINGS, include_fx_effect: false })
    let answer: (value: Settings) => void = () => {}
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockReturnValue(new Promise<Settings>((resolve) => (answer = resolve)))
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByLabelText('수익률에 환율 효과 포함'))
    expect(update).toHaveBeenCalledWith({ include_fx_effect: true })
    // 서버가 답하기 전에도 켜진 것으로 보인다 — 다시 받을 때까지 꺼진 채로 있으면 안 눌린 것 같다
    expect(screen.getByLabelText('수익률에 환율 효과 포함')).toBeChecked()
    vi.spyOn(api, 'getSettings').mockResolvedValue({ ...SETTINGS, include_fx_effect: true })
    answer({ ...SETTINGS, include_fx_effect: true })
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    expect(screen.getByLabelText('수익률에 환율 효과 포함')).toBeChecked()
  })

  it('켜기가 실패하면 원래대로 돌아가고 이유를 보인다', async () => {
    mockApi(JP, { ...SETTINGS, include_fx_effect: false })
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new Error('환율 효과 저장 실패'))
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByLabelText('수익률에 환율 효과 포함'))
    expect(await screen.findByText(/환율 효과 저장 실패/)).toBeInTheDocument()
    expect(screen.getByLabelText('수익률에 환율 효과 포함')).not.toBeChecked()
  })

  it('달러 기준이면 흐리게 두고 이유를 적는다', async () => {
    mockApi({ ...JP, base_currency: 'USD' }, { ...SETTINGS, base_currency: 'USD', include_fx_effect: true })
    renderPanel()
    expect(await screen.findByLabelText('수익률에 환율 효과 포함')).toBeDisabled()
    expect(screen.getByText(/기준통화가 원일 때만 켤 수 있습니다/)).toBeInTheDocument()
  })

  it('환율 효과를 넣은 줄은 원화 손익으로 보인다', async () => {
    const rows = JP.rows.map((r) =>
      r.ticker === 'VOO' ? { ...r, unrealized_pnl: 200, shown_pnl: 300_000, shown_return_pct: 30, shown_currency: 'KRW' as const } : r,
    )
    mockApi({ ...JP, rows, include_fx_effect: true })
    renderPanel()
    const holdings = await screen.findByRole('region', { name: /보유 · 목표 비중/ })
    expect(within(holdings).getByText('+₩300,000')).toBeInTheDocument()
    expect(within(holdings).getByText('+30.0%')).toBeInTheDocument()
  })
})

describe('리밸런싱 · 폰', () => {
  beforeEach(() => {
    pretendPhone()
  })
  afterEach(() => forgetPhone())

  it('주문 가이드는 종목마다 카드 한 장 — 가로로 넘치는 표가 없다', async () => {
    const rows = CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20 } : r))
    mockApi({ ...CURRENT, rows })
    renderPanel()
    const guide = await screen.findByRole('region', { name: '주문 가이드' })
    expect(within(guide).queryByRole('table')).not.toBeInTheDocument()
    const cards = within(guide).getAllByRole('listitem')
    // VOO: 목표 20% x 210만 = 42만 → 88만원 팔기 = $676.92 → 500달러 종가로 1.35주
    // 삼성: 목표 40% = 84만 → 4만원 사기 = 8만원 종가로 0.5주
    expect(cards.map((c) => c.querySelector('b')?.textContent)).toEqual(['삼성전자 0.5주 사기', 'VOO 1.35주 팔기', '현금'])
    expect(cards[1]).toHaveTextContent('과중 +41.9%p')
    expect(cards[1]).toHaveTextContent('61.9% → 목표 20%')
  })

  it('보유·목표도 카드 — 칸마다 이름이 붙는다', async () => {
    mockApi()
    renderPanel()
    const holdings = await screen.findByRole('region', { name: /보유 · 목표 비중/ })
    expect(within(holdings).queryByRole('table')).not.toBeInTheDocument()
    expect(within(holdings).getByLabelText('VOO 보유수량').closest('label')).toHaveTextContent('보유수량')
  })
})
