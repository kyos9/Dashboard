import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api/client'
import type { HistoryResponse } from '../types'
import { AuthGate } from './AuthGate'
import { ChartModal, needsBackfill } from './ChartModal'
import { FUNDAMENTALS } from '../test/fundamentalsFixture'

const series = { setData: vi.fn() }
const chart = {
  addSeries: vi.fn(() => series),
  applyOptions: vi.fn(),
  remove: vi.fn(),
  timeScale: () => ({ fitContent: vi.fn() }),
}
const createChart = vi.fn(() => chart)

vi.mock('lightweight-charts', () => ({
  createChart: (...args: unknown[]) => createChart(...(args as [])),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  LineSeries: 'Line',
  PriceScaleMode: { Logarithmic: 1 },
}))

const HISTORY: HistoryResponse = {
  ticker: '005930.KS',
  prices: [
    { date: '2026-09-15', close: 76_000 },
    { date: '2026-09-16', close: 76_900 },
  ],
  markers: [{ date: '2026-09-16', kind: 'buy' }],
  coverage: { first_date: '2021-09-16', last_date: '2026-09-16', rows: 1_250 },
}

beforeEach(() => {
  vi.restoreAllMocks()
  createChart.mockClear()
  series.setData.mockClear()
})

describe('차트 팝업', () => {
  it('종목 이름과 차트를 띄운다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: /삼성전자 차트/ })).toBeInTheDocument()
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    await waitFor(() => expect(series.setData).toHaveBeenCalled())
  })

  it('기간을 바꾸면 그 기간으로 다시 불러온다', async () => {
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const user = userEvent.setup()
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', '1y'))
    await user.click(screen.getByRole('button', { name: '전체' }))
    await waitFor(() => expect(history).toHaveBeenCalledWith('005930.KS', 'max'))
  })

  it('ESC와 닫기 버튼으로 닫힌다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('시세를 못 불러와도 팝업은 닫히지 않고 이유를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockRejectedValue(new Error('백엔드가 응답하지 않습니다'))
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    expect(await screen.findByText(/백엔드가 응답하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('닫히면 뒤 화면 스크롤을 되돌린다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const { unmount } = render(<ChartModal ticker="VOO" onClose={() => {}} />)

    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('저장 구간 안내', () => {
  it('저장된 시세 구간을 적는다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" name="삼성전자" onClose={() => {}} />)

    expect(await screen.findByText(/저장된 시세 2021-09-16 ~ 2026-09-16/)).toBeInTheDocument()
  })

  it('고른 기간보다 저장된 시세가 짧으면 전체 기간을 다시 받게 한다', async () => {
    // "5년을 눌렀는데 1년만 보인다"는 차트가 아니라 받아둔 데이터의 문제다.
    // 평소 갱신은 최근 2년만 받으므로, 그대로 두면 앞부분은 영영 비어 있다.
    const short: HistoryResponse = {
      ...HISTORY,
      coverage: { first_date: '2025-09-16', last_date: '2026-09-16', rows: 250 },
    }
    const history = vi.spyOn(api, 'getHistory').mockResolvedValue(short)
    const refresh = vi.spyOn(api, 'refreshStock').mockResolvedValue({ ticker: 'VOO' })
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: '5년' }))
    await user.click(await screen.findByRole('button', { name: '전체 기간 다시 받기' }))

    // 평소 갱신(2년)이 아니라 전체를 받아야 한다
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('VOO', true))
    // 받은 뒤에는 다시 그려야 한다 (1y 최초 + 5y + 다시받기 후)
    await waitFor(() => expect(history).toHaveBeenCalledTimes(3))
  })

  it('저장된 시세가 고른 기간을 덮으면 다시 받으라고 하지 않는다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    render(<ChartModal ticker="005930.KS" onClose={() => {}} />)

    await screen.findByText(/저장된 시세/)
    expect(screen.queryByRole('button', { name: '전체 기간 다시 받기' })).toBeNull()
  })

  it('사용자에게는 짧다는 사실만 — 전체 기간 다시 받기는 관리자만 한다', async () => {
    vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.22.0' })
    vi.spyOn(api, 'getAuthStatus').mockResolvedValue({
      locked: true, authenticated: true, mode: 'google', config_problem: null,
      user: { email: 'b@example.com', name: '비', is_owner: false, status: 'active' },
    })
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      ...HISTORY,
      coverage: { first_date: '2025-09-16', last_date: '2026-09-16', rows: 250 },
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AuthGate>
          <ChartModal ticker="VOO" onClose={() => {}} />
        </AuthGate>
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: '5년' }))
    expect(await screen.findByText(/고른 기간보다 짧습니다 \(앞부분은 관리자가 받을 수 있습니다\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 기간 다시 받기' })).toBeNull()
  })

  it('다시 받다가 실패하면 이유를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue({
      ...HISTORY,
      coverage: { first_date: '2025-09-16', last_date: '2026-09-16', rows: 250 },
    })
    vi.spyOn(api, 'refreshStock').mockRejectedValue(new Error('시세 서버에 연결하지 못했습니다'))
    const user = userEvent.setup()
    render(<ChartModal ticker="VOO" onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: '5년' }))
    await user.click(await screen.findByRole('button', { name: '전체 기간 다시 받기' }))

    expect(await screen.findByText(/시세 서버에 연결하지 못했습니다/)).toBeInTheDocument()
  })
})

describe('기간 대비 저장 구간 판정', () => {
  const withCoverage = (first: string | null): HistoryResponse => ({
    ...HISTORY,
    coverage: { first_date: first, last_date: '2026-09-16', rows: first ? 100 : 0 },
  })

  it('1년을 골랐는데 반년치뿐이면 모자란 것이다', () => {
    const halfYear = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
    expect(needsBackfill(withCoverage(halfYear), '1y')).toBe(true)
  })

  it('휴장일 때문에 며칠 비는 것은 모자란 게 아니다', () => {
    const almost = new Date(Date.now() - 362 * 86_400_000).toISOString().slice(0, 10)
    expect(needsBackfill(withCoverage(almost), '1y')).toBe(false)
  })

  it('전체를 고르면 얼마나 더 있는지 알 수 없으므로 언제나 다시 받아볼 수 있다', () => {
    expect(needsBackfill(withCoverage('1990-01-02'), 'max')).toBe(true)
  })

  it('저장된 시세가 아예 없으면 차트가 아니라 등록·갱신의 문제다', () => {
    expect(needsBackfill(withCoverage(null), '5y')).toBe(false)
  })
})

describe('차트 팝업 · 재무 탭', () => {
  it('재무가 있으면 탭이 생기고, 누르면 재무를 보여준다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    const user = userEvent.setup()
    render(<ChartModal ticker="GOOG" name="GOOG" onClose={() => {}} />)

    await user.click(await screen.findByRole('tab', { name: '재무' }))
    expect(screen.getByText('28.1배')).toBeInTheDocument()
    // 재무를 보는 동안 차트 기간 버튼은 뜻이 없다
    expect(screen.queryByRole('button', { name: '전체' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: '차트' }))
    expect(screen.getByRole('button', { name: '전체' })).toBeInTheDocument()
  })

  it('"재무" 화면에서 열면 재무 탭부터', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockResolvedValue(FUNDAMENTALS)
    render(<ChartModal ticker="GOOG" name="GOOG" initialTab="fundamentals" onClose={() => {}} />)
    expect(await screen.findByText('28.1배')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '재무' })).toHaveAttribute('aria-selected', 'true')
  })

  it('ETF 처럼 재무가 없는 종목은 탭이 없다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    const fundamentals = vi.spyOn(api, 'getFundamentals').mockResolvedValue({
      ...FUNDAMENTALS,
      state: 'none',
      metrics: [],
      quarters: [],
      per_range: null,
    })
    render(<ChartModal ticker="VOO" name="VOO" initialTab="fundamentals" onClose={() => {}} />)
    await waitFor(() => expect(fundamentals).toHaveBeenCalledWith('VOO'))
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: '재무' })).toBeNull()
  })

  it('재무를 못 받아도 차트는 그대로다', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue(HISTORY)
    vi.spyOn(api, 'getFundamentals').mockRejectedValue(new Error('offline'))
    render(<ChartModal ticker="GOOG" name="GOOG" onClose={() => {}} />)
    await waitFor(() => expect(createChart).toHaveBeenCalled())
    expect(screen.queryByRole('tab', { name: '재무' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
