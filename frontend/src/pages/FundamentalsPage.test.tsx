import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'
import type { FundamentalsResponse } from '../types'
import { FundamentalsPage } from './FundamentalsPage'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn() }),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

const GOOG: FundamentalsResponse = { ...FUNDAMENTALS, name: 'Alphabet', quarters: [] }
const ETF: FundamentalsResponse = {
  ...FUNDAMENTALS,
  ticker: '379800.KS',
  name: 'KODEX 미국S&P500',
  currency: 'KRW',
  state: 'unsupported',
  message: '한국 종목 재무는 다음 단계(DART)에서 붙입니다',
  metrics: [],
  per_range: null,
  quarters: [],
}
const NOT_YET: FundamentalsResponse = { ...ETF, ticker: 'NEW', name: null, currency: 'USD', state: null, message: null }

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('재무 화면', () => {
  it('재무가 있는 종목은 표 한 줄 — 지표와 몇 분기까지인지', async () => {
    vi.spyOn(api, 'listFundamentals').mockResolvedValue([GOOG, ETF])
    render(<FundamentalsPage />)

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(within(row).getByRole('button', { name: 'GOOG' })).toBeInTheDocument()
    expect(within(row).getByText('2026.06 분기까지')).toBeInTheDocument()
    expect(within(row).getByText('28.1배')).toBeInTheDocument()
    expect(within(row).getByText('71%')).toBeInTheDocument() // PER 5년 위치
    expect(within(row).getByText('+24.6%')).toBeInTheDocument()
    expect(within(row).getByText('-3.2%')).toBeInTheDocument()
    // 폰에서 칸 이름을 붙이는 데 쓴다
    expect(within(row).getByText('28.1배').closest('td')).toHaveAttribute('data-label', 'PER')
    expect(screen.getByText(/최근 종가\(2026-09-25\) 기준/)).toBeInTheDocument()
  })

  it('재무가 없는 종목은 표에 넣지 않고 이유를 적는다', async () => {
    vi.spyOn(api, 'listFundamentals').mockResolvedValue([GOOG, ETF, NOT_YET])
    render(<FundamentalsPage />)

    const hidden = (await screen.findByText('재무를 보여주지 않는 종목')).closest('.section') as HTMLElement
    expect(within(hidden).getByText('KODEX 미국S&P500')).toBeInTheDocument()
    expect(within(hidden).getByText(/다음 단계\(DART\)/)).toBeInTheDocument()
    expect(within(hidden).getByText('NEW')).toBeInTheDocument()
    expect(within(hidden).getByText(/아직 재무를 받지 않았습니다/)).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('KODEX 미국S&P500')).toBeNull()
  })

  it('이름을 누르면 팝업이 재무 탭으로 열린다', async () => {
    vi.spyOn(api, 'listFundamentals').mockResolvedValue([GOOG])
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      ticker: 'GOOG',
      prices: [],
      markers: [],
      coverage: { first_date: null, last_date: null, rows: 0 },
    })
    const detail = vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const user = userEvent.setup()
    render(<FundamentalsPage />)

    await user.click(await screen.findByRole('button', { name: 'GOOG' }))
    await waitFor(() => expect(detail).toHaveBeenCalledWith('GOOG'))
    expect(await screen.findByRole('tab', { name: '재무' })).toHaveAttribute('aria-selected', 'true')
    // 분기 표와 PER 막대는 팝업에만 있다
    expect(await screen.findByText(/PER이 지금\(28\.1배\) 이하였던 날은 71%/)).toBeInTheDocument()
  })

  it('담은 종목이 없으면 그렇게 말한다', async () => {
    vi.spyOn(api, 'listFundamentals').mockResolvedValue([])
    render(<FundamentalsPage />)
    expect(await screen.findByText('담은 종목이 없습니다')).toBeInTheDocument()
  })

  it('못 불러오면 오류를 보여준다', async () => {
    vi.spyOn(api, 'listFundamentals').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    render(<FundamentalsPage />)
    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중…')).toBeNull()
  })
})
