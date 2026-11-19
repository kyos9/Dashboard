import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api } from '../api/client'
import type { RebalanceCurrent, RebalanceRow, RebalanceSnapshot, Settings, Stock } from '../types'
import { forgetPhone, pretendPhone } from '../test/phone'
import { HIDE_AMOUNTS_KEY, resetPrefs } from '../lib/prefs'
import { RebalancePanel, ValueRecordLine } from './RebalancePanel'

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
  // 빈 화면의 "종목 추가하러 가기"가 링크라 Router 안에서 그린다 (디자인 2차)
  return render(
    <MemoryRouter>
      <AppStateProvider>
        <RebalancePanel />
      </AppStateProvider>
    </MemoryRouter>,
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

/** PC 표 한 줄의 주문 — 글씨 "사기·팔기"는 화면에서 뺐고(디자인 4차 12c) 읽기 프로그램용 이름에 남는다 */
function act(tr: HTMLElement) {
  return tr.querySelector('.order-shares')?.getAttribute('aria-label') ?? ''
}

/** 주문 아래 목록 한 장(목업 12d α)의 "목표 · 밴드 고치기"로 시트를 연다 */
async function openTargets(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^목표 · 밴드 고치기/ }))
  return screen.getByRole('dialog', { name: '목표 비중 · 밴드 고치기' })
}

/** 설정 · 리뷰 기록은 화면 밖 시트(목업 12d A) — 목록에서 연다 */
async function openSheet(name: RegExp, dialog: string) {
  await userEvent.setup().click(await screen.findByRole('button', { name }))
  return screen.getByRole('dialog', { name: dialog })
}
const openSettings = () => openSheet(/^리밸런싱 설정/, '리밸런싱 설정')
const openRecords = () => openSheet(/^리뷰 · 기록/, '리뷰 · 기록')

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
    expect(within(us).getByText(/−1주 미만 \(0\.06주\)/)).toBeInTheDocument()
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
    await openSettings()
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
    await openSettings()

    expect(await screen.findByLabelText('원/엔 환율 직접 입력')).toBeInTheDocument()
    expect(screen.getByText(/1엔 = 9.30원/)).toBeInTheDocument()
  })

  it('일본 종목이 없으면 엔 칸은 뜨지 않는다 — 쓰지 않는 환율은 안 보여준다', async () => {
    mockApi()
    renderPanel()
    await openSettings()

    expect(await screen.findByLabelText('원/달러 환율 직접 입력')).toBeInTheDocument()
    expect(screen.queryByLabelText('원/엔 환율 직접 입력')).not.toBeInTheDocument()
  })

  it('종목이 없으면 안내를 보여준다', async () => {
    mockApi({ ...CURRENT, rows: [], total_value_base: 0 })
    renderPanel()

    expect(await screen.findByText('리밸런싱할 종목이 없습니다')).toBeInTheDocument()
    expect(screen.getByText('종목 탭에서 종목을 담으면 여기에 목표 비중과 지금 비중이 보입니다.')).toBeInTheDocument()
    // 누를 곳이 있다 — 폰은 종목 관리가 "더보기" 안이다 (디자인 2차)
    expect(screen.getByRole('link', { name: '종목 추가하러 가기' })).toHaveAttribute('href', '/stocks')
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
    await openSettings()

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

  it('폰: 줄을 누르면 시트에 자세히 — 비중 · 밴드 · 평가금액 · 목표 금액 · 현지 주문 금액 · 종목 안 길 (디자인 4차 12c)', async () => {
    pretendPhone()
    try {
      mockApi(HELD)
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^VOO .*팔기 · .* — 자세히$/ }))
      const sheet = screen.getByRole('dialog', { name: 'VOO 주문 자세히' })
      expect(sheet).toHaveTextContent('61.9% → 목표 60%')
      expect(sheet).toHaveTextContent('밴드 ±5.0%p 안')
      expect(sheet).toHaveTextContent('₩1,300,000')
      expect(sheet).toHaveTextContent('목표 ₩1,260,000')
      expect(sheet).toHaveTextContent('주문 −$30.77')
      expect(within(sheet).getByRole('link', { name: '종목 화면 열기' })).toHaveAttribute('href', '/stocks/VOO')
    } finally {
      forgetPhone()
    }
  })

  it('산 것을 입력하면 수량을 더하고 평단가를 가중평균으로 저장한다', async () => {
    mockApi(HELD)
    const update = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    // VOO 2주 @400 + 2주 @500 = 4주 @450 — 주문 줄의 거래 입력에서
    await user.click(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 입력' }))
    // 열린 단추는 "거래 칸 닫기" — "닫기"만이면 무엇을 닫는지 몰랐다 (검토 7 참고)
    expect(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 칸 닫기' })).toHaveTextContent(/^거래 칸 닫기$/)
    // 한 줄로 — 표 칸에서 "거래 칸 / 닫기"로 꺾였다 (검토 8 조건 2, CSS .order-trade-toggle nowrap)
    expect(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 칸 닫기' })).toHaveClass('order-trade-toggle')
    // 거래 열은 열린 단추 폭까지 처음부터 — 열 때 96 → 100px 로 넓어져 다른 칸이 꺾였다 (검토 9 조건 1)
    const head = within((await screen.findAllByRole('table'))[0]).getByRole('columnheader', { name: '거래' })
    expect(head.style.minWidth).toBe('104px')
    await user.click(screen.getByRole('button', { name: '샀다' }))
    await user.clear(screen.getByLabelText('VOO 거래 수량'))
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

    // 파는 주문에서 열면 "팔았다"로 열린다
    await user.click(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 입력' }))
    expect(screen.getByRole('button', { name: '팔았다' })).toHaveClass('active')
    expect(screen.queryByLabelText('VOO 거래 가격')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('VOO 거래 수량'))
    await user.type(screen.getByLabelText('VOO 거래 수량'), '3')
    await user.click(screen.getByRole('button', { name: '반영' }))
    expect(await screen.findByText(/보유 2주보다 많이 팔 수 없습니다/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('VOO 거래 수량'))
    await user.type(screen.getByLabelText('VOO 거래 수량'), '1')
    await user.click(screen.getByRole('button', { name: '반영' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('VOO', 1, 400, null))
  })

  it('빼기를 친 거래 수량 칸은 "샀다"일 때만 팔았다를 고르라고 한다 (0.45.2 A2 — 보유수량 칸은 종목 수정으로 옮겼다)', async () => {
    mockApi(HELD)
    const user = userEvent.setup()
    renderPanel()
    const live = () => document.querySelector('[data-num-live]')

    await user.click(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 입력' }))
    await user.click(screen.getByRole('button', { name: '샀다' }))
    await user.clear(screen.getByLabelText('VOO 거래 수량'))
    await user.type(screen.getByLabelText('VOO 거래 수량'), '-3')
    expect(live()).toHaveTextContent('VOO 거래 수량 — 빼기(−)는 넣을 수 없습니다 · 지금 값 3 · 팔았으면 ‘팔았다’를 고르세요')
    await user.click(screen.getByRole('button', { name: '팔았다' }))
    await user.clear(screen.getByLabelText('VOO 거래 수량'))
    await user.type(screen.getByLabelText('VOO 거래 수량'), '-1')
    expect(live()).toHaveTextContent('VOO 거래 수량 — 빼기(−)는 넣을 수 없습니다 · 지금 값 1')
    expect(live()).not.toHaveTextContent('팔았다’를')
  })

  it('리밸런싱에는 보유수량 · 평단가 · 산 환율 칸이 없다 — 종목 탭 "한 번에 수정"으로 안내한다 (주인 답 "목표 · 밴드만")', async () => {
    mockApi(HELD)
    const user = userEvent.setup()
    renderPanel()
    const sheet = await openTargets(user)
    expect(within(sheet).getByLabelText('VOO 목표 비중')).toHaveValue('60')
    expect(screen.queryByLabelText('VOO 보유수량')).toBeNull()
    expect(screen.queryByLabelText('VOO 평단가')).toBeNull()
    expect(screen.queryByLabelText('VOO 산 환율')).toBeNull()
    expect(sheet).toHaveTextContent('수량 · 평단가 · 산 환율은 종목 탭의 ⋯ “한 번에 수정”이나 종목 화면의 “보유” 탭에서 고칩니다')
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
    await openRecords()

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
    await openSettings()

    await user.selectOptions(await screen.findByLabelText('리뷰 주기'), '연 1회')
    await waitFor(() => expect(update).toHaveBeenCalledWith({ review_period: 'annual' }))
  })

  it('지난 기록을 펼쳐 그날의 비중과 수익률을 본다', async () => {
    mockApi(CURRENT, SETTINGS, [SNAPSHOT])
    renderPanel()
    await openRecords()

    expect(await screen.findByText('2분기 리뷰')).toBeInTheDocument()
    expect(screen.getByText('62.4% (60.0%)')).toBeInTheDocument()
    expect(screen.getByText('+20.0%')).toBeInTheDocument()
  })

  it('기록 삭제는 한 번 더 묻는다', async () => {
    mockApi(CURRENT, SETTINGS, [SNAPSHOT])
    const remove = vi.spyOn(api, 'deleteSnapshot').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel()
    await openRecords()

    await user.click(await screen.findByRole('button', { name: '기록 삭제' }))
    expect(remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: '네, 지웁니다' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7))
  })

  it('시트 안 삭제 확인창에서 Esc 는 확인창만 닫는다 — 시트는 열린 채 (묶음 4 다섯 번째 검토 조건 1)', async () => {
    mockApi(CURRENT, SETTINGS, [SNAPSHOT])
    const remove = vi.spyOn(api, 'deleteSnapshot').mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel()
    await openRecords()

    await user.click(await screen.findByRole('button', { name: '기록 삭제' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: '리뷰 · 기록' })).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()

    // 확인창이 없으면 Esc 한 번에 시트가 닫힌다
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '리뷰 · 기록' })).not.toBeInTheDocument())
  })
})

/* ---------- 8-3 — 답을 먼저 · 한 번에 저장 · 산 환율 · 폰 카드 ---------- */

describe('리밸런싱 · 답을 먼저 (ROADMAP 8-3)', () => {
  it('순서는 요약 → 주문 가이드 → 목록 한 장 — 기록 · 설정 · 목표는 시트로 (디자인 4차 12c · 12d)', async () => {
    mockApi()
    const { container } = renderPanel()
    await screen.findByRole('region', { name: '주문 가이드' })
    const order = Array.from(container.querySelectorAll('[aria-label="내 자산"], section h3, [aria-label="리밸런싱 더 보기"]')).map(
      (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
    )
    // 리뷰 · 기록 · 설정은 화면 밖 시트 — 주문 아래 목록 한 장에서 연다 (목업 12d A · α)
    expect(order).toEqual(['내 자산', '주문 가이드', '리밸런싱 더 보기'])
    expect(screen.queryByRole('heading', { name: /^리뷰 · 기록/ })).toBeNull()
  })

  it('요약은 전체 자금 · 현금 · 기본 밴드 · 목표 합계 — 손익은 홈에 (디자인 4차 12c)', async () => {
    mockApi({ ...CURRENT, day_change_base: 13_000, day_change_pct: 0.62 })
    renderPanel()
    const line = await screen.findByRole('region', { name: '내 자산' })
    expect(line).toHaveTextContent('₩2,100,000')
    expect(line).toHaveTextContent('현금 ₩0')
    expect(line).toHaveTextContent('기본 밴드 ±5.0%p')
    expect(within(line).getByRole('button', { name: /^목표 합계 100\.0% · 목표 · 밴드 고치기$/ })).not.toHaveClass('warn')
    expect(line).not.toHaveTextContent('+₩13,000')
    expect(within(line).queryByText('신호')).not.toBeInTheDocument()
  })

  it('목표 합계가 100 이 아니면 주문 가이드 위에서 알린다', async () => {
    mockApi({ ...CURRENT, rows: CURRENT.rows.map((r) => ({ ...r, target_weight_pct: 30 })) })
    renderPanel()
    // 긴 경고 줄은 뺐다(목업 12d A) — 요약 알약이 호박 ⚠, 시트에서 무엇을 하면 되는지
    expect(await screen.findByRole('button', { name: /^목표 합계 60\.0% — 100%가 아님/ })).toHaveClass('warn')
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
    expect(within(us).getByText(/−1주 미만 \(0\.06주\)/)).toBeInTheDocument()
    expect(screen.queryByText('₩2,100,000')).not.toBeInTheDocument()

    // 여기서 풀면 여기 표도 바로 풀린다
    await userEvent.click(within(line).getByRole('button', { name: '금액 보기' }))
    expect(await orderRow('VOO')).toHaveTextContent('₩1,300,000')
  })
})

describe('리밸런싱 · 보유·목표는 한 번에 저장', () => {
  it('목표 · 밴드 시트: 고친 줄에 표시가 붙고, "바뀐 N줄 저장 · 되돌리기"', async () => {
    mockApi()
    const user = userEvent.setup()
    renderPanel()
    const sheet = await openTargets(user)
    expect(within(sheet).getByRole('button', { name: '바뀐 것 없음' })).toBeDisabled()

    await user.type(within(sheet).getByLabelText('VOO 밴드 임계값'), '3')
    await user.clear(within(sheet).getByLabelText('삼성전자 목표 비중'))
    await user.type(within(sheet).getByLabelText('삼성전자 목표 비중'), '45')

    expect(within(sheet).getByRole('button', { name: '바뀐 2줄 저장' })).toBeEnabled()
    expect(within(sheet).getByLabelText('VOO 밴드 임계값').closest('li')).toHaveClass('dirty')

    await user.click(within(sheet).getByRole('button', { name: '되돌리기' }))
    expect(within(sheet).getByLabelText('삼성전자 목표 비중')).toHaveValue('40')
    expect(within(sheet).getByRole('button', { name: '바뀐 것 없음' })).toBeDisabled()
  })

  it('고친 것만 보낸다 — 목표 · 밴드만, 보유는 보내지 않는다', async () => {
    mockApi()
    const holding = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const target = vi.spyOn(api, 'updateRebalanceTarget').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()
    const sheet = await openTargets(user)

    await user.type(within(sheet).getByLabelText('VOO 밴드 임계값'), '3')
    await user.clear(within(sheet).getByLabelText('삼성전자 목표 비중'))
    await user.type(within(sheet).getByLabelText('삼성전자 목표 비중'), '45')
    await user.click(within(sheet).getByRole('button', { name: '바뀐 2줄 저장' }))

    await waitFor(() => expect(target).toHaveBeenCalledTimes(2))
    expect(target).toHaveBeenCalledWith('005930.KS', { target_weight_pct: 45, rebalance_band_pct: null })
    expect(target).toHaveBeenCalledWith('VOO', { target_weight_pct: 60, rebalance_band_pct: 3 })
    expect(holding).not.toHaveBeenCalled()
  })

  it('중간에 실패한 줄은 고치던 값을 남기고, 나머지는 저장한다', async () => {
    mockApi()
    vi.spyOn(api, 'updateRebalanceTarget').mockImplementation(async (ticker) => {
      if (ticker === 'VOO') throw new Error('저장 실패')
      return {} as never
    })
    const user = userEvent.setup()
    renderPanel()
    const sheet = await openTargets(user)

    await user.clear(within(sheet).getByLabelText('VOO 목표 비중'))
    await user.type(within(sheet).getByLabelText('VOO 목표 비중'), '55')
    await user.clear(within(sheet).getByLabelText('삼성전자 목표 비중'))
    await user.type(within(sheet).getByLabelText('삼성전자 목표 비중'), '45')
    await user.click(within(sheet).getByRole('button', { name: '바뀐 2줄 저장' }))

    // 다시 받아 온 뒤에도 — 성공한 줄은 서버 값(여기서는 그대로 40), 실패한 줄은 고치던 55
    expect(await screen.findByText(/저장 실패/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('삼성전자 목표 비중')).toHaveValue('40'))
    expect(screen.getByLabelText('VOO 목표 비중')).toHaveValue('55')
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

  it('목표 · 밴드 시트는 Esc · ✕ 로 닫히고, 열 때 첫 목표 칸에 포커스 (새 팝업 가두기)', async () => {
    mockApi(JP)
    const user = userEvent.setup()
    renderPanel()
    let sheet = await openTargets(user)
    expect(document.activeElement).toBe(within(sheet).getByLabelText('VOO 목표 비중'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '목표 비중 · 밴드 고치기' })).toBeNull()
    sheet = await openTargets(user)
    await user.click(within(sheet).getByRole('button', { name: '목표 · 밴드 닫기' }))
    expect(screen.queryByRole('dialog', { name: '목표 비중 · 밴드 고치기' })).toBeNull()
  })

  it('원화 종목만 있으면 산 환율 칸도 환율 효과 설정도 없다', async () => {
    mockApi({ ...CURRENT, rows: [CURRENT.rows[0]] })
    renderPanel()
    await openSettings()
    await screen.findByRole('region', { name: '주문 가이드' })
    expect(screen.queryByText('산 환율')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('수익률에 환율 효과 포함')).not.toBeInTheDocument()
  })

  it('외화 종목을 사면 그날 환율(기본은 지금 환율)로 산 환율을 금액 가중 평균한다', async () => {
    mockApi(JP)
    const holding = vi.spyOn(api, 'updateHolding').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()

    await user.click(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 입력' }))
    await user.click(screen.getByRole('button', { name: '샀다' }))
    expect(screen.getByLabelText('VOO 산 날 환율')).toHaveValue('1,300')
    await user.clear(screen.getByLabelText('VOO 거래 수량'))
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
    await openSettings()
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
    await openSettings()
    await user.click(await screen.findByLabelText('수익률에 환율 효과 포함'))
    expect(await screen.findByText(/환율 효과 저장 실패/)).toBeInTheDocument()
    expect(screen.getByLabelText('수익률에 환율 효과 포함')).not.toBeChecked()
  })

  it('달러 기준이면 흐리게 두고 이유를 적는다', async () => {
    mockApi({ ...JP, base_currency: 'USD' }, { ...SETTINGS, base_currency: 'USD', include_fx_effect: true })
    renderPanel()
    await openSettings()
    expect(await screen.findByLabelText('수익률에 환율 효과 포함')).toBeDisabled()
    expect(screen.getByText(/기준통화가 원일 때만 켤 수 있습니다/)).toBeInTheDocument()
  })

  it('목표 합계가 100이 아니면 요약 알약이 호박 ⚠ — 누르면 목표 · 밴드 시트', async () => {
    mockApi({ ...JP, rows: JP.rows.map((r) => ({ ...r, target_weight_pct: 30 })) })
    const user = userEvent.setup()
    renderPanel()
    const pill = await screen.findByRole('button', { name: /^목표 합계 90\.0% — 100%가 아님 · 목표 · 밴드 고치기$/ })
    expect(pill).toHaveClass('warn')
    await user.click(pill)
    expect(screen.getByRole('dialog', { name: '목표 비중 · 밴드 고치기' })).toHaveTextContent('합계 90.0%')
  })

})

describe('리밸런싱 · 폰', () => {
  beforeEach(() => {
    pretendPhone()
  })
  afterEach(() => forgetPhone())

  it('줄일 · 늘릴 묶음, 줄마다 부호 주수와 왼쪽 띠 — "사기 · 팔기" 글씨는 없다, 표도 없다 (주인 답 12b)', async () => {
    const rows = CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20 } : r))
    mockApi({ ...CURRENT, rows })
    renderPanel()
    const guide = await screen.findByRole('region', { name: '주문 가이드' })
    expect(within(guide).queryByRole('table')).not.toBeInTheDocument()
    // VOO: 목표 20% x 210만 = 42만 → 88만원 팔기 = $676.92 → 500달러 종가로 1.35주
    // 삼성: 목표 40% = 84만 → 4만원 사기 = 8만원 종가로 0.5주
    const sell = within(guide).getByRole('region', { name: '줄일 종목' })
    const buy = within(guide).getByRole('region', { name: '늘릴 종목' })
    const voo = within(sell).getByRole('button', { name: /^VOO 1주 \(1\.35\) 팔기 · 비중 61\.9%에서 목표 20% · −₩880,000 — 자세히$/ })
    expect(voo).toHaveClass('is-sell')
    expect(voo.querySelector('.order-row-act b')).toHaveTextContent(/^−1주$/)
    expect(voo).toHaveTextContent('61.9% → 20%')
    const samsung = within(buy).getByRole('button', { name: /^삼성전자 1주 미만 \(0\.5주\) 사기 · .* — 자세히$/ })
    expect(samsung).toHaveClass('is-buy')
    expect(samsung.querySelector('.order-row-act b')).toHaveTextContent(/^\+1주 미만 \(0\.5주\)$/)
    expect(guide).not.toHaveTextContent(/사기|팔기/)
  })

  it('목록 한 장 — 목표 · 밴드 / 리뷰 · 기록 / 설정, 오른쪽에 지금 값 · 누르면 각 시트 (목업 12d α)', async () => {
    mockApi(CURRENT, SETTINGS, [])
    const user = userEvent.setup()
    renderPanel()
    const list = await screen.findByRole('list', { name: '리밸런싱 더 보기' })
    const items = within(list).getAllByRole('button')
    expect(items.map((b) => b.textContent)).toEqual([
      '목표 · 밴드 고치기합계 100.0%',
      expect.stringMatching(/^리뷰 · 기록D-\d+ · 0건$/),
      '리밸런싱 설정주기, 현금, 환율, 밴드',
    ])
    await user.click(items[2])
    const sheet = screen.getByRole('dialog', { name: '리밸런싱 설정' })
    expect(within(sheet).getByLabelText('전역 기본 밴드')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: '설정 닫기' }))
    await user.click(items[1])
    expect(screen.getByRole('dialog', { name: '리뷰 · 기록' })).toHaveTextContent('지금 상태 기록하기')
  })

})

describe('리밸런싱 · 팔지 않고 새 돈만 나누기 (0.42.0 B6)', () => {
  // VOO 목표 20%(지금 130만 — 과중), 삼성 40%(지금 80만 — 미달). 새 돈 90만이면 전체 300만
  const SKEWED = { ...CURRENT, rows: CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20 } : { ...r, target_weight_pct: 40 })) }
  beforeEach(() => localStorage.removeItem('rebalance.buy-only'))
  afterEach(() => localStorage.removeItem('rebalance.buy-only'))

  it('기본은 꺼짐 — 안내 글·맨 위 한 줄이 실제 계산(전체를 다시 맞춘다)과 같고, 파는 주문도 있다', async () => {
    mockApi(SKEWED)
    const user = userEvent.setup()
    renderPanel()
    await user.type(await screen.findByLabelText(/이번에 새로 넣을 돈/), '900000')
    expect(screen.getByLabelText('팔지 않고 새 돈만 나누기')).not.toBeChecked()
    expect(screen.getByText(/새로 넣을 돈까지 더한 전체 자금으로 목표 비중을 다시 맞춘 주문/)).toBeInTheDocument()
    expect(screen.queryByText(/모자란 종목부터 채우는 주문/)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('새로 넣을 돈 ₩900,000 반영 — 전체 자금으로 목표 비중을 다시 맞춘 주문입니다')
    expect(act(await orderRow('VOO'))).toMatch(/팔기$/)
  })

  it('칸 바로 아래 풀이 앞에도 계산에 쓴 금액 — 폰에서는 위 줄이 화면 밖이다, 읽기는 위 줄 하나 (0.45.2 A4)', async () => {
    mockApi(SKEWED)
    const user = userEvent.setup()
    renderPanel()
    const box = await screen.findByLabelText(/이번에 새로 넣을 돈/)
    const hint = () => box.closest('.new-money')!.querySelector('.hint')!
    // 빈 칸이면 지금 풀이 그대로
    expect(hint().textContent).toBe('새로 넣을 돈까지 더한 전체 자금으로 목표 비중을 다시 맞춘 주문이 나옵니다(파는 주문도 있을 수 있습니다). 저장되지 않습니다.')
    await user.type(box, '75')
    expect(hint().textContent).toBe(
      '새로 넣을 돈 ₩75 반영 — 새로 넣을 돈까지 더한 전체 자금으로 목표 비중을 다시 맞춘 주문이 나옵니다(파는 주문도 있을 수 있습니다). 저장되지 않습니다.',
    )
    expect(screen.getAllByRole('status')).toHaveLength(1)
    await user.click(screen.getByLabelText('팔지 않고 새 돈만 나누기'))
    expect(hint().textContent).toMatch(/^새로 넣을 돈 ₩75 반영 — 팔지 않고, 새로 넣을 돈만/)
  })

  it('켜면 파는 주문이 없고 새 돈이 모자란 종목으로 간다 — 기기에 기억한다', async () => {
    mockApi(SKEWED)
    const user = userEvent.setup()
    renderPanel()
    await user.type(await screen.findByLabelText(/이번에 새로 넣을 돈/), '900000')
    await user.click(screen.getByLabelText('팔지 않고 새 돈만 나누기'))
    expect(localStorage.getItem('rebalance.buy-only')).toBe('1')
    expect(screen.getByRole('status')).toHaveTextContent('목표에 모자란 만큼에 비례해 나눴습니다')
    expect(screen.getByText(/팔지 않고, 새로 넣을 돈만 목표에 모자란 만큼에 비례해 나눕니다/)).toBeInTheDocument()
    expect(act(await orderRow('VOO'))).toMatch(/유지$/)
    // 삼성은 모자람 40만(목표 120만 − 80만) — 90만 중 40만만 쓰고 50만은 현금에 남는다(현금 목표 0 이면 몫이 없다)
    expect(await orderRow('005930.KS')).toHaveTextContent('+₩400,000')
    expect(screen.getByRole('status')).toHaveTextContent('남는 ₩500,000은 현금')
  })

  it('기억해 둔 켜짐으로 시작한다', async () => {
    localStorage.setItem('rebalance.buy-only', '1')
    mockApi(SKEWED)
    renderPanel()
    expect(await screen.findByLabelText('팔지 않고 새 돈만 나누기')).toBeChecked()
  })

  it('폰 — 새로 넣을 돈은 한 줄을 눌러 펼치고, 줄에 넣은 금액 · 현금 칸은 산 뒤 남는 현금', async () => {
    pretendPhone()
    try {
      localStorage.setItem('rebalance.buy-only', '1')
      mockApi(SKEWED)
      const user = userEvent.setup()
      renderPanel()
      const line = await screen.findByRole('button', { name: /^새로 넣을 돈/ })
      expect(line).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByLabelText(/이번에 새로 넣을 돈/)).toBeNull()
      await user.click(line)
      await user.type(screen.getByLabelText(/이번에 새로 넣을 돈/), '900000')
      expect(line).toHaveTextContent('₩900,000')
      expect(line).toHaveTextContent('팔지 않고 나누기')
      expect(document.querySelector('.cash-card')).toHaveTextContent('₩900,000 → ₩500,000 남음')
    } finally {
      forgetPhone()
    }
  })

})

describe('리밸런싱 · 폰 이름은 보일 이름으로 (0.42.0 B9)', () => {
  beforeEach(() => pretendPhone())
  afterEach(() => forgetPhone())

  it('내가 이름을 비운 종목은 공용 종목명 — 티커(7203.T)로 보이지 않는다 (유지 줄을 펼쳐서)', async () => {
    const toyota = row({
      ticker: '7203.T',
      name: 'トヨタ自動車',
      currency: 'JPY',
      target_weight_pct: 0,
      actual_weight_pct: 0,
      quantity: 0,
      last_close: 3000,
    })
    mockApi({ ...CURRENT, rows: [...CURRENT.rows, toyota] })
    vi.spyOn(api, 'listStocks').mockResolvedValue([
      {
        ticker: '7203.T',
        name: null,
        shown_name: 'トヨタ自動車',
        category: null,
        market: 'JP',
        currency: 'JPY',
        active: true,
        added_at: '2026-09-01T00:00:00',
        target_weight_pct: 0,
        rebalance_band_pct: null,
      } as Stock,
    ])
    const user = userEvent.setup()
    renderPanel()
    const guide = await screen.findByRole('region', { name: '주문 가이드' })
    const holds = await within(guide).findByRole('button', { name: /^유지 \d+ ·/ })
    await waitFor(() => expect(holds).toHaveTextContent('トヨタ自動車'))
    await user.click(holds)
    expect(holds).toHaveAttribute('aria-expanded', 'true')
    expect(within(guide).getByRole('button', { name: /^トヨタ自動車 유지 · 비중 0\.0%에서 목표 0% — 자세히$/ })).toBeInTheDocument()
    expect(within(guide).queryByText(/^7203\.T/)).toBeNull()
  })

})

describe('리밸런싱 · 주문과 신호를 다른 말로 (디자인 2차)', () => {
  const MIXED: RebalanceCurrent = {
    ...CURRENT,
    rows: CURRENT.rows.map((r) =>
      r.ticker === 'VOO'
        ? { ...r, target_weight_pct: 20, shoulder_signal_fired_in_period: true, rebalance_signal: { active: true, reasons: ['밴드 초과(매도 검토)'] } }
        : r,
    ),
  }

  it('PC 표: 주문은 사기·팔기, 신호는 이름표 "비중"·"참고", 신호가 없으면 "비중조절 신호 없음", 머리말에 주문 수', async () => {
    mockApi(MIXED)
    renderPanel()
    const voo = await orderRow('VOO')
    expect(act(voo)).toMatch(/팔기$/)
    expect(voo).not.toHaveTextContent('SELL')
    const groups = Array.from(voo.querySelectorAll('.badge-group')).map((g) => g.textContent)
    expect(groups).toEqual(['비중비중 초과', '참고기간 내 매도'])
    const samsung = await orderRow('005930.KS')
    expect(act(samsung)).toMatch(/사기$/)
    expect(samsung).toHaveTextContent('비중조절 신호 없음')
    expect(samsung).not.toHaveTextContent('밴드 이내')
    const guide = screen.getByRole('region', { name: '주문 가이드' })
    expect(within(guide).getByText(/^주문 2 · 비중조절 신호 1종목/)).toBeInTheDocument()
  })

  it('PC 표: 이름 = 티커면 아래 줄에 티커를 다시 쓰지 않는다', async () => {
    mockApi(MIXED)
    renderPanel()
    const voo = await orderRow('VOO')
    expect(voo.querySelector('.ticker-sub')!.textContent).not.toMatch(/^VOO/)
    const samsung = await orderRow('005930.KS')
    expect(samsung.querySelector('.ticker-sub')).toHaveTextContent(/^005930\.KS ·/)
  })

  it('폰 줄: 비중 줄 · 부호 주수 · 금액 한 덩어리, ◆ 는 비중 신호 줄에만 · 현지 금액은 시트에', async () => {
    pretendPhone()
    try {
      mockApi(MIXED)
      const user = userEvent.setup()
      renderPanel()
      const voo = await screen.findByRole('button', { name: /^VOO .*팔기 · .* — 자세히$/ })
      expect(voo.querySelector('.order-row-sub')).toHaveTextContent(/^61\.9% → 20%$/)
      expect(voo.querySelector('.order-row-act span')).toHaveTextContent(/^−₩880,000$/)
      expect(voo.querySelector('.weight-dot')).not.toBeNull()
      expect(screen.getByRole('button', { name: /^삼성전자 .*사기 · .* — 자세히$/ }).querySelector('.weight-dot')).toBeNull()
      await user.click(voo)
      expect(screen.getByRole('dialog', { name: 'VOO 주문 자세히' })).toHaveTextContent('주문 −$676.92')
    } finally {
      forgetPhone()
    }
  })

})

describe('리밸런싱 · 주문 옆 거래 입력 (디자인 2차, 주인 결정 ②)', () => {
  const SKEW: RebalanceCurrent = {
    ...CURRENT,
    rows: CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20 } : r)),
  }

  it('PC: 주문 줄의 "거래 입력"은 그 주문의 팔기·정수 주로 거래 칸을 연다 — 반영하면 보유를 고친다', async () => {
    mockApi(SKEW)
    const save = vi.spyOn(api, 'updateHolding').mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    renderPanel()
    const voo = await orderRow('VOO')
    await user.click(within(voo).getByRole('button', { name: 'VOO 거래 입력' }))
    // VOO 1주 (1.35) 팔기 → 팔았다 · 1
    expect(screen.getByRole('button', { name: '팔았다' })).toHaveClass('active')
    expect(screen.getByLabelText('VOO 거래 수량')).toHaveValue('1')
    await user.click(screen.getByRole('button', { name: '반영' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('VOO', 1, null, null))
    // 반영 뒤 주문 가이드가 다시 계산된다는 것을 한 줄로 (C 사용자 확인)
    expect(await screen.findByText(/VOO 1주 판 것을 반영했습니다 — 주문 가이드를 바뀐 보유로 다시 계산했습니다/)).toBeInTheDocument()
  })

  it('폰: 줄을 눌러 연 시트에 "거래 입력", 사기면 샀다로 연다 · 반영하면 시트가 닫힌다', async () => {
    pretendPhone()
    try {
      mockApi(SKEW)
      const save = vi.spyOn(api, 'updateHolding').mockResolvedValue(undefined as never)
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^삼성전자 .*사기 · .* — 자세히$/ }))
      const sheet = screen.getByRole('dialog', { name: '삼성전자 주문 자세히' })
      await user.click(within(sheet).getByRole('button', { name: '삼성전자 거래 입력' }))
      expect(within(sheet).getByRole('button', { name: '샀다' })).toHaveClass('active')
      // 1주 미만 (0.5주) → 소수 그대로
      expect(within(sheet).getByLabelText('005930.KS 거래 수량')).toHaveValue('0.5')
      await user.click(within(sheet).getByRole('button', { name: '반영' }))
      await waitFor(() => expect(save).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '삼성전자 주문 자세히' })).toBeNull())
    } finally {
      forgetPhone()
    }
  })

  it('PC 주문 표 — 비중은 지금 · 목표 · 차이 세 칸(막대 없음) · 종목 칸이 고정된다 · 보유 표는 없다 (목업 12d 3)', async () => {
    mockApi(SKEW)
    renderPanel()
    const tables = await screen.findAllByRole('table')
    expect(tables).toHaveLength(1)
    expect(tables[0]).toHaveClass('sticky-first')
    expect(Array.from(tables[0].querySelectorAll('thead th')).map((h) => h.textContent)).toEqual([
      '구분 / 종목', '지금', '목표', '차이', '주문', '조정 금액', '비중조절 신호', '거래',
    ])
    expect(within(tables[0]).getAllByRole('columnheader', { name: /줄일 종목|늘릴 종목/ })).toHaveLength(2)
    const voo = await orderRow('VOO')
    // VOO 61.9% → 20% — 밴드(5) 밖이 아니면 회색 칩, 막대는 없다
    expect(voo.querySelector('.drift-chip')).toHaveTextContent('+41.9%p')
    expect(voo.querySelector('.wb-track')).toBeNull()
  })

})

describe('날마다의 평가금액 안내 (0.44.0)', () => {
  it('리뷰 · 기록 안에, 리뷰 기록과 따로라는 말과 며칠치인지 (0.45.0 D3 — 방침과 같은 말, 볼 화면은 아직 없음)', async () => {
    mockApi({ ...CURRENT, value_record: { enabled: true, days: 12, since: '2026-10-05' } })
    renderPanel()
    const section = await openRecords()
    const line = section.querySelector('.value-record-line') as HTMLElement
    expect(line.textContent?.replace(/\s+/g, ' ')).toBe(
      '리뷰 기록과 따로, 서버가 매일 아침 평가금액과 보유 모습(수량·평단가·종가·현금·환율)을 남깁니다. ' +
        '2026-10-05부터 12일치 쌓였습니다.',
    )
    // 날짜는 줄 끝에서 갈라지지 않는다
    expect(within(line).getByText('2026-10-05부터').classList.contains('nowrap')).toBe(true)
    // 리뷰 기록이 하나도 없다는 말과 같이 보여도 서로 어긋나지 않는다 — "따로"
    expect(within(section).getByText(/아직 리뷰 기록이 없습니다/)).toBeTruthy()
  })

  it('아직 쌓이지 않았으면 언제부터인지', () => {
    render(<ValueRecordLine record={{ enabled: true, days: 0, since: null }} />)
    expect(screen.getByText(/다음 아침부터 쌓입니다/)).toBeTruthy()
  })

  it('옛 서버(칸 없음)·꺼 둔 서버면 그리지 않는다', () => {
    const { container, rerender } = render(<ValueRecordLine record={undefined} />)
    expect(container.textContent).toBe('')
    rerender(<ValueRecordLine record={{ enabled: false, days: 3, since: '2026-10-05' }} />)
    expect(container.textContent).toBe('')
  })
})

describe('목표 0%라 전부 파는 계산 (0.45.4 C)', () => {
  // KAKAO 를 목표 비우고(0%) 10주 담았다 — 주문 가이드는 전부 팔기로 계산한다
  const kakao = row({
    ticker: '035720.KS', name: '카카오', currency: 'KRW', target_weight_pct: 0, quantity: 10,
    last_close: 40_000, current_value: 400_000, current_value_base: 400_000,
  })
  const watch = row({ ticker: 'WATCH', name: '관심만', currency: 'KRW', target_weight_pct: 0, quantity: 0, last_close: 1000 })
  const ONE = { ...CURRENT, total_value_base: 2_500_000, holdings_value_base: 2_500_000, rows: [...CURRENT.rows, kakao, watch] }
  const naver = row({
    ticker: '035420.KS', name: '네이버', currency: 'KRW', target_weight_pct: 0, quantity: 2,
    last_close: 200_000, current_value: 400_000, current_value_base: 400_000,
  })
  const TWO = { ...ONE, total_value_base: 2_900_000, holdings_value_base: 2_900_000, rows: [...ONE.rows, naver] }
  beforeEach(() => localStorage.removeItem('rebalance.buy-only'))
  afterEach(() => localStorage.removeItem('rebalance.buy-only'))

  it('팔기 줄에만 풀이 — 목표 > 0 인 줄·보유 0 인 관심 종목에는 없다, 계산(팔기)은 그대로', async () => {
    mockApi(ONE)
    renderPanel()
    const k = await orderRow('카카오')
    expect(act(k)).toMatch(/팔기$/)
    expect(k).toHaveTextContent("목표 0%라 전부 파는 계산입니다 · 목표는 '목표 · 밴드'에서 정합니다")
    expect(await orderRow('VOO')).not.toHaveTextContent('전부 파는')
    expect(await orderRow('삼성전자')).not.toHaveTextContent('전부 파는')
    // 비중 칸의 "목표 0%" 는 원래 있다 — 풀이(꼬리)만 없다
    expect((await orderRow('관심만')).querySelector('.zero-target-note')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull() // 하나면 모은 줄이 없다
  })

  it('목표가 있는 팔기(과중)에는 풀이가 없다 — 목표 0% 라서 생긴 팔기만', async () => {
    // VOO 목표 20% 인데 지금 130만/250만 = 52% — 목표가 있어도 파는 줄
    const OVER = { ...ONE, rows: ONE.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20 } : r)) }
    mockApi(OVER)
    renderPanel()
    const voo = await orderRow('VOO')
    expect(act(voo)).toMatch(/팔기$/)
    expect(voo.querySelector('.zero-target-note')).toBeNull()
    expect((await orderRow('카카오')).querySelector('.zero-target-note')).not.toBeNull()
  })

  it('둘 이상이면 위에 한 줄로 모으고 줄마다는 짧게', async () => {
    mockApi(TWO)
    renderPanel()
    expect(await screen.findByRole('note')).toHaveTextContent('목표 비중이 0%인 보유 종목 2개는 전부 파는 계산입니다')
    for (const name of ['카카오', '네이버']) {
      const r = await orderRow(name)
      expect(r.querySelector('.zero-target-note')).toHaveTextContent(/^목표 0%$/)
      expect(r).not.toHaveTextContent('전부 파는')
    }
  })

  it('팔지 않고 새 돈만 나누기에는 팔기가 없으니 풀이도 없다', async () => {
    localStorage.setItem('rebalance.buy-only', '1')
    mockApi(TWO)
    const user = userEvent.setup()
    renderPanel()
    await user.type(await screen.findByLabelText(/이번에 새로 넣을 돈/), '900000')
    expect((await orderRow('카카오')).querySelector('.zero-target-note')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('폰 시트에도 같은 풀이', async () => {
    pretendPhone()
    try {
      mockApi(ONE)
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^카카오 10주 팔기 · .* — 자세히$/ }))
      expect(screen.getByRole('dialog', { name: '카카오 주문 자세히' })).toHaveTextContent('목표 0%라 전부 파는 계산입니다')
    } finally {
      forgetPhone()
    }
  })

})

describe('리밸런싱 · 디자인 4차 목업 12c', () => {
  it('머리의 "다음 리뷰 D-n" 알약 — 누르면 리뷰 · 기록 시트', async () => {
    mockApi()
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: /^다음 리뷰 D-\d+$/ }))
    expect(screen.getByRole('dialog', { name: '리뷰 · 기록' })).toBeInTheDocument()
  })

  it('줄을 눌러 연 시트 — Tab 은 시트 안에서 돌고, Esc 로 닫힌다 (새 팝업 가두기)', async () => {
    pretendPhone()
    try {
      mockApi()
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^VOO .* — 자세히$/ }))
      const sheet = screen.getByRole('dialog', { name: 'VOO 주문 자세히' })
      for (let i = 0; i < 6; i++) {
        await user.tab()
        expect(sheet.contains(document.activeElement)).toBe(true)
      }
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'VOO 주문 자세히' })).toBeNull()
    } finally {
      forgetPhone()
    }
  })

  it('PC 표: 줄일 묶음이 먼저, 묶음 안은 큰 금액부터 — 계산은 그대로, 보이는 순서만', async () => {
    const rows = [
      ...CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20 } : { ...r, target_weight_pct: 50 })),
      row({ ticker: 'QQQ', currency: 'USD', target_weight_pct: 30, quantity: 0, last_close: 400 }),
    ]
    mockApi({ ...CURRENT, rows })
    renderPanel()
    const table = (await screen.findAllByRole('table'))[0]
    const order = Array.from(table.querySelectorAll('tbody tr'))
      .map((tr) => tr.querySelector('.ticker-name, th')?.textContent ?? '')
      .filter(Boolean)
    // 줄일: VOO −88만 · 늘릴: QQQ +63만(30%) > 삼성 +25만(50% 105만 − 80만)
    expect(order).toEqual(['줄일 종목 1 · −₩880,000', 'VOO', '늘릴 종목 2 · +₩880,000', 'QQQ', '삼성전자', '현금'])
  })
})

describe('리밸런싱 · 묶음 4 사용자 확인 보완', () => {
  const SKEW: RebalanceCurrent = {
    ...CURRENT,
    rows: CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, target_weight_pct: 20, shoulder_signal_fired_in_period: true } : r)),
  }

  it('판 것을 반영하면 판 돈이 현금에 저절로 더해지지 않는다고 말한다 — 산 것에는 없다', async () => {
    mockApi(SKEW)
    vi.spyOn(api, 'updateHolding').mockResolvedValue(undefined as never)
    const user = userEvent.setup()
    renderPanel()
    await user.click(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 입력' }))
    await user.click(screen.getByRole('button', { name: '반영' }))
    expect(await screen.findByText(/VOO 1주 판 것을 반영했습니다/)).toHaveTextContent('판 돈은 현금에 저절로 더해지지 않습니다')
  })

  it('주문 시트의 "거래 입력"을 누르면 거래 칸을 보이는 곳으로 끌어온다 — 폰 320 에서 화면 밖에 열렸다 (묶음 4 사용자 확인 2)', async () => {
    mockApi()
    const scroll = vi.fn()
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    pretendPhone()
    try {
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^VOO .* — 자세히$/ }))
      const sheet = screen.getByRole('dialog', { name: 'VOO 주문 자세히' })
      await user.click(within(sheet).getByRole('button', { name: 'VOO 거래 입력' }))
      const toggle = within(sheet).getByRole('button', { name: 'VOO 거래 칸 닫기' })
      expect(toggle).toHaveTextContent('거래 칸 닫기')
      expect(scroll).toHaveBeenCalled()
      expect(scroll.mock.contexts[0]).toHaveClass('order-trade-form')
    } finally {
      forgetPhone()
      Element.prototype.scrollIntoView = before
    }
  })

  it('목표 · 밴드를 저장하면 시트에 "n줄을 저장했습니다" — 닫으면 지운다', async () => {
    const scroll = vi.fn()
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    onTestFinished(() => {
      Element.prototype.scrollIntoView = before
    })
    mockApi()
    vi.spyOn(api, 'updateRebalanceTarget').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()
    const sheet = await openTargets(user)
    await user.type(within(sheet).getByLabelText('VOO 밴드 임계값'), '3')
    await user.click(within(sheet).getByRole('button', { name: '바뀐 1줄 저장' }))
    const status = await within(sheet).findByRole('status')
    expect(status).toHaveTextContent('1줄을 저장했습니다 — 주문 가이드를 새 목표로 다시 계산했습니다.')
    // 목록보다 위 — 긴 목록 맨 아래에 있어 보이지 않았다 (묶음 4 사용자 확인 2)
    expect(status.compareDocumentPosition(sheet.querySelector('.target-list')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 아래쪽 줄을 고치고 저장해 시트가 내려가 있어도 그 줄을 보이는 곳으로 끌어온다 (검토 7 조건 1)
    expect(scroll.mock.contexts.some((el) => el === status)).toBe(true)
    // 같은 시트에서 같은 줄 수로 한 번 더 저장해도 다시 끌어온다 — 글이 같아 두 번째는 그대로였다 (검토 8 조건 1)
    const first = scroll.mock.contexts.filter((el) => el === status).length
    await user.type(within(sheet).getByLabelText('삼성전자 밴드 임계값'), '4')
    await user.click(within(sheet).getByRole('button', { name: '바뀐 1줄 저장' }))
    await waitFor(() => expect(scroll.mock.contexts.filter((el) => el === within(sheet).getByRole('status')).length).toBeGreaterThan(first))
    await user.click(within(sheet).getByRole('button', { name: '목표 · 밴드 닫기' }))
    const again = await openTargets(user)
    expect(within(again).queryByRole('status')).toBeNull()
  })

  it('주문 시트에서 "목표 · 밴드 고치기"로 바로 — 평단가는 종목 안 보유라고 말한다', async () => {
    pretendPhone()
    try {
      mockApi(SKEW)
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^VOO .*팔기 · .* — 자세히$/ }))
      const sheet = screen.getByRole('dialog', { name: 'VOO 주문 자세히' })
      expect(sheet).toHaveTextContent('수량 · 평단가는 종목 화면의 “보유” 탭에서 고칩니다.')
      // 계산 소수는 따로 한 줄 — "1주 (1.35)" 괄호가 무엇인지 몰랐다
      expect(sheet.querySelector('.order-sheet-act b')).toHaveTextContent('−1주계산으로는 1.35주 · 1주 단위로 내림')
      // 기간 내 매도는 참고 꼬리표라 회색 — 빨강이면 늘릴 종목 줄에서 팔라는 말로 읽혔다 (② 주인 답 "회색으로")
      expect(within(sheet).getByText('기간 내 매도')).toHaveClass('badge-grey')
      expect(within(sheet).getByText('기간 내 매도')).not.toHaveClass('badge-sell')
      await user.click(within(sheet).getByRole('button', { name: '목표 · 밴드 고치기' }))
      expect(screen.queryByRole('dialog', { name: 'VOO 주문 자세히' })).toBeNull()
      expect(screen.getByRole('dialog', { name: '목표 비중 · 밴드 고치기' })).toBeInTheDocument()
    } finally {
      forgetPhone()
    }
  })
})

describe('리밸런싱 · 묶음 4 검토 보완', () => {
  it('줄을 눌러 시트를 열면 포커스가 시트 안(닫기)으로 — 뒤 화면 줄에 남지 않는다 (조건 4)', async () => {
    pretendPhone()
    try {
      mockApi()
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^VOO .* — 자세히$/ }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '자세히 닫기' }))
    } finally {
      forgetPhone()
    }
  })

  it('시트가 떠 있는 동안 뒤 화면은 스크롤되지 않고, 폰 뒤로가기로 닫힌다 (조건 5)', async () => {
    pretendPhone()
    try {
      mockApi()
      const user = userEvent.setup()
      renderPanel()
      await user.click(await screen.findByRole('button', { name: /^VOO .* — 자세히$/ }))
      expect(document.body.style.overflow).toBe('hidden')
      window.history.back()
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'VOO 주문 자세히' })).toBeNull())
      expect(document.body.style.overflow).toBe('')
    } finally {
      forgetPhone()
    }
  })

  it('목표 · 밴드 시트의 합계는 치는 값을 따라간다 (조건 6)', async () => {
    mockApi({ ...CURRENT, rows: CURRENT.rows.map((r) => ({ ...r, target_weight_pct: r.ticker === 'VOO' ? 50 : 40 })) })
    const user = userEvent.setup()
    renderPanel()
    const sheet = await openTargets(user)
    expect(sheet).toHaveTextContent('합계 90.0%')
    await user.clear(within(sheet).getByLabelText('VOO 목표 비중'))
    await user.type(within(sheet).getByLabelText('VOO 목표 비중'), '60')
    expect(sheet).toHaveTextContent('합계 100.0%')
    expect(sheet).toHaveTextContent('100%로 맞습니다')
  })

  it('저장하지 않고 닫으면 화면에 한 줄, 거래를 반영해도 고친 목표는 남고 수량은 서버 값으로 (조건 6)', async () => {
    mockApi()
    const holding = vi.spyOn(api, 'updateHolding').mockResolvedValue(undefined as never)
    const target = vi.spyOn(api, 'updateRebalanceTarget').mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPanel()
    let sheet = await openTargets(user)
    await user.clear(within(sheet).getByLabelText('VOO 목표 비중'))
    await user.type(within(sheet).getByLabelText('VOO 목표 비중'), '55')
    await user.click(within(sheet).getByRole('button', { name: '목표 · 밴드 닫기' }))
    const line = screen.getByText(/목표 · 밴드에 저장하지 않은 변경 1줄 \(VOO\)/)
    expect(within(line).getByRole('button', { name: '열어서 저장' })).toBeInTheDocument()

    // 그사이 거래 반영 — 다시 받아 오는 동안에도 55 가 남는다
    vi.spyOn(api, 'getRebalanceCurrent').mockResolvedValue({
      ...CURRENT,
      rows: CURRENT.rows.map((r) => (r.ticker === 'VOO' ? { ...r, quantity: 1 } : r)),
    })
    await user.click(within(await orderRow('VOO')).getByRole('button', { name: 'VOO 거래 입력' }))
    await user.click(screen.getByRole('button', { name: '반영' }))
    await waitFor(() => expect(holding).toHaveBeenCalled())
    await waitFor(() => expect(api.getRebalanceCurrent).toHaveBeenCalledTimes(2))
    sheet = await openTargets(user)
    await waitFor(() => expect(within(sheet).getByLabelText('VOO 목표 비중')).toHaveValue('55'))
    await user.click(within(sheet).getByRole('button', { name: '바뀐 1줄 저장' }))
    await waitFor(() => expect(target).toHaveBeenCalledWith('VOO', { target_weight_pct: 55, rebalance_band_pct: null }))
    // 수량은 리밸런싱에서 보내지 않는다 — 거래 한 번만
    expect(holding).toHaveBeenCalledTimes(1)
  })
})

describe('리밸런싱 · 묶음 4 재검토 보완', () => {
  it('좁은 PC(1100px 아래, 확대 150% 등)는 표 대신 줄 묶음 — 목록 한 장은 같다 (재검토 조건 2)', async () => {
    const before = window.matchMedia
    // 1100px 질의만 맞다 — 폰(720px) 질의는 아니다
    window.matchMedia = ((media: string) => ({
      matches: media.includes('1100px'),
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
    try {
      mockApi()
      renderPanel()
      const guide = await screen.findByRole('region', { name: '주문 가이드' })
      expect(within(guide).queryByRole('table')).toBeNull()
      expect(within(guide).getByRole('button', { name: /^VOO .* — 자세히$/ })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: '리밸런싱 더 보기' })).toBeInTheDocument()
      // PC 처럼 새로 넣을 돈 칸은 위에 펼쳐져 있다
      expect(screen.getByLabelText(/이번에 새로 넣을 돈/)).toBeInTheDocument()
    } finally {
      window.matchMedia = before
    }
  })
})

describe('리밸런싱 · 목업 12d (주인: 너무 길다)', () => {
  // 늘릴 종목 다섯 — 큰 것 셋만 보이고 "2종목 더 보기"
  const MANY: RebalanceCurrent = {
    ...CURRENT,
    total_value_base: 2_100_000,
    rows: [
      { ...CURRENT.rows[1], target_weight_pct: 10 },
      ...['A1', 'A2', 'A3', 'A4', 'A5'].map((t, i) =>
        row({ ticker: t, currency: 'KRW', target_weight_pct: 20 - i * 2, quantity: 0, last_close: 1000 }),
      ),
      { ...CURRENT.rows[0], target_weight_pct: 0 },
    ],
  }

  it('폰: 묶음마다 큰 것 셋 + "n종목 더 보기", 누르면 다 · "접기"', async () => {
    pretendPhone()
    try {
      mockApi(MANY)
      const user = userEvent.setup()
      renderPanel()
      const buy = await screen.findByRole('region', { name: '늘릴 종목' })
      expect(within(buy).getAllByRole('listitem')).toHaveLength(3)
      // 큰 것부터 — A1(20%) · A2 · A3
      expect(within(buy).getAllByRole('listitem').map((li) => li.querySelector('.order-row-label')?.textContent)).toEqual(['A1', 'A2', 'A3'])
      const more = within(buy).getByRole('button', { name: /^2종목 더 보기/ })
      expect(more).toHaveAttribute('aria-expanded', 'false')
      await user.click(more)
      expect(within(buy).getAllByRole('listitem')).toHaveLength(5)
      expect(within(buy).getByRole('button', { name: /^접기/ })).toHaveAttribute('aria-expanded', 'true')
      // 셋 이하인 묶음에는 더 보기가 없다
      expect(within(screen.getByRole('region', { name: '줄일 종목' })).queryByRole('button', { name: /더 보기/ })).toBeNull()
    } finally {
      forgetPhone()
    }
  })

  it('폰: 줄일 종목도 큰 것 셋 + "2종목 더 보기" (다섯 번째 검토 — 줄일 묶음 제한을 99로 바꿔도 통과했다)', async () => {
    pretendPhone()
    try {
      const sells = ['S1', 'S2', 'S3', 'S4', 'S5'].map((t, i) =>
        row({ ticker: t, currency: 'KRW', target_weight_pct: 0, quantity: 100 - i * 10, last_close: 1000, current_value: (100 - i * 10) * 1000, current_value_base: (100 - i * 10) * 1000 }),
      )
      const value = sells.reduce((a, r) => a + r.current_value_base, 0) + 1_300_000
      mockApi({ ...CURRENT, total_value_base: value, holdings_value_base: value, rows: [...sells, { ...CURRENT.rows[1], target_weight_pct: 100 }] })
      const user = userEvent.setup()
      renderPanel()
      const sell = await screen.findByRole('region', { name: '줄일 종목' })
      expect(within(sell).getAllByRole('listitem').map((li) => li.querySelector('.order-row-label')?.textContent)).toEqual(['S1', 'S2', 'S3'])
      await user.click(within(sell).getByRole('button', { name: /^2종목 더 보기/ }))
      expect(within(sell).getAllByRole('listitem')).toHaveLength(5)
    } finally {
      forgetPhone()
    }
  })

  it('리뷰 · 기록 시트는 ✕ 로 닫힌다 (다섯 번째 검토 — 닫는 함수를 비워도 통과했다)', async () => {
    mockApi()
    const user = userEvent.setup()
    renderPanel()
    await openRecords()
    await user.click(screen.getByRole('button', { name: '리뷰 · 기록 닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '리뷰 · 기록' })).not.toBeInTheDocument())
  })

  it('폰: 새로 넣을 돈은 줄일 · 늘릴 막대 카드 안 한 줄 — 요약은 한 줄(전체 자금 · 큰 금액)과 알약 줄', async () => {
    pretendPhone()
    try {
      mockApi()
      renderPanel()
      const split = await screen.findByRole('group', { name: '줄일 · 늘릴 합계' })
      expect(within(split).getByRole('button', { name: /^새로 넣을 돈/ })).toBeInTheDocument()
      const summary = screen.getByRole('region', { name: '내 자산' })
      expect(summary.querySelector('.rb-summary-line')).toHaveTextContent(/^전체 자금 \(현금 포함, 원 기준\)₩2,100,000$/)
      expect(within(summary).getByRole('button', { name: '금액 가리기' })).toBeInTheDocument()
    } finally {
      forgetPhone()
    }
  })
})
