import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateProvider } from '../AppState'
import { api, ApiError } from '../api/client'
import type { Stock, StockCreateResult, SymbolMatch } from '../types'
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
    dca_amount: 0,
    dca_period: 'monthly',
    rebalance_period: 'quarterly',
    target_weight_pct: 0,
    rebalance_band_pct: null,
    review_date_override: null,
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

function mockApi(stocks: Stock[] = []) {
  vi.spyOn(api, 'listStocks').mockResolvedValue(stocks)
  vi.spyOn(api, 'searchSymbols').mockResolvedValue([SAMSUNG])
  vi.spyOn(api, 'getHealth').mockResolvedValue({
    status: 'ok',
    version: 'test',
    providers: [],
    providers_by_market: { US: [], KR: [] },
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

  it('국내 종목을 고르면 DCA 금액 단위가 원화로 바뀐다', async () => {
    mockApi()
    const user = userEvent.setup()
    renderManager()

    expect(screen.getByLabelText(/DCA 금액 \(\$\)/)).toBeInTheDocument()

    await user.type(symbolInput(), '삼성전자')
    await user.click(await screen.findByText('삼성전자'))

    expect(screen.getByLabelText(/DCA 금액 \(₩\)/)).toBeInTheDocument()
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

  it('활성 종목의 목표 비중 합계를 알려준다', async () => {
    mockApi([
      stock({ ticker: 'VOO', target_weight_pct: 60 }),
      stock({ ticker: 'QQQ', target_weight_pct: 40 }),
      stock({ ticker: 'OLD', target_weight_pct: 99, active: false }),
    ])
    renderManager()

    // 비활성 종목은 합계에서 빠져야 한다
    expect(await screen.findByText(/활성 종목 목표 비중 합계 100\.0%/)).toBeInTheDocument()
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
