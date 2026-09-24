import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api, ApiError } from '../api/client'
import type { ListingStatus, Settings, Stock, StockCreateResult, SymbolMatch } from '../types'
import { StockManager } from './StockManager'

const SAMSUNG: SymbolMatch = {
  ticker: '005930.KS',
  name: '삼성전자',
  market: 'KR',
  board: 'KOSPI',
  instrument: 'STOCK',
  source: 'seed',
  confident: true,
}

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

function created(overrides: Partial<StockCreateResult> = {}): StockCreateResult {
  return {
    stock: stock({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW' }),
    data_loaded: true,
    data_error: null,
    data_hint: null,
    resolved_from: '삼성전자',
    ...overrides,
  }
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    default_rebalance_band_pct: 5,
    base_currency: 'KRW',
    fx_overrides: {},
    fx: { rates: {}, is_estimate: false },
    review_period: 'quarterly',
    review_date_override: null,
    cash: {},
    cash_target_pct: 0,
    ...overrides,
  }
}

function mockApi(stocks: Stock[] = [], listing: Partial<ListingStatus> = {}, cashTarget = 0) {
  vi.spyOn(api, 'listStocks').mockResolvedValue(stocks)
  vi.spyOn(api, 'getSettings').mockResolvedValue(settings({ cash_target_pct: cashTarget }))
  vi.spyOn(api, 'searchSymbols').mockResolvedValue([SAMSUNG])
  vi.spyOn(api, 'getListingStatus').mockResolvedValue({
    cached_count: 0,
    updated_at: null,
    seed_count: 176,
    seed_as_of: '2026-09',
    ...listing,
  })
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: 'test',
    providers_by_market: { US: [], KR: [], JP: [] },
  })
}

/** 종목 검색창. 화면의 <select>들도 combobox 역할이라 placeholder로 특정한다 */
function symbolInput() {
  return screen.getByPlaceholderText(/삼성전자, 005930, VOO/)
}

function renderManager() {
  return render(
    <AppStateProvider>
      <StockManager />
    </AppStateProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('종목 등록', () => {
  it('이름으로 찾아 고른 뒤 등록하면 해석된 티커를 알려준다', async () => {
    mockApi()
    const create = vi.spyOn(api, 'createStock').mockResolvedValue(created())
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))
    await user.click(screen.getByRole('button', { name: /종목 추가/ }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    // 고른 후보의 티커로 등록해야 한다 (이름을 그대로 보내면 서버가 다시 해석해야 한다)
    expect(create.mock.calls[0][0].ticker).toBe('005930.KS')
    expect(await screen.findByText(/삼성전자 → 005930\.KS 추가 완료/)).toBeInTheDocument()
  })

  it('국내 종목을 고르면 평단가 단위가 원화로 바뀐다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderManager()

    expect(screen.getByLabelText(/평단가 \(\$\)/)).toBeInTheDocument()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))

    expect(screen.getByLabelText(/평단가 \(₩\)/)).toBeInTheDocument()
  })

  it('이미 들고 있는 종목은 수량·평단가·목표 비중을 같이 보낸다', async () => {
    mockApi()
    const create = vi.spyOn(api, 'createStock').mockResolvedValue(created())
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))
    await user.type(screen.getByLabelText('목표 비중 (%)'), '30')
    await user.type(screen.getByLabelText('보유 수량'), '120')
    await user.type(screen.getByLabelText(/평단가/), '71500')
    await user.click(screen.getByRole('button', { name: /종목 추가/ }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toEqual({
      ticker: '005930.KS',
      category: null,
      target_weight_pct: 30,
      quantity: 120,
      avg_cost: 71500,
    })
  })

  it('수량·평단가를 비워두면 보내지 않는다 — 0원에 샀다고 적히면 안 된다', async () => {
    mockApi()
    const create = vi.spyOn(api, 'createStock').mockResolvedValue(created())
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))
    await user.click(screen.getByRole('button', { name: /종목 추가/ }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const sent = create.mock.calls[0][0]
    expect(sent).not.toHaveProperty('quantity')
    expect(sent).not.toHaveProperty('avg_cost')
    expect(sent.target_weight_pct).toBe(0)
  })

  it('적립 금액·주기 칸은 없다 — 리밸런싱에는 수량과 목표만 있으면 된다', () => {
    mockApi()
    renderManager()
    expect(screen.queryByText(/DCA/)).not.toBeInTheDocument()
    expect(screen.queryByText(/리뷰 마감일/)).not.toBeInTheDocument()
  })

  it('후보를 고르지 않고 티커를 직접 넣어도 등록된다', async () => {
    mockApi()
    vi.spyOn(api, 'searchSymbols').mockResolvedValue([])
    const create = vi.spyOn(api, 'createStock').mockResolvedValue(
      created({
        stock: stock({ ticker: 'VOO' }),
        resolved_from: null,
      }),
    )
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), 'VOO{Enter}')

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].ticker).toBe('VOO')
    // 해석이 없었으면 화살표 표기 없이 티커만 보여준다
    expect(await screen.findByText(/^VOO 추가 완료/)).toBeInTheDocument()
  })

  it('등록은 됐지만 시세를 못 받으면 경고로 알리고 사유를 접어둔다', async () => {
    mockApi()
    vi.spyOn(api, 'createStock').mockResolvedValue(
      created({
        data_loaded: false,
        data_hint: '네트워크에서 시세 서버로 나가지 못하고 있습니다.',
        data_error: 'naver: 요청 실패 — ConnectionError',
      }),
    )
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))
    await user.click(screen.getByRole('button', { name: /종목 추가/ }))

    expect(await screen.findByText(/시세를 받지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByText('기술적 원인 보기')).toBeInTheDocument()
    expect(screen.getByText(/ConnectionError/)).toBeInTheDocument()
  })

  it('해석할 수 없는 이름은 오류로 알려준다', async () => {
    mockApi()
    vi.spyOn(api, 'searchSymbols').mockResolvedValue([])
    vi.spyOn(api, 'createStock').mockRejectedValue(
      new ApiError(400, "'없는회사'에 해당하는 종목을 찾지 못했습니다.", 'could not resolve'),
    )
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '없는회사{Enter}')

    expect(await screen.findByText(/해당하는 종목을 찾지 못했습니다/)).toBeInTheDocument()
  })
})

describe('등록된 종목 목록', () => {
  it('종목마다 시장과 통화를 보여준다', async () => {
    mockApi([
      stock({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW' }),
      stock({ ticker: 'VOO' }),
    ])
    renderManager()

    expect(await screen.findByText(/한국 · ₩KRW/)).toBeInTheDocument()
    expect(screen.getByText(/미국 · \$USD/)).toBeInTheDocument()
  })

  it('일본 종목 이름을 한글로 고쳐 저장할 수 있다', async () => {
    // 야후는 일본 종목 이름을 영문으로 준다 ("Tokio Marine Holdings").
    const update = vi.spyOn(api, 'updateStock').mockResolvedValue(
      stock({ ticker: '8766.T', name: '도쿄해상홀딩스', market: 'JP', currency: 'JPY' }),
    )
    mockApi([
      stock({
        ticker: '8766.T',
        name: 'Tokio Marine Holdings, Inc.',
        market: 'JP',
        currency: 'JPY',
      }),
    ])
    renderManager()

    const input = await screen.findByLabelText('8766.T 표시 이름')
    await userEvent.clear(input)
    await userEvent.type(input, '도쿄해상홀딩스')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(update).toHaveBeenCalledWith(
      '8766.T',
      expect.objectContaining({ name: '도쿄해상홀딩스' }),
    )
  })

  it('미국 종목은 이름 칸이 없다 — 티커가 곧 이름이다', async () => {
    mockApi([stock({ ticker: 'VOO' })])
    renderManager()

    await screen.findByText(/미국 · \$USD/)
    expect(screen.queryByLabelText('VOO 표시 이름')).not.toBeInTheDocument()
  })

  it('종목을 완전히 지울 수 있다 — 되돌릴 수 없으니 한 번 더 묻는다', async () => {
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    mockApi([stock({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderManager()

    await user.click(await screen.findByRole('button', { name: '삭제' }))
    expect(purge).not.toHaveBeenCalled()

    // 확인은 표 아래가 아니라 화면 위에 떠야 한다 (종목이 많으면 표 아래는 안 보인다)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/되돌릴 수 없고/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '네, 완전히 지웁니다' }))
    await waitFor(() => expect(purge).toHaveBeenCalledWith('VOO'))
    expect(await screen.findByText(/VOO을\(를\) 지웠습니다/)).toBeInTheDocument()
  })

  it('삭제를 취소하면 아무것도 지우지 않는다', async () => {
    const purge = vi.spyOn(api, 'purgeStock').mockResolvedValue(undefined)
    mockApi([stock({ ticker: 'VOO' })])
    const user = userEvent.setup()
    renderManager()

    await user.click(await screen.findByRole('button', { name: '삭제' }))
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(purge).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('활성 종목의 목표 비중 합계를 알려준다', async () => {
    mockApi([
      stock({ ticker: 'VOO', target_weight_pct: 60 }),
      stock({ ticker: 'QQQ', target_weight_pct: 40 }),
      stock({ ticker: 'OLD', target_weight_pct: 99, active: false }),
    ])
    renderManager()

    // 비활성 종목은 합계에서 빠져야 한다
    expect(await screen.findByText(/목표 비중 합계 100\.0%/)).toBeInTheDocument()
  })

  it('현금 목표도 합계에 넣는다 — 목표는 전체 자금 기준이다', async () => {
    mockApi(
      [stock({ ticker: 'VOO', target_weight_pct: 60 }), stock({ ticker: 'QQQ', target_weight_pct: 30 })],
      {},
      10,
    )
    renderManager()

    expect(await screen.findByText(/목표 비중 합계 100\.0% \(현금 10\.0% 포함\)/)).toBeInTheDocument()
  })
})

describe('거래소 목록 갱신', () => {
  it('성공하면 받은 종목 수를 알려준다', async () => {
    mockApi()
    vi.spyOn(api, 'refreshSymbolListing').mockResolvedValue({ ok: true, count: 2841 })
    const user = userEvent.setup()
    renderManager()

    await user.click(screen.getByRole('button', { name: '거래소 목록 갱신' }))
    expect(await screen.findByText(/2,841종목을 받았습니다/)).toBeInTheDocument()
  })

  it('실패해도 내장 목록으로 검색은 된다고 안내한다', async () => {
    mockApi()
    vi.spyOn(api, 'refreshSymbolListing').mockResolvedValue({
      ok: false,
      count: 0,
      error: 'kind.krx.co.kr 연결 실패',
      hint: '네트워크가 막혀 있어도 주요 종목은 내장 목록으로 검색됩니다.',
    })
    const user = userEvent.setup()
    renderManager()

    await user.click(screen.getByRole('button', { name: '거래소 목록 갱신' }))
    expect(await screen.findByText(/내장 목록으로 검색됩니다/)).toBeInTheDocument()
  })
})

describe('종목 검색 범위 안내', () => {
  it('거래소 목록을 아직 못 받았으면 내장 목록 기준임을 밝힌다', async () => {
    // 목록이 언제 기준인지 모르면 "왜 이 종목이 안 나오지?"의 원인을 짐작할 수 없다
    mockApi()
    renderManager()

    const hint = await screen.findByText(/내장 목록 176종목/)
    expect(hint.textContent).toContain('2026-09 기준')
    expect(hint.textContent).toContain('중소형주')
  })

  it('거래소 목록을 받았으면 몇 종목을 언제 받았는지 보여준다', async () => {
    mockApi([], { cached_count: 2743, updated_at: '2026-09-16T05:00:00' })
    renderManager()

    const hint = await screen.findByText(/거래소 목록 2,743종목/)
    expect(hint.textContent).toContain('2026-09-16')
  })

  it('목록 상태를 못 읽어도 화면은 그대로 뜬다', async () => {
    mockApi()
    vi.spyOn(api, 'getListingStatus').mockRejectedValue(new Error('연결 실패'))
    renderManager()

    expect(await screen.findByText(/신규 상장이나 사명이 바뀐 종목/)).toBeInTheDocument()
  })
})

describe('시세를 뒤에서 받는 동안', () => {
  const samsung = (over: Partial<Stock> = {}) =>
    stock({ ticker: '005930.KS', name: '삼성전자', market: 'KR', currency: 'KRW', ...over })

  it('등록은 바로 끝나고, 다 받으면 알려준다', async () => {
    mockApi()
    vi.spyOn(api, 'listStocks')
      .mockResolvedValueOnce([]) // 처음 화면
      .mockResolvedValueOnce([samsung({ data_status: 'loading' })]) // 등록 직후
      .mockResolvedValue([samsung()]) // 몇 초 뒤 다시 물었을 때 — 다 받음
    vi.spyOn(api, 'createStock').mockResolvedValue(created({ data_loaded: false, data_pending: true }))
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))
    await user.click(screen.getByRole('button', { name: /종목 추가/ }))

    expect(await screen.findByText(/추가 완료 — 시세를 받는 중입니다/)).toBeInTheDocument()
    expect(await screen.findByText('시세 받는 중…')).toBeInTheDocument()
    expect(
      await screen.findByText(/삼성전자 시세를 다 받았습니다/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText('시세 받는 중…')).not.toBeInTheDocument()
  })

  it('받다가 실패하면 이유와 할 일을 보여준다', async () => {
    mockApi()
    vi.spyOn(api, 'listStocks')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([samsung({ data_status: 'loading' })])
      .mockResolvedValue([samsung({ data_status: 'failed', data_hint: '종목코드를 확인해주세요.' })])
    vi.spyOn(api, 'createStock').mockResolvedValue(created({ data_loaded: false, data_pending: true }))
    const user = userEvent.setup()
    renderManager()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))
    await user.click(screen.getByRole('button', { name: /종목 추가/ }))

    expect(
      await screen.findByText(/삼성전자 시세를 받지 못했습니다\. 종목코드를 확인해주세요\./, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('시세 못 받음')).toHaveAttribute('title', '종목코드를 확인해주세요.')
  })

  it('받는 중인 종목이 없으면 다시 묻지 않는다', async () => {
    mockApi([samsung()])
    const list = vi.spyOn(api, 'listStocks').mockResolvedValue([samsung()])
    renderManager()
    await screen.findByDisplayValue('삼성전자')
    const calls = list.mock.calls.length
    await new Promise((r) => setTimeout(r, 3500))
    expect(list.mock.calls.length).toBe(calls)
  })
})
